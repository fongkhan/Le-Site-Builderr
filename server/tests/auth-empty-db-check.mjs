// Contrôles d'authentification sur une base de données VIDE, impossibles dans la matrice
// de sécurité (sa base est peuplée par le seed) : premier compte (first-register),
// création anonyme, GraphQL désactivé, message de login unifié sur des chemins non
// canoniques (casse, encodage) et trace des échecs dans le journal d'audit.
//
// Usage : cd server && npx tsx tests/auth-empty-db-check.mjs
// Crée puis supprime une base temporaire à côté de celle de DATABASE_URI (droit
// CREATE DATABASE requis, PostgreSQL 13 ou plus). Refusé en production.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
require('dotenv').config({ path: path.join(serverDir, '.env'), quiet: true });
require('../core/next-env-patch.js'); // indispensable, AVANT payload

if (process.env.NODE_ENV === 'production') {
  console.error('❌ Contrôle réservé au développement et à la CI (NODE_ENV=production).');
  process.exit(1);
}
if (!process.env.DATABASE_URI) {
  console.error('❌ DATABASE_URI manquante : une base PostgreSQL est requise.');
  process.exit(1);
}

const pg = require('pg'); // installé avec @payloadcms/db-postgres
const LOGIN_FAILED = 'Email ou mot de passe incorrect, ou compte temporairement verrouillé.';
const ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
const STRONG = 'Verrou-Cheval-Correct-42!';
const LOCK_EMAIL = 'audit-verrou@nulle-part.example';

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

// Base temporaire : <nom assaini>_authcheck_<pid>, créée depuis la base « postgres »
const sourceUri = new URL(process.env.DATABASE_URI);
const baseName = decodeURIComponent(sourceUri.pathname.replace(/^\//, '')).toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'metabuilder';
const tempDb = `${baseName}_authcheck_${process.pid}`.slice(0, 63);
const adminUri = new URL(sourceUri.href);
adminUri.pathname = '/postgres';
const tempUri = new URL(sourceUri.href);
tempUri.pathname = `/${tempDb}`;

const adminClient = new pg.Client({ connectionString: adminUri.href });
adminClient.on('error', () => {});
let code = 1;
let created = false;

try {
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE "${tempDb}"`);
  created = true;
  console.log(`🧪 Base temporaire ${tempDb} créée.`);

  process.env.DATABASE_URI = tempUri.href;
  if (!process.env.PAYLOAD_SECRET || process.env.PAYLOAD_SECRET.length < 16) {
    process.env.PAYLOAD_SECRET = 'auth-empty-db-check-0123456789abcdef';
  }
  // Seulement maintenant : payload.config.ts lit DATABASE_URI au chargement
  const { getPayload, handleEndpoints } = await import('payload');
  const mod = await import('../payload.config.ts');
  const config = mod.default?.default ?? mod.default;
  const payload = await getPayload({ config });
  payload.db.pool?.on('error', () => {}); // connexions coupées par le DROP final

  // Requête HTTP simulée, comme la route catch-all de Next. `routePath` : chemin
  // reconstruit par @payloadcms/next à partir des segments décodés.
  const call = async (method, p, body, routePath) => {
    const request = new Request(`http://localhost:4000${p}`, {
      method,
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: body ? JSON.stringify(body) : undefined,
    });
    const res = await handleEndpoints({ config, request, ...(routePath ? { path: routePath } : {}) });
    let json = null;
    try { json = await res.json(); } catch { /* réponse non JSON */ }
    return { status: res.status, json };
  };
  const countUsers = async () => (await payload.count({ collection: 'users', overrideAccess: true })).totalDocs;

  // ---- Base vide : aucun compte créé sans être connecté ----
  const first = await call('POST', '/api/users/first-register', { email: 'intrus@nulle-part.example', password: STRONG, roles: ['admin'] });
  check('Base vide : first-register anonyme -> 403', first.status === 403, `HTTP ${first.status}`);
  check('Base vide : aucun compte créé', (await countUsers()) === 0);
  const anonCreate = await call('POST', '/api/users', { email: 'intrus2@nulle-part.example', password: STRONG, roles: ['admin'] });
  check('Base vide : POST /api/users anonyme -> 403', anonCreate.status === 403, `HTTP ${anonCreate.status}`);
  check('Base vide : toujours aucun compte', (await countUsers()) === 0);

  // ---- GraphQL désactivé ----
  check('GraphQL : désactivé (config.graphQL.disable)', payload.config.graphQL?.disable === true);
  const gql = await call('POST', '/api/graphql', { query: '{ Users { docs { email } } }' });
  check('GraphQL : POST /api/graphql -> 404', gql.status === 404, `HTTP ${gql.status}`);

  // ---- Login : message unifié quelle que soit la forme du chemin ----
  await payload.create({ collection: 'users', data: { email: LOCK_EMAIL, password: STRONG, roles: ['client'] } });
  const unknown = { email: 'inconnu-authcheck@nulle-part.example', password: 'mauvais-mot-de-passe' };
  const upper = await call('POST', '/api/users/LOGIN', unknown);
  check('Login : /api/users/LOGIN -> message unifié', upper.status === 401 && upper.json?.errors?.[0]?.message === LOGIN_FAILED, `HTTP ${upper.status} ${JSON.stringify(upper.json)}`);
  // Next décode les segments de la route catch-all : /api/users/%6Cogin y est servi comme
  // /api/users/login (path reconstruit), alors que l'URL brute reste encodée
  const encoded = await call('POST', '/api/users/%6Cogin', unknown, '/api/users/login');
  check('Login : /api/users/%6Cogin -> message unifié', encoded.status === 401 && encoded.json?.errors?.[0]?.message === LOGIN_FAILED, `HTTP ${encoded.status} ${JSON.stringify(encoded.json)}`);

  for (let i = 0; i < 5; i++) await call('POST', '/api/users/LOGIN', { email: LOCK_EMAIL, password: 'mauvais-mot-de-passe' });
  const locked = await call('POST', '/api/users/LOGIN', { email: LOCK_EMAIL, password: STRONG });
  check('Login : compte verrouillé via /LOGIN -> message unifié', locked.status === 401 && locked.json?.errors?.[0]?.message === LOGIN_FAILED, `HTTP ${locked.status} ${JSON.stringify(locked.json)}`);

  // ---- Journal d'audit ----
  const traces = await payload.find({
    collection: 'audit_logs',
    where: { and: [{ action: { equals: 'connexion.echec' } }, { target: { equals: 'au***@nulle-part.example' } }, { details: { equals: 'motif=verrouille' } }] },
    depth: 0,
    overrideAccess: true,
  });
  check('Audit : échec tracé (email masqué, motif=verrouille)', traces.totalDocs >= 1 && traces.docs.every((d) => d.actor === 'anonyme'), `${traces.totalDocs} entrée(s)`);
  const all = await payload.find({ collection: 'audit_logs', depth: 0, limit: 500, overrideAccess: true });
  const text = JSON.stringify(all.docs);
  check('Audit : aucun mot de passe dans le journal', all.totalDocs > 0 && !text.includes(STRONG) && !text.includes('mauvais-mot-de-passe'), `${all.totalDocs} entrée(s)`);
  check('Audit : aucun email inconnu en clair', !text.includes(unknown.email));

  code = failures === 0 ? 0 : 1;
} catch (err) {
  console.error('❌ Contrôle interrompu :', (err && (err.stack || err.message)) || err);
  code = 1;
} finally {
  if (created) {
    try {
      // WITH (FORCE) : coupe aussi les connexions du pool Payload (pas de pool.end(), bloquant)
      await adminClient.query(`DROP DATABASE IF EXISTS "${tempDb}" WITH (FORCE)`);
      console.log(`🧹 Base temporaire ${tempDb} supprimée.`);
    } catch (e) {
      console.error(`⚠️ Suppression de ${tempDb} impossible :`, e.message);
      code = 1;
    }
  }
  await adminClient.end().catch(() => {});
  console.log(code === 0 ? '\n✔ Contrôles sur base vide : tous passent.' : `\n✖ ${failures} contrôle(s) en échec.`);
  process.exit(code);
}
