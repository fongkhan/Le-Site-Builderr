import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeSubmission, pruneSubmissions, SUBMISSION_LIMITS } = require('../../lib/submissions.js');

const NOW = new Date('2026-10-01T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

test('pruneSubmissions — supprime les messages au-delà de la rétention', () => {
  const list = [
    { id: 'a', createdAt: daysAgo(1) },
    { id: 'b', createdAt: daysAgo(364) },
    { id: 'c', createdAt: daysAgo(366) },
  ];
  const out = pruneSubmissions(list, NOW);
  assert.deepEqual(out.map((s) => s.id), ['a', 'b']);
  assert.equal(list.length, 3); // entrée d'origine intacte
});

test('pruneSubmissions — plafonne au nombre maximal en gardant les plus récents', () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ id: String(i), createdAt: daysAgo(i) }));
  const out = pruneSubmissions(list.slice().reverse(), NOW, { max: 3 });
  assert.deepEqual(out.map((s) => s.id), ['0', '1', '2']);
  // Plafond par défaut : 500
  const many = Array.from({ length: 520 }, (_, i) => ({ id: String(i), createdAt: daysAgo(i % 300) }));
  assert.equal(pruneSubmissions(many, NOW).length, 500);
});

test('pruneSubmissions — écarte les entrées invalides', () => {
  const out = pruneSubmissions([null, 'texte', 42, { id: 'x' }, { id: 'y', createdAt: 'pas une date' }, { id: 'ok', createdAt: daysAgo(2) }], NOW);
  assert.deepEqual(out.map((s) => s.id), ['ok']);
  assert.deepEqual(pruneSubmissions(null, NOW), []);
  assert.deepEqual(pruneSubmissions({ length: 2 }, NOW), []);
});

test('normalizeSubmission — champs connus, bornés et nettoyés', () => {
  const out = normalizeSubmission({
    kind: 'appointment',
    name: '  Jean\u0000 Dupont  ',
    email: ' jean@exemple.fr ',
    phone: '06 00 00 00 00',
    message: 'Ligne 1\r\nLigne 2\u0007',
    company: 'robot inc',
    read: true,
  });
  assert.deepEqual(out, {
    kind: 'appointment',
    name: 'Jean  Dupont',
    email: 'jean@exemple.fr',
    phone: '06 00 00 00 00',
    message: 'Ligne 1\nLigne 2',
  });
  assert.equal('company' in out, false); // honeypot jamais stocké
});

test('normalizeSubmission — type inconnu, valeurs non textuelles et longueurs maximales', () => {
  const out = normalizeSubmission({ kind: 'spam', name: 12, email: null, message: 'x'.repeat(SUBMISSION_LIMITS.message + 100), phone: '1'.repeat(100) });
  assert.equal(out.kind, 'contact');
  assert.equal(out.name, '');
  assert.equal(out.email, '');
  assert.equal(out.message.length, SUBMISSION_LIMITS.message);
  assert.equal(out.phone.length, SUBMISSION_LIMITS.phone);
  assert.deepEqual(normalizeSubmission(undefined), { kind: 'contact', name: '', email: '', phone: '', message: '' });
});
