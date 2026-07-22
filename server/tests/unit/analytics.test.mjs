import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateAnalytics } = require('../../lib/analytics.js');

test('validateAnalytics — provider vide réinitialise la configuration', () => {
  const r = validateAnalytics({ provider: '', id: 'G-ABC123', host: 'x.fr' });
  assert.deepEqual(r, { ok: true, value: { analyticsProvider: '', analyticsId: '', analyticsHost: '' } });
});

test('validateAnalytics — GA4 valide (normalisé en majuscules), invalide rejeté', () => {
  const ok = validateAnalytics({ provider: 'GA4', id: ' g-abc12345 ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.analyticsId, 'G-ABC12345');
  assert.equal(ok.value.analyticsHost, '');
  assert.equal(validateAnalytics({ provider: 'ga4', id: 'UA-123456' }).ok, false); // ancien format
  assert.equal(validateAnalytics({ provider: 'ga4', id: 'G-<script>' }).ok, false); // injection
  assert.equal(validateAnalytics({ provider: 'ga4', id: '' }).ok, false);
});

test('validateAnalytics — Matomo : idSite numérique + hôte nettoyé', () => {
  const ok = validateAnalytics({ provider: 'matomo', id: '42', host: 'https://Stats.Mon-Site.FR/' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { analyticsProvider: 'matomo', analyticsId: '42', analyticsHost: 'stats.mon-site.fr' });
  assert.equal(validateAnalytics({ provider: 'matomo', id: 'abc', host: 'stats.x.fr' }).ok, false);
  assert.equal(validateAnalytics({ provider: 'matomo', id: '1', host: 'pas un hôte' }).ok, false);
  assert.equal(validateAnalytics({ provider: 'matomo', id: '1', host: 'stats.x.fr/js"onload=' }).ok, false); // injection
});

test('validateAnalytics — fournisseur inconnu rejeté', () => {
  assert.equal(validateAnalytics({ provider: 'plausible', id: 'x' }).ok, false);
  assert.equal(validateAnalytics({ provider: 42 }).ok, false);
});
