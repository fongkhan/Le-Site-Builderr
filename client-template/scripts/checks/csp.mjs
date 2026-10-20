// CSP des sites publiés (security.csp d'Astro, src/lib/csp.mjs) : une <meta http-equiv>
// par page, posée avant toute feuille de style et tout script, sans 'unsafe-inline' ni
// 'unsafe-eval' ; chaque script et style en ligne haché ; aucun attribut style= ni
// gestionnaire on…= (ils seraient bloqués : un futur <script is:inline>, define:vars ou
// style= fait échouer ce contrôle). Sources attendues selon l'environnement du build
// (mêmes variables que le build) : PUBLIC_ANALYTICS_PROVIDER/ID/HOST, PUBLIC_API_BASE,
// ACTIVE_SITE_SLUG.
import crypto from 'node:crypto';

const decode = (v) =>
  v.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m ? decode(m[1]) : null;
};
const hashOf = (content) => `'sha256-${crypto.createHash('sha256').update(content, 'utf8').digest('base64')}'`;
const isJsonLd = (attrs) => /\stype\s*=\s*["']?application\/ld\+json/i.test(attrs);

// Directives d'une politique : nom → sources.
function parsePolicy(policy) {
  const map = new Map();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name.toLowerCase(), sources);
  }
  return map;
}

// Origine http(s) attendue de l'API ('' si absente ou invalide).
function apiOrigin(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : '';
  } catch {
    return '';
  }
}

export default async function ({ dist, htmlFiles, readDist, check }) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const env = process.env;
  const provider = env.PUBLIC_ANALYTICS_PROVIDER || '';
  const analyticsId = env.PUBLIC_ANALYTICS_ID || '';
  const analyticsHost = env.PUBLIC_ANALYTICS_HOST || '';
  const matomo = provider === 'matomo' && Boolean(analyticsId) && Boolean(analyticsHost);
  const ga4 = provider === 'ga4' && Boolean(analyticsId);
  const api = apiOrigin(env.PUBLIC_API_BASE);
  const statsSlug = env.PUBLIC_IS_DRAFT === '1' ? '' : env.ACTIVE_SITE_SLUG || '';
  const beaconUrl = statsSlug ? `${String(env.PUBLIC_API_BASE || '').replace(/\/+$/, '')}/api/stats/hit/${statsSlug}` : '';

  // Sources attendues (indépendantes de src/lib/csp.mjs)
  const analyticsScript = matomo ? [`https://${analyticsHost}`] : ga4 ? ['https://*.googletagmanager.com'] : [];
  const analyticsConnect = matomo
    ? [`https://${analyticsHost}`]
    : ga4 ? ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'] : [];
  const expectedConnect = ["'self'", ...analyticsConnect, ...(api ? [api] : [])];

  for (const file of htmlFiles) {
    const rel = path.relative(dist, file);
    const html = fs.readFileSync(file, 'utf-8');
    const metas = [...html.matchAll(/<meta\b[^>]*\shttp-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi)];
    check(metas.length === 1, `${rel} : ${metas.length} balise(s) <meta http-equiv="content-security-policy"> (1 attendue)`);
    if (metas.length !== 1) continue;
    const metaAt = metas[0].index;
    const policy = attr(metas[0][0], 'content') || '';
    const directives = parsePolicy(policy);
    const scriptSrc = directives.get('script-src') || [];
    const styleSrc = directives.get('style-src') || [];
    const connectSrc = directives.get('connect-src') || [];
    const formAction = directives.get('form-action') || [];

    // Meta avant toute ressource qu'elle doit couvrir (données JSON-LD exceptées)
    const firstGoverned = [...html.matchAll(/<style[\s>]|<link\b[^>]*\srel\s*=\s*["']?stylesheet|<script\b([^>]*)>/gi)]
      .find((m) => !(m[0].startsWith('<script') && isJsonLd(m[1] || '')));
    check(!firstGoverned || metaAt < firstGoverned.index, `${rel} : CSP posée après ${firstGoverned && firstGoverned[0].slice(0, 30)}`);

    // Politique de base
    check((directives.get('default-src') || []).join(' ') === "'self'", `${rel} : default-src 'self' absent (${policy})`);
    check((directives.get('object-src') || []).join(' ') === "'none'", `${rel} : object-src 'none' absent`);
    check((directives.get('base-uri') || []).join(' ') === "'self'", `${rel} : base-uri 'self' absent`);
    check(formAction.includes("'self'"), `${rel} : form-action sans 'self'`);
    check(!/'unsafe-inline'|'unsafe-eval'/i.test(policy), `${rel} : 'unsafe-inline' ou 'unsafe-eval' dans la CSP`);
    check(scriptSrc.includes("'self'") && styleSrc.includes("'self'"), `${rel} : script-src ou style-src sans 'self'`);

    // Chaque script en ligne (hors JSON-LD) et chaque <style> haché
    for (const [, attrs, content] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (isJsonLd(attrs) || /\ssrc\s*=/i.test(attrs)) continue;
      check(scriptSrc.includes(hashOf(content)), `${rel} : script en ligne non haché dans script-src (${content.trim().slice(0, 60)})`);
    }
    for (const [, content] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      check(styleSrc.includes(hashOf(content)), `${rel} : <style> non haché dans style-src (${content.trim().slice(0, 60)})`);
    }

    // Aucun attribut style= ni gestionnaire d'événement en ligne (balises seulement :
    // contenus des scripts, styles et commentaires retirés)
    const markup = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script>')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style>')
      .replace(/<!--[\s\S]*?-->/g, '');
    for (const [tag] of markup.matchAll(/<[a-z][^>]*>/gi)) {
      check(!/\sstyle\s*=/i.test(tag), `${rel} : attribut style= bloqué par la CSP (${tag.slice(0, 80)})`);
      check(!/\son[a-z]+\s*=/i.test(tag), `${rel} : gestionnaire d'événement en ligne bloqué par la CSP (${tag.slice(0, 80)})`);
    }

    // Mesure d'audience : bannière et hôtes autorisés seulement si elle est configurée
    const banner = (html.match(/<div\b[^>]*\sid="consent-banner"[^>]*>/) || [])[0];
    if (matomo || ga4) {
      check(Boolean(banner) && attr(banner, 'data-provider') === provider && attr(banner, 'data-id') === analyticsId,
        `${rel} : bannière de consentement #consent-banner (data-provider="${provider}") absente`);
      if (matomo) check(Boolean(banner) && attr(banner, 'data-host') === analyticsHost, `${rel} : data-host="${analyticsHost}" absent de la bannière`);
    } else {
      check(!banner, `${rel} : bannière de consentement sans mesure d'audience configurée`);
    }
    const remoteScripts = scriptSrc.filter((s) => /^https?:/i.test(s));
    check(remoteScripts.length === analyticsScript.length && analyticsScript.every((s) => remoteScripts.includes(s)),
      `${rel} : sources distantes de script-src « ${remoteScripts.join(' ')} » (attendu « ${analyticsScript.join(' ')} »)`);

    // API : origine autorisée pour fetch/sendBeacon et l'envoi du formulaire sans JavaScript
    check(connectSrc.length === expectedConnect.length && expectedConnect.every((s) => connectSrc.includes(s)),
      `${rel} : connect-src « ${connectSrc.join(' ')} » (attendu « ${expectedConnect.join(' ')} »)`);
    if (api) check(formAction.includes(api), `${rel} : origine de l'API ${api} absente de form-action`);
    else check(formAction.join(' ') === "'self'", `${rel} : form-action « ${formAction.join(' ')} » (attendu 'self' seul)`);

    // Statistique de visite : adresse en data-url (jamais de define:vars)
    const beacon = (html.match(/<span\b[^>]*\sid="stats-beacon"[^>]*>/) || [])[0];
    if (beaconUrl) check(Boolean(beacon) && attr(beacon, 'data-url') === beaconUrl, `${rel} : #stats-beacon data-url="${beaconUrl}" absent`);
    else check(!beacon, `${rel} : #stats-beacon sans site actif (ACTIVE_SITE_SLUG)`);
  }

  // Fond du Hero : <img> sous le voile, jamais un style en ligne
  check(readDist('index.html').includes('<img class="hero-bg"'), 'index.html : image de fond du Hero (<img class="hero-bg">) absente');
}
