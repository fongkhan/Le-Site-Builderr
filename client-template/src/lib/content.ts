// Helpers de récupération du contenu au build (SSG). Le canal interne est authentifié
// par BUILD_TOKEN (jamais exposé au navigateur). Tout échoue en douceur : un site se
// construit même si l'API est momentanément indisponible (pages/articles vides).

const baseUrl = process.env.ORCHESTRATOR_URL || 'http://127.0.0.1:4000';
const siteSlug = process.env.ACTIVE_SITE_SLUG || '';

async function internalFetch(pathname: string): Promise<any> {
  const res = await fetch(`${baseUrl}${pathname}?site=${encodeURIComponent(siteSlug)}`, {
    headers: { 'x-build-token': process.env.BUILD_TOKEN || '' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface NavPage { title: string; slug: string; }

export interface Post {
  title: string;
  slug: string;
  excerpt?: string;
  coverImage?: string;
  body?: string;
  publishedAt?: string | null;
  status?: string;
}

// Liste des pages (pour le menu). Vide en cas d'erreur.
export async function fetchNavPages(): Promise<NavPage[]> {
  try {
    const data = await internalFetch('/internal/site-pages');
    return (data.docs || []).map((p: any) => ({ title: p.title, slug: p.slug }));
  } catch {
    return [];
  }
}

// Articles publiés (triés du plus récent au plus ancien côté serveur). Vide en cas d'erreur.
export async function fetchPosts(): Promise<Post[]> {
  try {
    const data = await internalFetch('/internal/site-posts');
    return (data.docs || []) as Post[];
  } catch {
    return [];
  }
}

// Construit la barre de navigation : pages du site + entrée « Actualités » si le blog
// contient au moins un article publié.
export function buildNav(pages: NavPage[], posts: Post[]): NavPage[] {
  const nav = [...pages];
  if (posts.length > 0) nav.push({ title: 'Actualités', slug: 'blog' });
  return nav;
}

// Découpe un corps texte en paragraphes (une ligne vide = nouveau paragraphe).
export function toParagraphs(body: string | undefined): string[] {
  return (body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
