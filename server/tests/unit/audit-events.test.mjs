import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ev = require('../../lib/audit-events.js');

// Champs sensibles présents dans un vrai document Payload : jamais lus ni écrits
const SECRETS = {
  password: 'Secret-Mot-De-Passe-1!',
  hash: 'HASH-SECRET',
  salt: 'SALT-SECRET',
  resetPasswordToken: 'TOKEN-SECRET',
  sessions: [{ id: 'SESSION-SECRET' }],
  loginAttempts: 3,
  lockUntil: '2099-01-01',
};
const user = (extra = {}) => ({ email: 'jean@exemple.fr', roles: ['client'], plan: 'free', aiDailyQuota: null, sites: [], ...SECRETS, ...extra });

test('userChangeSummary — aucun changement : chaîne vide', () => {
  assert.equal(ev.userChangeSummary(user(), user()), '');
  assert.equal(ev.userChangeSummary(user({ hash: 'a' }), user({ hash: 'b', salt: 'c', resetPasswordToken: 'x' })), '');
});

test('userChangeSummary — offre, quota, email', () => {
  assert.equal(ev.userChangeSummary(user(), user({ plan: 'pro' })), 'plan=free→pro');
  assert.equal(ev.userChangeSummary(user(), user({ aiDailyQuota: 20 })), 'aiDailyQuota=∅→20');
  assert.equal(ev.userChangeSummary(user({ aiDailyQuota: 5 }), user({ aiDailyQuota: 0 })), 'aiDailyQuota=5→0');
  assert.equal(ev.userChangeSummary(user(), user({ email: 'paul@exemple.fr' })), 'email=jean@exemple.fr→paul@exemple.fr');
  assert.equal(ev.userChangeSummary(user({ plan: null }), user({ plan: 'agency' })), 'plan=∅→agency');
});

test('userChangeSummary — rôles triés, ordre non significatif', () => {
  assert.equal(ev.userChangeSummary(user({ roles: ['client', 'admin'] }), user({ roles: ['admin', 'client'] })), '');
  assert.equal(ev.userChangeSummary(user(), user({ roles: ['client', 'admin'] })), 'roles=client→admin,client');
  assert.equal(ev.userChangeSummary(user({ roles: [] }), user()), 'roles=∅→client');
});

test('userChangeSummary — sites : ids et relations peuplées comparés, libellés', () => {
  assert.equal(ev.userChangeSummary(user({ sites: [1] }), user({ sites: [{ id: 1, slug: 'a' }] })), '');
  assert.equal(ev.userChangeSummary(user({ sites: [1] }), user({ sites: [2] }), { siteLabels: { 1: 'a', 2: 'b' } }), 'sites=+[b] -[a]');
  assert.equal(ev.userChangeSummary(user({ sites: [1] }), user({ sites: [1, { id: 3, slug: 'c' }] })), 'sites=+[c]');
  assert.equal(ev.userChangeSummary(user({ sites: [1, 9] }), user({ sites: [1] })), 'sites=-[#9]');
  assert.equal(ev.userChangeSummary(user({ sites: [] }), user({ sites: [{ id: 2, slug: 'zz' }, { id: 1, slug: 'aa' }] })), 'sites=+[aa,zz]');
});

test('userChangeSummary — mot de passe : mention sans valeur, ordre des parties', () => {
  const out = ev.userChangeSummary(user(), user({ plan: 'pro', roles: ['admin'], password: 'Nouveau-Cheval-43?' }), { passwordChanged: true });
  assert.equal(out, 'roles=client→admin ; plan=free→pro ; motdepasse=modifié');
  for (const secret of ['Nouveau-Cheval-43?', 'Secret-Mot-De-Passe-1!', 'HASH-SECRET', 'SALT-SECRET', 'TOKEN-SECRET', 'SESSION-SECRET', '2099']) {
    assert.ok(!out.includes(secret), secret);
  }
});

test('userCreationSummary — rôles, offre, sites, quota', () => {
  assert.equal(ev.userCreationSummary(user({ sites: [{ id: 1, slug: 'boulangerie-artisanale' }] })), 'roles=client ; plan=free ; sites=[boulangerie-artisanale]');
  assert.equal(ev.userCreationSummary(user({ roles: ['admin'], sites: [] })), 'roles=admin ; plan=free');
  assert.equal(ev.userCreationSummary(user({ sites: [4], aiDailyQuota: 5 }), { 4: 'd' }), 'roles=client ; plan=free ; sites=[d] ; aiDailyQuota=5');
  const out = ev.userCreationSummary(user());
  for (const secret of Object.values(SECRETS).flat().map((v) => (typeof v === 'object' ? v.id : String(v)))) assert.ok(!out.includes(secret), secret);
});

test('maskEmail — partie locale masquée, domaine conservé', () => {
  assert.equal(ev.maskEmail('lot1-inconnu@nulle-part.example'), 'lo***@nulle-part.example');
  assert.equal(ev.maskEmail('a@b.fr'), 'a***@b.fr');
  assert.equal(ev.maskEmail('ab@b.fr'), 'a***@b.fr');
  assert.equal(ev.maskEmail('  Jean@Exemple.FR '), 'je***@exemple.fr');
  assert.equal(ev.maskEmail('motdepasse123'), '(identifiant non valide)');
  assert.equal(ev.maskEmail('a b@c.fr'), '(identifiant non valide)');
  assert.equal(ev.maskEmail(undefined), '(vide)');
  assert.equal(ev.maskEmail('   '), '(vide)');
  assert.ok(ev.maskEmail(`ab@${'x'.repeat(200)}.fr`).length <= 120);
  // Saisie démesurée : refusée sans évaluer l'expression régulière sur toute la chaîne
  assert.equal(ev.maskEmail(`a@${'a.'.repeat(50000)} `), '(identifiant non valide)');
});

test('auditActor — compte connecté, anonyme HTTP, système', () => {
  assert.equal(ev.auditActor({ user: { email: 'a@b.fr' }, payloadAPI: 'REST' }), 'a@b.fr');
  assert.equal(ev.auditActor({ user: null, payloadAPI: 'REST' }), 'anonyme');
  assert.equal(ev.auditActor({ payloadAPI: 'local' }), 'système');
  assert.equal(ev.auditActor({ headers: {} }), 'système'); // requête Express sans session
  assert.equal(ev.auditActor(undefined), 'système');
});

test('parseAuditQuery — valeurs par défaut', () => {
  assert.deepEqual(ev.parseAuditQuery({}), { page: 1, limit: 50, where: undefined });
  assert.deepEqual(ev.parseAuditQuery(undefined), { page: 1, limit: 50, where: undefined });
});

test('parseAuditQuery — page et limit bornés', () => {
  assert.equal(ev.parseAuditQuery({ limit: '200' }).limit, 200);
  assert.equal(ev.parseAuditQuery({ page: '3', limit: '1' }).page, 3);
  for (const limit of ['0', '201', 'abc', '-1', '1.5']) {
    assert.equal(ev.parseAuditQuery({ limit }).error, 'Paramètre « limit » invalide (1 à 200).', limit);
  }
  for (const page of ['0', '100001', 'x']) assert.equal(ev.parseAuditQuery({ page }).error, 'Paramètre « page » invalide.', page);
});

test('parseAuditQuery — filtres action, target, actor', () => {
  assert.deepEqual(ev.parseAuditQuery({ action: 'connexion.' }).where, { and: [{ action: { contains: 'connexion.' } }] });
  assert.deepEqual(ev.parseAuditQuery({ action: 'utilisateur.,motdepasse.' }).where, {
    and: [{ or: [{ action: { contains: 'utilisateur.' } }, { action: { contains: 'motdepasse.' } }] }],
  });
  assert.deepEqual(ev.parseAuditQuery({ action: ' , ' }).where, undefined);
  for (const action of ['%', 'A', 'site.%', 'a,'.repeat(11)]) assert.equal(ev.parseAuditQuery({ action }).error, 'Filtre « action » invalide.', action);
  assert.deepEqual(ev.parseAuditQuery({ target: '  boulangerie-artisanale ' }).where, { and: [{ target: { equals: 'boulangerie-artisanale' } }] });
  assert.deepEqual(ev.parseAuditQuery({ actor: 'admin@admin.com', action: 'site.' }).where, {
    and: [{ action: { contains: 'site.' } }, { actor: { equals: 'admin@admin.com' } }],
  });
  assert.equal(ev.parseAuditQuery({ target: 'x'.repeat(255) }).error, 'Filtre « target » invalide.');
  // Tableau ou objet (syntaxe qs) refusés
  assert.equal(ev.parseAuditQuery({ target: ['a', 'b'] }).error, 'Filtre « target » invalide.');
  assert.equal(ev.parseAuditQuery({ actor: { equals: 'x' } }).error, 'Filtre « actor » invalide.');
  assert.equal(ev.parseAuditQuery({ action: ['site.'] }).error, 'Filtre « action » invalide.');
  assert.equal(ev.parseAuditQuery({ limit: ['1'] }).error, 'Paramètre « limit » invalide (1 à 200).');
});

test('parseRetentionDays / retentionCutoff', () => {
  assert.equal(ev.parseRetentionDays(''), 365);
  assert.equal(ev.parseRetentionDays(undefined), 365);
  assert.equal(ev.parseRetentionDays('0'), 0);
  assert.equal(ev.parseRetentionDays('30'), 30);
  for (const raw of ['-1', '3.5', 'abc']) assert.equal(ev.parseRetentionDays(raw), 365, raw);
  assert.equal(ev.parseRetentionDays('abc', 10), 10);
  const now = Date.parse('2026-10-20T12:00:00.000Z');
  assert.equal(ev.retentionCutoff(30, now), '2026-09-20T12:00:00.000Z');
  assert.equal(ev.retentionCutoff(0, now), null);
  // Durée démesurée : rien ne peut être plus ancien, aucune exception
  assert.equal(ev.retentionCutoff(ev.parseRetentionDays('99999999999'), now), null);
});

test('shouldAuditLogin — admins toujours, clients avec AUDIT_LOGINS=true', () => {
  assert.equal(ev.shouldAuditLogin({ roles: ['admin'] }, {}), true);
  assert.equal(ev.shouldAuditLogin({ roles: ['client'] }, {}), false);
  assert.equal(ev.shouldAuditLogin({ roles: ['client'] }, { AUDIT_LOGINS: 'true' }), true);
  assert.equal(ev.shouldAuditLogin(null, {}), false);
});

test('themeChangeSummary — rayon, couleur, logo, identique', () => {
  const base = { colors: { primary: '#111111', secondary: '#222222', background: '#ffffff', text: '#000000' }, fonts: { heading: 'Inter', body: 'Inter' }, radius: '13px' };
  assert.equal(ev.themeChangeSummary(base, { ...base, radius: '12px' }), 'rayon=13px→12px');
  assert.equal(ev.themeChangeSummary(base, { ...base, colors: { ...base.colors, primary: '#8B5A2B' } }), 'couleur.primary=#111111→#8B5A2B');
  assert.equal(ev.themeChangeSummary(base, { ...base, logo: '/api/media/file/logo.png' }), 'logo=∅→/api/media/file/logo.png');
  assert.equal(ev.themeChangeSummary(base, { ...base, fonts: { heading: 'Lora', body: 'Inter' } }), 'police.heading=Inter→Lora');
  assert.equal(ev.themeChangeSummary(base, structuredClone(base)), '');
  assert.equal(ev.themeChangeSummary(undefined, { radius: '4px' }), 'rayon=∅→4px');
});

test('writeAudit — troncatures, accès forcé, jamais de req', async () => {
  const calls = [];
  const payload = { create: async (args) => { calls.push(args); return { id: 1 }; } };
  assert.equal(await ev.writeAudit(payload, { action: 'x.y', actor: 'a@b.fr', target: 't'.repeat(300), details: 'd'.repeat(2000) }), true);
  assert.equal(calls.length, 1);
  const [args] = calls;
  assert.equal(args.collection, 'audit_logs');
  assert.equal(args.overrideAccess, true);
  assert.ok(!('req' in args));
  assert.equal(args.data.target.length, 254);
  assert.equal(args.data.details.length, 1000);
  assert.equal(args.data.actor, 'a@b.fr');
  await ev.writeAudit(payload, { action: 'x.z' });
  assert.deepEqual(calls[1].data, { action: 'x.z', actor: 'système', target: '', details: '' });
});

test('writeAudit — sans Payload ou en échec : false, jamais d’exception', async () => {
  assert.equal(await ev.writeAudit(null, { action: 'x' }), false);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    assert.equal(await ev.writeAudit({ create: async () => { throw new Error('base indisponible'); } }, { action: 'x' }), false);
    assert.equal(await ev.writeAudit({ create: () => { throw new Error('synchrone'); } }, { action: 'x' }), false);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Audit non enregistré/);
});

test('auditInBackground — la tâche démarre après le retour de l’appelant, sans rejet', async () => {
  const order = [];
  ev.auditInBackground(async () => { order.push('tâche'); });
  order.push('hook terminé');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['hook terminé', 'tâche']);
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    ev.auditInBackground(() => { throw new Error('boom'); });
    ev.auditInBackground(async () => { throw new Error('boom async'); });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Audit non enregistré/);
});

test('siteLabelsFor — objets sans requête, ids restants en une requête, échec → partiel', async () => {
  let finds = 0;
  const payload = {
    find: async (args) => {
      finds++;
      assert.equal(args.collection, 'payload_sites');
      assert.equal(args.overrideAccess, true);
      assert.deepEqual(args.where.id.in.map(String).sort(), ['2', '3']);
      return { docs: [{ id: 2, slug: 'deux' }, { id: 3, slug: 'trois' }] };
    },
  };
  assert.deepEqual(await ev.siteLabelsFor(payload, [{ id: 1, slug: 'un' }], [{ id: 1, slug: 'un' }]), { 1: 'un' });
  assert.equal(finds, 0);
  assert.deepEqual(await ev.siteLabelsFor(payload, [1, 2], [{ id: 1, slug: 'un' }, 3, 3]), { 1: 'un', 2: 'deux', 3: 'trois' });
  assert.equal(finds, 1);
  const failing = { find: async () => { throw new Error('boom'); } };
  assert.deepEqual(await ev.siteLabelsFor(failing, [{ id: 1, slug: 'un' }, 2]), { 1: 'un' });
  assert.deepEqual(await ev.siteLabelsFor(null, [5]), {});
});

test('siteTargetFor — slug d’une relation peuplée, sinon requête, sinon #id', async () => {
  assert.equal(await ev.siteTargetFor(null, { id: 1, slug: 'boulangerie-artisanale' }), 'boulangerie-artisanale');
  assert.equal(await ev.siteTargetFor({ find: async () => ({ docs: [{ id: 7, slug: 'sept' }] }) }, 7), 'sept');
  assert.equal(await ev.siteTargetFor({ find: async () => ({ docs: [] }) }, 8), '#8');
  assert.equal(await ev.siteTargetFor(null, null), '');
});
