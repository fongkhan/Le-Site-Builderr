import type { Block, PageDoc, PagesData } from '../../../types';

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

// Pages de l'éditeur → corps envoyé au serveur (liste COMPLÈTE, sans identifiants client).
export function toServerPages(pages: EditorPage[]): PagesData {
  return {
    docs: pages.map((page) => ({
      ...omitId(page),
      layout: page.layout.map((block) => omitId(block)),
    })),
  };
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
  if (isDefaultHome(page)) return "La page d'accueil du site ne peut pas être supprimée.";
  if (pages.length <= 1) return 'Le site doit garder au moins une page.';
  return null;
}
