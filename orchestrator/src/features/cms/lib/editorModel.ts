import type { Block, PageDoc, PageRef, PagesData } from '../../../types';

// Modèle de l'éditeur de contenu. Chaque page et chaque bloc reçoit un identifiant CLIENT
// stable (attribué au chargement et à la création, jamais envoyé au serveur) : l'éditeur
// ouvert, les retours asynchrones (IA, téléversement) et le glisser-déposer visent ainsi
// toujours le bon bloc, même après un déplacement ou une suppression.
// Les opérations sont pures et immuables : elles renvoient une nouvelle liste (partage
// structurel) ou la liste d'origine si rien n'a changé.

export type EditorBlock = Block & { id: string };

export interface EditorPage extends Omit<PageDoc, 'layout'> {
  id: string;
  layout: EditorBlock[];
}

/** Champs d'une page modifiables par updatePage (pas l'identifiant ni les blocs) */
export type EditorPageFields = Omit<EditorPage, 'id' | 'layout'>;

/** Langue par défaut, servie à la racine du site */
export const DEFAULT_LOCALE = 'fr';
export const HOME_SLUG = 'home';

let fallbackCounter = 0;

// crypto.randomUUID n'existe qu'en contexte sécurisé (HTTPS ou localhost) : repli sinon.
export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  fallbackCounter += 1;
  return `id-${Date.now().toString(36)}-${fallbackCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

export function pageLocale(page: Pick<PageDoc, 'locale'>): string {
  return page.locale || DEFAULT_LOCALE;
}

export function isDefaultHome(page: Pick<PageDoc, 'slug' | 'locale'>): boolean {
  return page.slug === HOME_SLUG && pageLocale(page) === DEFAULT_LOCALE;
}

function omitId<T extends { id: string }>(value: T): Omit<T, 'id'> {
  const copy: Partial<T> = { ...value };
  delete copy.id;
  return copy as Omit<T, 'id'>;
}

export function withClientId(block: Block): EditorBlock {
  return { ...block, id: newClientId() };
}

// Réponse du serveur → pages de l'éditeur (identifiants client neufs, layout toujours défini).
export function toEditorPages(data: PagesData): EditorPage[] {
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  return docs.map((page) => ({
    ...page,
    id: newClientId(),
    layout: (Array.isArray(page.layout) ? page.layout : []).map(withClientId),
  }));
}

// Pages de l'éditeur → corps envoyé au serveur (sans identifiants client). Une page absente
// du corps n'est PAS supprimée (elle a pu être créée depuis un autre onglet) : seules les
// pages listées dans `deleted` le sont.
export function toServerPages(pages: EditorPage[], deleted: PageRef[] = []): PagesData {
  const body: PagesData = {
    docs: pages.map((page) => ({
      ...omitId(page),
      layout: page.layout.map((block) => omitId(block)),
    })),
  };
  if (deleted.length > 0) body.deleted = deleted;
  return body;
}

/** Clé d'une page côté serveur : langue + adresse */
export function pageKey(page: Pick<PageDoc, 'slug' | 'locale'>): string {
  return `${pageLocale(page)}:${page.slug}`;
}

// Pages présentes dans `prev` mais plus dans `next` (suppressions de l'éditeur).
export function removedPages(prev: EditorPage[], next: EditorPage[]): PageRef[] {
  const kept = new Set(next.map((p) => p.id));
  return prev.filter((p) => !kept.has(p.id)).map((p) => ({ slug: p.slug, locale: pageLocale(p) }));
}

export function findBlock(pages: EditorPage[], blockId: string): { page: EditorPage; block: EditorBlock; index: number } | null {
  for (const page of pages) {
    const index = page.layout.findIndex((b) => b.id === blockId);
    if (index !== -1) return { page, block: page.layout[index], index };
  }
  return null;
}

// Remplace le layout de la page qui contient `blockId` (recherche dans toutes les pages :
// un retour asynchrone peut arriver après un changement de page).
function mapLayoutOf(pages: EditorPage[], blockId: string, change: (layout: EditorBlock[], index: number) => EditorBlock[] | null): EditorPage[] {
  const found = findBlock(pages, blockId);
  if (!found) return pages;
  const layout = change(found.page.layout, found.index);
  if (!layout) return pages;
  return pages.map((p) => (p === found.page ? { ...p, layout } : p));
}

// Applique une recette à une copie du bloc le plus récent.
export function updateBlock(pages: EditorPage[], blockId: string, recipe: (draft: Block) => void): EditorPage[] {
  return mapLayoutOf(pages, blockId, (layout, index) => {
    const draft = structuredClone(layout[index]);
    recipe(draft);
    draft.id = blockId; // l'identifiant client ne change jamais
    const next = layout.slice();
    next[index] = draft;
    return next;
  });
}

export function insertBlock(pages: EditorPage[], pageId: string, block: EditorBlock): EditorPage[] {
  if (!pages.some((p) => p.id === pageId)) return pages;
  return pages.map((p) => (p.id === pageId ? { ...p, layout: [...p.layout, block] } : p));
}

export function removeBlock(pages: EditorPage[], blockId: string): EditorPage[] {
  return mapLayoutOf(pages, blockId, (layout, index) => layout.filter((_, i) => i !== index));
}

// Déplace un bloc d'un cran vers le haut (-1) ou le bas (+1).
export function moveBlock(pages: EditorPage[], blockId: string, delta: -1 | 1): EditorPage[] {
  return mapLayoutOf(pages, blockId, (layout, index) => {
    const target = index + delta;
    if (target < 0 || target >= layout.length) return null;
    const next = layout.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
}

// Glisser-déposer : place le bloc `fromId` à la position du bloc `toId` (même page).
export function reorderBlock(pages: EditorPage[], fromId: string, toId: string): EditorPage[] {
  if (fromId === toId) return pages;
  return mapLayoutOf(pages, fromId, (layout, from) => {
    const to = layout.findIndex((b) => b.id === toId);
    if (to === -1) return null;
    const next = layout.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  });
}

export function updatePage(pages: EditorPage[], pageId: string, recipe: (draft: EditorPageFields) => void): EditorPage[] {
  if (!pages.some((p) => p.id === pageId)) return pages;
  return pages.map((p) => {
    if (p.id !== pageId) return p;
    const draft = { ...p };
    recipe(draft);
    return { ...draft, id: p.id, layout: p.layout };
  });
}

export function removePage(pages: EditorPage[], pageId: string): EditorPage[] {
  return pages.some((p) => p.id === pageId) ? pages.filter((p) => p.id !== pageId) : pages;
}

// Raison pour laquelle une page ne peut pas être supprimée, ou null si elle peut l'être.
export function pageDeletionBlocker(page: EditorPage, pages: EditorPage[]): string | null {
  // Un accueil en double (contenu ancien ou importé) reste supprimable : on garde l'autre
  if (isDefaultHome(page) && pages.filter(isDefaultHome).length <= 1) return "La page d'accueil du site ne peut pas être supprimée.";
  if (pages.length <= 1) return 'Le site doit garder au moins une page.';
  return null;
}

// --- Ordre du menu, duplication, annonces ---

// Position cible d'une page dans le menu de SA langue : la page voisine de même langue
// dans la direction demandée (les autres langues ne bougent pas), ou -1.
function menuNeighbor(pages: EditorPage[], index: number, delta: -1 | 1): number {
  const locale = pageLocale(pages[index]);
  for (let i = index + delta; i >= 0 && i < pages.length; i += delta) {
    if (pageLocale(pages[i]) === locale) return i;
  }
  return -1;
}

/** La page peut-elle monter (-1) ou descendre (+1) dans le menu de sa langue ? */
export function canMovePage(pages: EditorPage[], pageId: string, delta: -1 | 1): boolean {
  const index = pages.findIndex((p) => p.id === pageId);
  return index !== -1 && menuNeighbor(pages, index, delta) !== -1;
}

// Monte (-1) ou descend (+1) une page dans le menu : l'ordre de la liste envoyée devient
// l'ordre du menu (navOrder côté serveur).
export function movePage(pages: EditorPage[], pageId: string, delta: -1 | 1): EditorPage[] {
  const index = pages.findIndex((p) => p.id === pageId);
  if (index === -1) return pages;
  const target = menuNeighbor(pages, index, delta);
  if (target === -1) return pages;
  const next = pages.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Copie profonde d'un bloc (nouvel identifiant client), insérée juste après l'original.
export function duplicateBlock(pages: EditorPage[], blockId: string): EditorPage[] {
  return mapLayoutOf(pages, blockId, (layout, index) => {
    const copy: EditorBlock = { ...structuredClone(layout[index]), id: newClientId() };
    const next = layout.slice();
    next.splice(index + 1, 0, copy);
    return next;
  });
}

// Réinsère un bloc à sa place (annulation d'une suppression) : position bornée à la
// longueur actuelle ; sans effet si la page a disparu ou si le bloc est déjà présent.
export function insertBlockAt(pages: EditorPage[], pageId: string, block: EditorBlock, index: number): EditorPage[] {
  if (findBlock(pages, block.id)) return pages;
  if (!pages.some((p) => p.id === pageId)) return pages;
  return pages.map((p) => (p.id === pageId ? { ...p, layout: restoreItem(p.layout, index, block) } : p));
}

// Liste avec `item` réinséré à `index` (borné à la longueur actuelle de la liste).
export function restoreItem<T>(list: readonly T[], index: number, item: T): T[] {
  const next = list.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

/** Annonce lecteur d'écran après un déplacement (newIndex à partir de 0). */
export function moveAnnouncement(label: string, newIndex: number, total: number): string {
  return `Section ${label} déplacée en position ${newIndex + 1} sur ${total}.`;
}

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function changedKeys(a: object, b: object): string[] {
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((k) => !sameValue(ra[k], rb[k]));
}

// Clé de regroupement de l'historique (annuler/rétablir) : page + bloc + champ quand une
// modification ne touche qu'un champ, sinon undefined (étape d'historique à part).
export function editGroupKey(prev: EditorPage[], next: EditorPage[]): string | undefined {
  if (prev.length !== next.length) return undefined;
  const changed = next.filter((p, i) => p !== prev[i]);
  if (changed.length !== 1) return undefined;
  const after = changed[0];
  const before = prev[next.indexOf(after)];
  if (before.id !== after.id) return undefined;
  if (before.layout === after.layout) {
    const keys = changedKeys(before, after).filter((k) => k !== 'layout');
    return keys.length === 1 ? `${after.id}::${keys[0]}` : undefined;
  }
  if (before.layout.length !== after.layout.length) return undefined;
  const blocks = after.layout.filter((b, i) => b !== before.layout[i]);
  if (blocks.length !== 1) return undefined;
  const block = blocks[0];
  const old = before.layout[after.layout.indexOf(block)];
  if (old.id !== block.id) return undefined;
  const keys = changedKeys(old, block);
  return keys.length === 1 ? `${after.id}:${block.id}:${keys[0]}` : undefined;
}
