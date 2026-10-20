// Titre de l'onglet du navigateur selon la route : « Contenu — Boulangerie · Le Site Builder ».
// La marque reprend le <title> d'index.html.

export const APP_BRAND = 'Le Site Builder';

const TOP_LEVEL: Record<string, string> = {
  '/sites': 'Mes sites',
  '/onboarding': 'Créer un site',
  '/admin-panel': 'Panel Admin',
  '/login': 'Connexion',
  '/forgot-password': 'Mot de passe oublié',
  '/reset-password': 'Nouveau mot de passe',
};

const SITE_SECTIONS: Record<string, string> = {
  design: 'Design',
  cms: 'Contenu',
  blog: 'Blog',
  deploy: 'Déploiement',
  messages: 'Messages',
};

export function routeTitle(pathname: string, siteName?: string): string {
  const path = (pathname.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/';
  const parts: string[] = [];
  const site = /^\/sites\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (site) {
    const section = site[2] ? SITE_SECTIONS[site[2]] : SITE_SECTIONS.design;
    parts.push(section ?? 'Page introuvable');
    if (section) parts.push(siteName || safeDecode(site[1]));
  } else if (path === '/') {
    parts.push(TOP_LEVEL['/sites']);
  } else {
    parts.push(TOP_LEVEL[path] ?? 'Page introuvable');
  }
  return `${parts.join(' — ')} · ${APP_BRAND}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
