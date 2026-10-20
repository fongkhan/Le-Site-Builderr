// Liens saisis dans le CMS pour les boutons d'action (champ `ctaLink` du Hero, des
// formules et des produits) — module pur, sans import.meta, testé depuis le serveur
// (server/tests/unit/cta-links.test.mjs). Mêmes règles que la validation de l'éditeur
// (orchestrator/src/features/cms/lib/ctaLink.ts) :
//  - vide (absent, null, '') : mode Automatique (formulaire du site, voir [...slug].astro) ;
//  - « #id » (lettre puis lettres, chiffres, _ ou -, 64 au plus) : ancre d'un formulaire
//    de LA page ;
//  - « /chemin/ » : page générée du site (segments [A-Za-z0-9_-] séparés par un seul « / »,
//    « / » final facultatif, jamais « // », barre oblique inverse, « .. », « ? » ni « # ») ;
//  - http(s):// (domaine nu « www.x.fr/… » complété en https) : nouvel onglet ;
//  - « tel:… » (chiffres et « + » initial, 3 chiffres au moins) ; « mailto:adresse ».
// Tout le reste est refusé (javascript:, data:, //hôte, identifiants user:pass@…, plus de
// 2048 caractères, caractères de contrôle). Un lien refusé, ou qui vise une page ou une
// ancre absente, n'est jamais rendu : le bouton suit le mode Automatique.

/** Adresse email plausible (sinon affichée sans lien). */
export function safeMailto(email) {
  if (typeof email !== 'string') return '';
  const e = email.trim();
  return /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]+$/.test(e) ? `mailto:${e}` : '';
}

/** Lien « tel: » limité aux chiffres et au « + » initial (sinon affiché sans lien). */
export function safeTel(phone) {
  if (typeof phone !== 'string') return '';
  const digits = phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return /\d{3,}/.test(digits) ? `tel:${digits}` : '';
}

// Domaine nu saisi sans schéma (« www.planity.com/atelier ») : complété en https.
// Même expression que BARE_DOMAIN de src/lib/url.ts (safeHttpUrl).
const BARE_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:[/?#]|$)/i;

const MAX_LENGTH = 2048;
const ANCHOR = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PAGE_PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?)?$/;

/**
 * Lien de bouton analysé, ou null s'il est vide ou refusé :
 * { kind: 'anchor', href } | { kind: 'page', path } (« / » final ajouté) |
 * { kind: 'external', href, newTab } (http(s) en nouvel onglet ; tel: et mailto: non).
 */
export function parseCtaLink(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(raw)) return null;

  if (raw.startsWith('#')) return ANCHOR.test(raw) ? { kind: 'anchor', href: raw } : null;
  if (raw.startsWith('/')) {
    if (!PAGE_PATH.test(raw)) return null;
    return { kind: 'page', path: raw.endsWith('/') ? raw : `${raw}/` };
  }
  if (/^tel:/i.test(raw)) {
    const href = safeTel(raw.slice(4));
    return href ? { kind: 'external', href, newTab: false } : null;
  }
  if (/^mailto:/i.test(raw)) {
    const href = safeMailto(raw.slice(7));
    return href ? { kind: 'external', href, newTab: false } : null;
  }

  let parsed;
  try {
    parsed = new URL(BARE_DOMAIN.test(raw) ? `https://${raw}` : raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  return { kind: 'external', href: parsed.href, newTab: true };
}

/**
 * Lien de bouton prêt pour le rendu ({ href, newTab }), ou null (mode Automatique) :
 * une ancre doit exister sur la page (`anchors` : identifiants sans « # »), une page doit
 * être générée (`routes` : chemins « /…/ » sans chemin de base, préfixés par `withBase`).
 */
export function resolveCtaLink(value, { routes, anchors, withBase = (p) => p } = {}) {
  const link = parseCtaLink(value);
  if (!link) return null;
  if (link.kind === 'anchor') {
    return anchors && anchors.has(link.href.slice(1)) ? { href: link.href, newTab: false } : null;
  }
  if (link.kind === 'page') {
    return routes && routes.has(link.path) ? { href: withBase(link.path), newTab: false } : null;
  }
  return { href: link.href, newTab: link.newTab };
}
