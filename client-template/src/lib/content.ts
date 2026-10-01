// Récupération du contenu au build (SSG) — point d'entrée UNIQUE pour toutes les pages.
//
// Sources, par ordre de priorité :
// - TEMPLATE_FIXTURE=/chemin/fixture.json : contenu de test lu sur disque
//   ({ pages: { docs }, posts: { docs } }), sans API (voir fixtures/site.json) ;
// - canal interne de l'orchestrateur (/internal/site-pages et /internal/site-posts),
//   authentifié par BUILD_TOKEN (jamais exposé au navigateur).
//
// Échecs :
// - build lancé par l'orchestrateur (site + jeton fournis) : une API indisponible fait
//   ÉCHOUER le build — mieux vaut garder la version en ligne que publier un site vide ;
// - build local du template seul (npm run build) : page de secours (mode hors-ligne).
//
// Le contenu est lu une seule fois par build : la promesse est mise en cache au niveau
// du module (partagé par la route attrape-tout et le blog).

import fs from 'node:fs';
import { normalizeLocale, localeRouteParam, localesInPages, DEFAULT_LOCALE, LOCALES } from './i18n.mjs';
import { withBase } from './url';

const orchestratorUrl = process.env.ORCHESTRATOR_URL || 'http://127.0.0.1:4000';
const siteSlug = process.env.ACTIVE_SITE_SLUG || '';
const fixturePath = process.env.TEMPLATE_FIXTURE || '';
export const isOrchestratedBuild = Boolean(process.env.ACTIVE_SITE_SLUG && process.env.BUILD_TOKEN);
/** Brouillon (prévisualisation privée) : affiche les aides à l'édition (blocs inconnus…). */
export const isDraftBuild = process.env.PUBLIC_IS_DRAFT === '1';

export interface Block {
  blockType: string;
  [field: string]: any;
}

export interface PageDoc {
  title: string;
  slug: string;
  locale?: string;
  metaTitle?: string;
  metaDescription?: string;
  layout: Block[];
}

export interface NavPage {
  title: string;
  slug: string;
}

export interface Post {
  title: string;
  slug: string;
  excerpt?: string;
  coverImage?: string;
  body?: string;
  tags?: string;
  publishedAt?: string | null;
  status?: string;
}

export interface SiteContent {
  /** Pages routables (collisions de routes et adresses invalides retirées). */
  pages: PageDoc[];
  /** Articles publiés (du plus récent au plus ancien, ordre du serveur). */
  posts: Post[];
  /** Langues réellement présentes (ordre canonique de LOCALES). */
  locales: string[];
  /** Menu de navigation par langue : une page n'apparaît que dans sa langue. */
  navByLocale: Record<string, NavPage[]>;
  /** Build local sans API : seule la page de secours est générée. */
  offline: boolean;
}

// Même règle que la validation des pages côté serveur (segment d'URL simple).
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// Adresses réservées pour une page de la langue par défaut (servie à la racine) :
// « blog » est la route du blog, et chaque code de langue préfixe les pages de cette
// langue (/en/…). Une page CMS à cette adresse serait masquée par la route réservée.
const RESERVED_ROOT_SLUGS = new Set(['blog', ...LOCALES.filter((l) => l !== DEFAULT_LOCALE)]);

// Page générée quand l'API est injoignable lors d'un build local du template seul.
const OFFLINE_PAGE: PageDoc = {
  title: 'Accueil (mode hors-ligne)',
  slug: 'home',
  locale: DEFAULT_LOCALE,
  layout: [
    {
      blockType: 'hero',
      title: 'Meta-Builder de Sites',
      subtitle: "Le serveur local de l'Orchestrateur (port 4000) semble hors-ligne. Lancez-le pour charger vos blocs dynamiques !",
    },
  ],
};

async function internalFetch(pathname: string): Promise<any> {
  const res = await fetch(`${orchestratorUrl}${pathname}?site=${encodeURIComponent(siteSlug)}`, {
    headers: { 'x-build-token': process.env.BUILD_TOKEN || '' },
  });
  if (!res.ok) throw new Error(`${pathname} : HTTP ${res.status}`);
  return res.json();
}

// Réécrit les URLs de médiathèque comme le canal interne du serveur
// (/api/media/file/x → <base>/media/x) : une fixture reste valable quel que soit le
// chemin de base du build.
function rewriteMediaUrls(value: unknown, prefix: string): unknown {
  if (typeof value === 'string') return value.split('/api/media/file/').join(prefix);
  if (Array.isArray(value)) return value.map((v) => rewriteMediaUrls(v, prefix));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteMediaUrls(v, prefix);
    return out;
  }
  return value;
}

function readFixture(file: string): { pages: any[]; posts: any[] } {
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err: any) {
    throw new Error(`Fixture illisible (TEMPLATE_FIXTURE=${file}) : ${err.message}`);
  }
  const rewritten = rewriteMediaUrls(data, withBase('/media/')) as any;
  const posts = ((rewritten.posts && rewritten.posts.docs) || []) as Post[];
  return {
    pages: (rewritten.pages && rewritten.pages.docs) || [],
    // Comme le canal interne : articles publiés uniquement
    posts: posts.filter((p) => !p.status || p.status === 'published'),
  };
}

// Contenu brut : pages (null = API injoignable en build local) et articles.
async function loadRaw(): Promise<{ pages: any[] | null; posts: any[] }> {
  if (fixturePath) {
    console.log(`[contenu] Fixture : ${fixturePath}`);
    return readFixture(fixturePath);
  }
  const [pagesRes, postsRes] = await Promise.allSettled([
    internalFetch('/internal/site-pages'),
    internalFetch('/internal/site-posts'),
  ]);
  if (isOrchestratedBuild) {
    // Build de l'orchestrateur : on échoue plutôt que de publier une page de secours
    // (ou un blog vide) par-dessus le vrai site — la version en ligne est conservée.
    for (const r of [pagesRes, postsRes]) {
      if (r.status === 'rejected') throw new Error(`API du contenu injoignable — ${r.reason?.message || r.reason}`);
    }
  }
  if (pagesRes.status === 'rejected') {
    console.warn(`[contenu] API injoignable (${pagesRes.reason?.message || pagesRes.reason}) : page de secours hors-ligne.`);
  }
  return {
    pages: pagesRes.status === 'fulfilled' ? pagesRes.value.docs || [] : null,
    posts: postsRes.status === 'fulfilled' ? postsRes.value.docs || [] : [],
  };
}

// Garde les pages routables et normalise leur contenu. Les pages masquées (adresse
// réservée, doublon, adresse invalide) sont signalées dans le journal de build.
function routablePages(raw: any[]): PageDoc[] {
  const seen = new Set<string>();
  const pages: PageDoc[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const locale = normalizeLocale(p.locale);
    if (typeof p.slug !== 'string' || !SLUG_RE.test(p.slug)) {
      console.warn(`[contenu] Page « ${p.title || '?'} » ignorée : adresse invalide (${JSON.stringify(p.slug)}).`);
      continue;
    }
    if (locale === DEFAULT_LOCALE && RESERVED_ROOT_SLUGS.has(p.slug)) {
      console.warn(`[contenu] Page « ${p.title || p.slug} » ignorée : l'adresse /${p.slug}/ est réservée (${p.slug === 'blog' ? 'blog du site' : 'préfixe de langue'}). Changez son adresse dans le CMS.`);
      continue;
    }
    const route = localeRouteParam(locale, p.slug);
    if (seen.has(route)) {
      console.warn(`[contenu] Page « ${p.title || p.slug} » ignorée : adresse /${route}/ en double.`);
      continue;
    }
    seen.add(route);
    pages.push({
      ...p,
      title: typeof p.title === 'string' && p.title ? p.title : p.slug,
      locale,
      layout: Array.isArray(p.layout) ? p.layout.filter((b: any) => b && typeof b.blockType === 'string') : [],
    });
  }
  return pages;
}

// Articles publiables : adresse valide, titre, et une seule fois par adresse (le plus
// récent, ordre du serveur). Même règle que le sitemap (server/lib/i18n.js publishedRoutes).
function validPosts(raw: any[]): Post[] {
  const seen = new Set<string>();
  return raw.filter((p) => {
    if (!(p && typeof p.slug === 'string' && SLUG_RE.test(p.slug) && p.title)) {
      console.warn(`[contenu] Article ignoré : adresse invalide (${JSON.stringify(p && p.slug)}).`);
      return false;
    }
    if (seen.has(p.slug)) {
      console.warn(`[contenu] Article « ${p.title} » ignoré : adresse /blog/${p.slug}/ en double.`);
      return false;
    }
    seen.add(p.slug);
    return true;
  });
}

async function loadSiteContent(): Promise<SiteContent> {
  const raw = await loadRaw();
  const offline = raw.pages === null;
  const pages = offline ? [OFFLINE_PAGE] : routablePages(raw.pages as any[]);
  const posts = offline ? [] : validPosts(raw.posts);

  // Menu PAR LANGUE ; le blog (non localisé) est rattaché à la langue par défaut et
  // n'apparaît que s'il contient au moins un article publié.
  const navByLocale: Record<string, NavPage[]> = {};
  for (const p of pages) {
    (navByLocale[normalizeLocale(p.locale)] ||= []).push({ title: p.title, slug: p.slug });
  }
  if (posts.length > 0) (navByLocale[DEFAULT_LOCALE] ||= []).push({ title: 'Actualités', slug: 'blog' });

  if (!offline) console.log(`[contenu] ${pages.length} page(s), ${posts.length} article(s) publié(s).`);
  // Langues proposées (sélecteur, hreflang) : seulement celles qui ont une page d'accueil,
  // cible de ces liens — jamais de lien vers un /en/ inexistant.
  const locales = localesInPages(pages.filter((p) => p.slug === 'home'));
  return { pages, posts, locales, navByLocale, offline };
}

let contentPromise: Promise<SiteContent> | null = null;

/** Contenu du site, lu une seule fois par build (promesse partagée par toutes les pages). */
export function getSiteContent(): Promise<SiteContent> {
  if (!contentPromise) contentPromise = loadSiteContent();
  return contentPromise;
}

// Étiquettes « a, b, c » → ['a','b','c'] (nettoyées, dédupliquées, bornées).
export function parseTags(tags: string | undefined): string[] {
  const seen = new Set<string>();
  return (tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 8);
}
