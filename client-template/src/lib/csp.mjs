// Politique de sécurité du contenu (CSP) des sites publiés : configuration
// `security.csp` d'Astro (astro.config.mjs). Astro pose une <meta http-equiv> dans
// chaque page et y ajoute le hachage de chaque script et style qu'il traite : aucun
// 'unsafe-inline'. Conséquence : un `<script is:inline>`, un `define:vars` ou un
// attribut style= serait bloqué (scripts/checks/csp.mjs le détecte au build de la
// fixture). Module pur, testé depuis le serveur (server/tests/unit/site-csp.test.mjs).

// Hôte Matomo : MÊME règle que validateAnalytics (server/lib/analytics.js) — domaine
// simple, sans protocole, chemin, port ni IP.
const ANALYTICS_HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Hôte Matomo valide (forme normalisée par le serveur : minuscules, sans protocole). */
export function isValidAnalyticsHost(host) {
  return typeof host === 'string' && ANALYTICS_HOST.test(host);
}

// GA4, configuration de base seulement (gtag.js + collecte) : Google Signals et la
// publicité (www.google.com, doubleclick.net) restent bloqués.
const GA4_SCRIPT = ['https://*.googletagmanager.com'];
const GA4_CONNECT = ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'];

// Origine http(s) d'une URL ('' sinon : vide, invalide, javascript:…). L'analyseur d'URL
// laisse passer « ; », « ' » ou « , » dans un nom d'hôte : seule une origine faite de
// lettres, chiffres, points, tirets (ou une IPv6) et d'un port est recopiée dans la CSP.
const SAFE_ORIGIN = /^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;
function httpOrigin(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return SAFE_ORIGIN.test(u.origin) ? u.origin : '';
  } catch {
    return '';
  }
}

const unique = (list) => [...new Set(list)];

/**
 * Configuration `security.csp` d'Astro pour un site : même origine par défaut, plus
 * l'hôte de mesure d'audience (GA4 ou Matomo, chargé après consentement) et l'origine
 * de l'API (formulaire de contact, statistiques de visite) quand elle est distincte.
 * Jamais de directive script-src/style-src ici (refusées par Astro) : leurs sources
 * passent par scriptDirective/styleDirective, Astro y ajoute les hachages.
 */
export function sitePolicy({ apiBase = '', analyticsProvider = '', analyticsId = '', analyticsHost = '' } = {}) {
  const api = httpOrigin(apiBase);
  const script = ["'self'"];
  const connect = ["'self'"];
  if (analyticsProvider === 'ga4' && analyticsId) {
    script.push(...GA4_SCRIPT);
    connect.push(...GA4_CONNECT);
  } else if (analyticsProvider === 'matomo' && analyticsId && isValidAnalyticsHost(analyticsHost)) {
    script.push(`https://${analyticsHost}`);
    connect.push(`https://${analyticsHost}`);
  }
  if (api) connect.push(api);
  const formAction = unique(["'self'", ...(api ? [api] : [])]);
  return {
    directives: [
      "default-src 'self'",
      `connect-src ${unique(connect).join(' ')}`,
      "img-src 'self' data: https: http:",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      `form-action ${formAction.join(' ')}`,
    ],
    scriptDirective: { resources: unique(script) },
    styleDirective: { resources: ["'self'"] },
  };
}
