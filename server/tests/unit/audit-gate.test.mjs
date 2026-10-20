import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAdvisories, evaluateAudit, validateAllowlist } from '../../../scripts/audit-gate.mjs';

// Garde d'audit (scripts/audit-gate.mjs) : logique pure, rapports « npm audit --json » factices.
const TODAY = '2026-10-20';
const advisory = (name, id, severity, title = 'faille') => ({ source: 1, name, dependency: name, title, url: `https://github.com/advisories/${id}`, severity, range: '<9' });
const AUDIT = {
  auditReportVersion: 2,
  vulnerabilities: {
    braces: { name: 'braces', severity: 'high', via: [advisory('braces', 'GHSA-aaaa-bbbb-cccc', 'high')], nodes: ['node_modules/braces'] },
    chokidar: { name: 'chokidar', severity: 'high', via: ['braces'], nodes: ['node_modules/chokidar'] },
    sass: { name: 'sass', severity: 'high', via: ['chokidar', advisory('braces', 'GHSA-aaaa-bbbb-cccc', 'high')], nodes: ['node_modules/sass'] },
    next: { name: 'next', severity: 'critical', via: [advisory('next', 'GHSA-nnnn-1111-2222', 'critical', 'RCE'), advisory('next', 'GHSA-mmmm-3333-4444', 'moderate')], nodes: ['node_modules/next'] },
  },
};
const entry = (over = {}) => ({ package: 'braces', ids: ['GHSA-aaaa-bbbb-cccc'], nodes: ['node_modules/braces'], reason: 'justifié', expires: '2027-01-31', ...over });

test('collectAdvisories — objets via[] seulement, identifiant GHSA, emplacements du paquet, dédoublonnage', () => {
  const list = collectAdvisories(AUDIT);
  assert.equal(list.length, 3);
  const braces = list.find((a) => a.package === 'braces');
  assert.deepEqual(braces, { package: 'braces', id: 'GHSA-aaaa-bbbb-cccc', severity: 'high', title: 'faille', nodes: ['node_modules/braces'] });
  assert.ok(list.some((a) => a.id === 'GHSA-nnnn-1111-2222' && a.severity === 'critical' && a.nodes[0] === 'node_modules/next'));
  assert.deepEqual(collectAdvisories({}), []);
});

test('evaluateAudit — avis élevé ou critique non listé : bloquant ; modéré : ignoré', () => {
  const { blocking, allowed } = evaluateAudit(collectAdvisories(AUDIT), [entry()], TODAY);
  assert.deepEqual(blocking.map((b) => [b.package, b.id, b.raison]), [['next', 'GHSA-nnnn-1111-2222', 'non listé']]);
  assert.deepEqual(allowed.map((a) => a.id), ['GHSA-aaaa-bbbb-cccc']);
  assert.ok(!blocking.concat(allowed).some((a) => a.id === 'GHSA-mmmm-3333-4444'));
});

test('evaluateAudit — exception valide : avis autorisé jusqu\'à la date d\'expiration incluse', () => {
  const advisories = collectAdvisories(AUDIT).filter((a) => a.package === 'braces');
  assert.equal(evaluateAudit(advisories, [entry({ expires: TODAY })], TODAY).blocking.length, 0);
  assert.equal(evaluateAudit(advisories, [entry()], TODAY).allowed[0].expires, '2027-01-31');
});

test('evaluateAudit — exception expirée : bloquant avec la date', () => {
  const advisories = collectAdvisories(AUDIT).filter((a) => a.package === 'braces');
  const { blocking } = evaluateAudit(advisories, [entry({ expires: '2026-10-19' })], TODAY);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].raison, 'exception expirée le 2026-10-19');
});

test('evaluateAudit — emplacements différents (nouvelle copie vulnérable) : bloquant', () => {
  const advisories = [{ package: 'braces', id: 'GHSA-aaaa-bbbb-cccc', severity: 'high', title: '', nodes: ['node_modules/braces', 'node_modules/x/node_modules/braces'] }];
  assert.equal(evaluateAudit(advisories, [entry()], TODAY).blocking[0].raison, 'non listé');
  // Sans « nodes », l'exception couvre tous les emplacements
  assert.equal(evaluateAudit(advisories, [entry({ nodes: undefined })], TODAY).blocking.length, 0);
});

test('evaluateAudit — exception ou identifiant sans avis correspondant : à retirer (unused)', () => {
  const advisories = collectAdvisories(AUDIT).filter((a) => a.package === 'braces');
  const sharp = { package: 'sharp', ids: ['GHSA-s1', 'GHSA-s2'], nodes: ['node_modules/sharp'], reason: 'x', expires: '2027-01-31' };
  const { unused } = evaluateAudit(advisories, [entry({ ids: ['GHSA-aaaa-bbbb-cccc', 'GHSA-corrige'] }), sharp], TODAY);
  assert.deepEqual(unused, [
    { package: 'braces', ids: ['GHSA-corrige'], nodes: ['node_modules/braces'] },
    { package: 'sharp', ids: ['GHSA-s1', 'GHSA-s2'], nodes: ['node_modules/sharp'] },
  ]);
});

test('validateAllowlist — liste du dépôt valide', () => {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../security/audit-allowlist.json');
  assert.deepEqual(validateAllowlist(JSON.parse(fs.readFileSync(file, 'utf8')), TODAY), []);
});

test('validateAllowlist — champs obligatoires, date AAAA-MM-JJ, six mois maximum', () => {
  assert.deepEqual(validateAllowlist({ server: [entry()], orchestrator: [], 'client-template': [] }, TODAY), []);
  const errors = validateAllowlist({
    server: [
      entry({ package: '' }),
      entry({ ids: [] }),
      entry({ reason: ' ' }),
      entry({ expires: undefined }),
      entry({ expires: '31/01/2027' }),
      entry({ expires: '2027-02-30' }),
      entry({ expires: '2027-04-22' }),
      entry({ nodes: [] }),
    ],
    serveur: [],
  }, TODAY);
  assert.equal(errors.length, 9, errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('paquet (package) manquant')));
  assert.ok(errors.some((e) => e.includes('identifiants des avis (ids) manquants')));
  assert.ok(errors.some((e) => e.includes('justification (reason) manquante')));
  assert.equal(errors.filter((e) => e.includes("date d'expiration (expires, AAAA-MM-JJ)")).length, 3);
  assert.ok(errors.some((e) => e.includes('trop lointaine') && e.includes('2027-04-21')));
  assert.ok(errors.some((e) => e.includes('emplacements (nodes) invalides')));
  assert.ok(errors.some((e) => e.includes('Projet inconnu « serveur »')));
  assert.deepEqual(validateAllowlist({ server: [entry({ expires: '2027-04-21' })] }, TODAY), []);
  assert.equal(validateAllowlist([], TODAY).length, 1);
});
