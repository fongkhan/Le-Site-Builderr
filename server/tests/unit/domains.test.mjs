import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeDomain, isValidDomain, verifyRecordHost, makeVerifyToken, verifyTxtRecords } = require('../../lib/domains.js');

test('normalizeDomain — retire protocole, www, chemin, port et point final', () => {
  assert.equal(normalizeDomain('  HTTPS://WWW.Mon-Site.FR/contact?x=1  '), 'mon-site.fr');
  assert.equal(normalizeDomain('mon-site.fr:8080'), 'mon-site.fr');
  assert.equal(normalizeDomain('mon-site.fr.'), 'mon-site.fr');
  assert.equal(normalizeDomain(''), '');
  assert.equal(normalizeDomain(null), '');
  assert.equal(normalizeDomain(42), '');
});

test('isValidDomain — accepte un FQDN public, rejette IP/localhost/labels invalides', () => {
  assert.ok(isValidDomain('mon-commerce.fr'));
  assert.ok(isValidDomain('boutique.mon-commerce.co.uk'));
  assert.ok(!isValidDomain('localhost'));
  assert.ok(!isValidDomain('192.168.0.1')); // TLD numérique → rejeté
  assert.ok(!isValidDomain('-mauvais.fr')); // label commence par un tiret
  assert.ok(!isValidDomain('mauvais-.fr'));
  assert.ok(!isValidDomain('sans-point'));
  assert.ok(!isValidDomain('espace .fr'));
  assert.ok(!isValidDomain('a'.repeat(255) + '.fr')); // trop long
});

test('isValidDomain — rejette les sous-domaines du root interne', () => {
  const opts = { rootDomain: 'o2switch.site' };
  assert.ok(!isValidDomain('boulangerie.o2switch.site', opts));
  assert.ok(!isValidDomain('o2switch.site', opts));
  assert.ok(isValidDomain('boulangerie-durand.fr', opts)); // domaine externe → accepté
});

test('verifyRecordHost — sous-domaine TXT dédié', () => {
  assert.equal(verifyRecordHost('mon-site.fr'), '_lesite-verify.mon-site.fr');
});

test('makeVerifyToken — préfixe stable + partie aléatoire', () => {
  const a = makeVerifyToken();
  const b = makeVerifyToken();
  assert.match(a, /^lesite-verify=[0-9a-f]{32}$/);
  assert.notEqual(a, b); // imprévisible
});

test('verifyTxtRecords — reconnaît le jeton, y compris en morceaux', () => {
  const token = 'lesite-verify=abcdef0123456789abcdef0123456789';
  assert.ok(verifyTxtRecords([['autre'], [token]], token));
  // dns.resolveTxt peut découper une valeur longue en plusieurs morceaux
  assert.ok(verifyTxtRecords([['lesite-verify=abcdef0123456789', 'abcdef0123456789']], token));
  assert.ok(!verifyTxtRecords([['lesite-verify=mauvais']], token));
  assert.ok(!verifyTxtRecords([], token));
  assert.ok(!verifyTxtRecords(null, token));
  assert.ok(!verifyTxtRecords([[token]], ''));
});
