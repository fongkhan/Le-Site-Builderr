import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isValidAnalyticsHost, sitePolicy } from '../../../client-template/src/lib/csp.mjs';
import { CONSENT_KEY, CONSENT_MAX_AGE_MS, analyticsScriptUrl, matomoTrackerUrl, readConsentChoice } from '../../../client-template/src/lib/consent.mjs';

const require = createRequire(import.meta.url);
const { validateAnalytics } = require('../../lib/analytics.js');

// CSP des sites publiés (configuration security.csp d'Astro) et consentement RGPD.
const TEMPLATE_SRC = new URL('../../../client-template/src/', import.meta.url);

// Directive → sources (« connect-src 'self' https://x » → ["'self'", 'https://x'])
const directivesOf = (policy) => new Map(policy.directives.map((d) => {
  const [name, ...sources] = d.trim().split(/\s+/);
  return [name, sources];
}));

// Une source CSP autorise-t-elle cette origine ? (joker « *. » sur le nom d'hôte)
function sourceAllows(source, origin) {
  if (source === origin) return true;
  const m = /^(https?):\/\/\*\.(.+)$/.exec(source);
  if (!m) return false;
  const u = new URL(origin);
  return u.protocol === `${m[1]}:` && u.hostname.endsWith(`.${m[2]}`);
}

// Directives acceptées par Astro dans security.csp.directives (script-src et style-src
// en sont exclues : Astro refuse le build)
const ASTRO_DIRECTIVES = ['base-uri', 'child-src', 'connect-src', 'default-src', 'fenced-frame-src', 'font-src', 'form-action', 'frame-ancestors', 'frame-src', 'img-src', 'manifest-src', 'media-src', 'object-src', 'referrer', 'report-to', 'report-uri', 'require-trusted-types-for', 'sandbox', 'trusted-types', 'upgrade-insecure-requests', 'worker-src'];

const SAMPLES = [
  {},
  { apiBase: 'https://api.exemple.fr' },
  { analyticsProvider: 'ga4', analyticsId: 'G-ABC123' },
  { analyticsProvider: 'matomo', analyticsId: '3', analyticsHost: 'stats.exemple.fr', apiBase: 'http://localhost:4000' },
  { analyticsProvider: 'matomo', analyticsId: '3', analyticsHost: "stats.x.fr; script-src * 'unsafe-inline'" },
];

test('sitePolicy — sans paramètre : même origine seulement', () => {
  const policy = sitePolicy();
  const d = directivesOf(policy);
  assert.deepEqual(d.get('default-src'), ["'self'"]);
  assert.deepEqual(d.get('connect-src'), ["'self'"]);
  assert.deepEqual(d.get('form-action'), ["'self'"]);
  assert.deepEqual(d.get('object-src'), ["'none'"]);
  assert.deepEqual(d.get('base-uri'), ["'self'"]);
  assert.deepEqual(d.get('img-src'), ["'self'", 'data:', 'https:', 'http:']);
  assert.deepEqual(d.get('font-src'), ["'self'", 'data:']);
  assert.deepEqual(policy.scriptDirective, { resources: ["'self'"] });
  assert.deepEqual(policy.styleDirective, { resources: ["'self'"] });
  // Valeurs d'environnement absentes (undefined) : identique
  assert.deepEqual(sitePolicy({ apiBase: undefined, analyticsProvider: undefined, analyticsId: undefined, analyticsHost: undefined }), policy);
});

test('sitePolicy — origine de l’API autorisée (fetch, beacon, formulaire sans JavaScript)', () => {
  const d = directivesOf(sitePolicy({ apiBase: 'https://api.exemple.fr/x/' }));
  assert.deepEqual(d.get('connect-src'), ["'self'", 'https://api.exemple.fr']);
  assert.deepEqual(d.get('form-action'), ["'self'", 'https://api.exemple.fr']);
  assert.deepEqual(directivesOf(sitePolicy({ apiBase: 'http://localhost:4000' })).get('connect-src'), ["'self'", 'http://localhost:4000']);
});

test('sitePolicy — adresse d’API invalide ou hostile ignorée', () => {
  for (const apiBase of ['javascript:alert(1)', 'pas une url', 'data:text/html,x', 'https://a;script-src/x', "https://a'b.fr", 'https://a,b.fr', '   ']) {
    const d = directivesOf(sitePolicy({ apiBase }));
    assert.deepEqual(d.get('connect-src'), ["'self'"], apiBase);
    assert.deepEqual(d.get('form-action'), ["'self'"], apiBase);
  }
});

test('sitePolicy — Matomo : hôte autorisé en script et connexion', () => {
  const policy = sitePolicy({ analyticsProvider: 'matomo', analyticsId: '3', analyticsHost: 'stats.exemple.fr' });
  assert.deepEqual(policy.scriptDirective.resources, ["'self'", 'https://stats.exemple.fr']);
  assert.deepEqual(directivesOf(policy).get('connect-src'), ["'self'", 'https://stats.exemple.fr']);
  // Sans identifiant : rien n'est chargé, rien n'est autorisé
  assert.deepEqual(sitePolicy({ analyticsProvider: 'matomo', analyticsId: '', analyticsHost: 'stats.exemple.fr' }).scriptDirective.resources, ["'self'"]);
});

test('sitePolicy — hôte Matomo hostile : nulle part dans la politique', () => {
  for (const analyticsHost of ['stats.x.fr; script-src *', 'stats.x.fr *', 'https://stats.x.fr', 'stats.x.fr/chemin', '127.0.0.1', '']) {
    const policy = sitePolicy({ analyticsProvider: 'matomo', analyticsId: '3', analyticsHost });
    const all = JSON.stringify(policy);
    assert.ok(!all.includes('stats.x.fr') && !all.includes('127.0.0.1'), analyticsHost);
    assert.ok(!/\s\*(\s|"|$)|"\*"/.test(all), analyticsHost);
    assert.deepEqual(policy.scriptDirective.resources, ["'self'"], analyticsHost);
    assert.deepEqual(directivesOf(policy).get('connect-src'), ["'self'"], analyticsHost);
  }
});

test('sitePolicy — GA4 : configuration de base seulement', () => {
  const policy = sitePolicy({ analyticsProvider: 'ga4', analyticsId: 'G-ABC123' });
  assert.deepEqual(policy.scriptDirective.resources, ["'self'", 'https://*.googletagmanager.com']);
  assert.deepEqual(directivesOf(policy).get('connect-src'), ["'self'", 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com']);
  assert.ok(!JSON.stringify(policy).includes('doubleclick'));
  assert.deepEqual(sitePolicy({ analyticsProvider: 'ga4', analyticsId: '' }).scriptDirective.resources, ["'self'"]);
});

test('sitePolicy — jamais script-src/style-src dans directives ni de source permissive', () => {
  for (const sample of SAMPLES) {
    const policy = sitePolicy(sample);
    for (const directive of policy.directives) {
      assert.ok(ASTRO_DIRECTIVES.includes(directive.split(/\s+/)[0]), `${directive} (refusée par Astro)`);
      assert.ok(!/^(script|style)-src/.test(directive), directive);
    }
    const all = JSON.stringify(policy);
    assert.ok(!all.includes('unsafe-inline') && !all.includes('unsafe-eval'), all);
    for (const source of [...policy.scriptDirective.resources, ...policy.styleDirective.resources]) {
      assert.ok(source === "'self'" || /^https:\/\/(\*\.)?[a-z0-9.-]+$/.test(source), source);
    }
  }
});

test('sitePolicy — le script chargé après consentement est autorisé par la CSP', () => {
  const cases = [
    { provider: 'ga4', id: 'G-ABC123', host: '' },
    { provider: 'matomo', id: '3', host: 'stats.exemple.fr' },
  ];
  for (const { provider, id, host } of cases) {
    const url = analyticsScriptUrl({ provider, id, host });
    assert.ok(url.startsWith('https://'), url);
    const { origin } = new URL(url);
    const policy = sitePolicy({ analyticsProvider: provider, analyticsId: id, analyticsHost: host });
    assert.ok(policy.scriptDirective.resources.some((s) => sourceAllows(s, origin)), `${origin} refusé`);
    // La collecte (Matomo : matomo.php ; GA4 : *.google-analytics.com) est autorisée en connexion
    const collect = provider === 'matomo' ? new URL(matomoTrackerUrl(host)).origin : 'https://region1.google-analytics.com';
    assert.ok(directivesOf(policy).get('connect-src').some((s) => sourceAllows(s, collect)), `${collect} refusé`);
  }
  // Comparateur : le joker ne couvre ni le domaine nu ni un domaine voisin
  assert.equal(sourceAllows('https://*.googletagmanager.com', 'https://googletagmanager.com'), false);
  assert.equal(sourceAllows('https://*.googletagmanager.com', 'https://evilgoogletagmanager.com'), false);
  assert.equal(sourceAllows('https://*.googletagmanager.com', 'http://www.googletagmanager.com'), false);
});

test('analyticsScriptUrl / matomoTrackerUrl — adresses des scripts de mesure', () => {
  assert.equal(analyticsScriptUrl({ provider: 'ga4', id: 'G-ABC123' }), 'https://www.googletagmanager.com/gtag/js?id=G-ABC123');
  assert.equal(analyticsScriptUrl({ provider: 'ga4', id: 'G-A&B' }), 'https://www.googletagmanager.com/gtag/js?id=G-A%26B');
  assert.equal(analyticsScriptUrl({ provider: 'matomo', id: '3', host: 'stats.exemple.fr' }), 'https://stats.exemple.fr/matomo.js');
  assert.equal(analyticsScriptUrl({ provider: 'matomo', id: '3', host: 'evil.fr/x?' }), '');
  assert.equal(analyticsScriptUrl({ provider: 'matomo', id: '', host: 'stats.exemple.fr' }), '');
  assert.equal(analyticsScriptUrl({ provider: '', id: '3' }), '');
  assert.equal(analyticsScriptUrl(), '');
  assert.equal(matomoTrackerUrl('stats.exemple.fr'), 'https://stats.exemple.fr/matomo.php');
});

test('isValidAnalyticsHost — même règle que validateAnalytics (server/lib/analytics.js)', () => {
  // Hôtes déjà normalisés (minuscules, sans protocole : forme stockée par le serveur)
  const hosts = ['stats.exemple.fr', 'a.fr', 'matomo.mon-site.co.uk', 'x.y', '-bad.fr', 'bad-.fr', 'sans-point', 'stats.x.fr; script-src *',
    '127.0.0.1', 'stats.exemple.fr:8080', 'stats.exemple.fr/chemin', 'Ã©.fr', `${'a'.repeat(64)}.fr`, `${'a.'.repeat(130)}fr`, ''];
  for (const host of hosts) {
    assert.equal(isValidAnalyticsHost(host), validateAnalytics({ provider: 'matomo', id: '1', host }).ok, host);
  }
  // Toute valeur acceptée par le serveur (après normalisation) est valide pour le template
  for (const host of ['https://Stats.Mon-Site.FR/', ' STATS.EXEMPLE.FR ', 'http://a.fr']) {
    const r = validateAnalytics({ provider: 'matomo', id: '1', host });
    assert.equal(r.ok, true, host);
    assert.equal(isValidAnalyticsHost(r.value.analyticsHost), true, host);
  }
  assert.equal(isValidAnalyticsHost(undefined), false);
  assert.equal(isValidAnalyticsHost(42), false);
});

test('bannière de consentement seulement si un script de mesure est chargeable (règle de la CSP)', () => {
  // Hôte non normalisé (saisie de l'admin Payload) : rien n'est autorisé ni chargé, donc
  // ni bannière ni bouton « Cookies » (Layout.astro dérive analyticsEnabled du script)
  const layout = fs.readFileSync(new URL('layouts/Layout.astro', TEMPLATE_SRC), 'utf-8');
  assert.match(layout, /const analyticsEnabled = Boolean\(analyticsScriptUrl\(\{ provider: analyticsProvider, id: analyticsId, host: analyticsHost \}\)\);/);
  const cases = [
    ['matomo', '3', 'stats.exemple.fr'], ['matomo', '3', 'Stats.Exemple.fr'], ['matomo', '3', 'stats.exemple.fr/'],
    ['matomo', '3', 'https://stats.exemple.fr'], ['matomo', '', 'stats.exemple.fr'], ['ga4', 'G-ABC123', ''], ['ga4', '', ''], ['', '3', 'stats.exemple.fr'],
  ];
  for (const [provider, id, host] of cases) {
    const loads = Boolean(analyticsScriptUrl({ provider, id, host }));
    const remote = sitePolicy({ analyticsProvider: provider, analyticsId: id, analyticsHost: host }).scriptDirective.resources.filter((s) => s !== "'self'");
    assert.equal(loads, remote.length > 0, `${provider} ${id} ${host}`);
  }
});

test('readConsentChoice — choix mémorisé, illisible ou expiré', () => {
  const now = Date.UTC(2026, 9, 20);
  const raw = (value, at) => JSON.stringify({ value, at });
  assert.equal(CONSENT_KEY, 'lesite-consent');
  assert.equal(CONSENT_MAX_AGE_MS, 182 * 24 * 60 * 60 * 1000);
  assert.equal(readConsentChoice(raw('accepted', now - 1000), now), 'accepted');
  assert.equal(readConsentChoice(raw('refused', now - CONSENT_MAX_AGE_MS), now), 'refused');
  assert.equal(readConsentChoice(raw('accepted', now - CONSENT_MAX_AGE_MS - 1), now), null); // > 182 jours
  assert.equal(readConsentChoice(raw('accepted'), now), null); // sans date
  assert.equal(readConsentChoice(raw('peut-être', now), now), null);
  for (const bad of ['{pas du json', 'null', '42', '"accepted"', '', null, undefined]) {
    assert.equal(readConsentChoice(bad, now), null, String(bad));
  }
});

test('bannière et beacon : scripts traités par Astro, gtag inchangé', () => {
  const read = (rel) => fs.readFileSync(new URL(rel, TEMPLATE_SRC), 'utf-8');
  // gtag.js exige l'objet arguments lui-même (une réécriture en (...args) casse GA4)
  assert.ok(read('components/site/consent-banner.ts').includes('function gtag(){ window.dataLayer.push(arguments) }'));
  const banner = read('components/site/ConsentBanner.astro');
  assert.match(banner, /<script>\s*import \{ initConsent \} from '\.\/consent-banner';\s*initConsent\(\);\s*<\/script>/);
  assert.match(read('components/site/StatsBeacon.astro'), /<span id="stats-beacon" data-url=\{url\} hidden><\/span>/);
});

test('template : aucun script en ligne ni style= que la CSP bloquerait', () => {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.astro')) files.push(full);
    }
  })(new URL(TEMPLATE_SRC).pathname);
  assert.ok(files.length > 10);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf-8');
    const rel = path.relative(new URL(TEMPLATE_SRC).pathname, file);
    assert.ok(!/<(script|style)\b[^>]*\s(define:vars|is:inline)\b/.test(src), `${rel} : define:vars ou is:inline (script ou style non haché, bloqué par la CSP)`);
    assert.ok(!/<[a-zA-Z][^>]*\sstyle=/.test(src), `${rel} : attribut style= (bloqué par la CSP)`);
  }
});
