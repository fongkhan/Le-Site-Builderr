// Vérification automatisée de la matrice de sécurité (rôles + ownership).
// Prérequis : le serveur tourne (avec DATABASE_URI + PAYLOAD_SECRET) et les comptes
// de démonstration sont seedés. Usage : node tests/security-check.mjs
//
// Le header Origin est obligatoire : la protection CSRF de Payload rejette les cookies
// des requêtes sans Origin ni Sec-Fetch-Site (clients non-navigateur).

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'password123';
const CLIENT_PASSWORD = process.env.SEED_CLIENT_PASSWORD || 'password123';

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

async function req(path, { method = 'GET', body, token } = {}) {
  const headers = { Origin: ORIGIN };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Cookie = `payload-token=${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    // réponse non-JSON (HTML d'erreur, etc.)
  }
  return { status: res.status, json, res };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const tokenCookie = setCookies.find((c) => c.startsWith('payload-token='));
  const token = tokenCookie ? tokenCookie.split(';')[0].split('=')[1] : null;
  return { status: res.status, token };
}

// ---- Anonyme : tout doit être fermé ----
{
  check('Anonyme : GET /api/sites -> 401', (await req('/api/sites')).status === 401);
  check('Anonyme : POST /api/sites/scan -> 401', (await req('/api/sites/scan', { method: 'POST', body: {} })).status === 401);
  check('Anonyme : POST /webhook/rebuild -> 401', (await req('/webhook/rebuild?site=boulangerie-artisanale', { method: 'POST' })).status === 401);
  check('Anonyme : GET /internal/site-pages sans jeton -> 401', (await req('/internal/site-pages?site=boulangerie-artisanale')).status === 401);
  check('Anonyme : GET /api/config -> 401', (await req('/api/config')).status === 401);
}

// ---- Client : uniquement ses sites ----
const client = await login('client@client.com', CLIENT_PASSWORD);
check('Client : login -> 200 + cookie', client.status === 200 && Boolean(client.token));

if (client.token) {
  const sites = await req('/api/sites', { token: client.token });
  const slugs = Array.isArray(sites.json) ? sites.json.map((s) => s.slug) : [];
  check('Client : /api/sites filtré à ses sites', sites.status === 200 && slugs.length > 0 && slugs.every((s) => s === 'boulangerie-artisanale'), JSON.stringify(slugs));

  check('Client : site-pages de SON site -> 200', (await req('/api/site-pages?site=boulangerie-artisanale', { token: client.token })).status === 200);
  check('Client : site-pages sans ?site -> 400', (await req('/api/site-pages', { token: client.token })).status === 400);
  check("Client : site-pages d'un autre slug -> 403", (await req('/api/site-pages?site=site-dun-autre', { token: client.token })).status === 403);
  check('Client : theme de SON site -> 200', (await req('/api/theme?site=boulangerie-artisanale', { token: client.token })).status === 200);

  check('Client : POST /api/sites -> 403', (await req('/api/sites', { method: 'POST', body: { name: 'hack' }, token: client.token })).status === 403);
  check('Client : POST /api/sites/scan -> 403', (await req('/api/sites/scan', { method: 'POST', body: {}, token: client.token })).status === 403);
  check('Client : DELETE /api/sites/:slug -> 403', (await req('/api/sites/boulangerie-artisanale', { method: 'DELETE', token: client.token })).status === 403);
  check('Client : GET files -> 403', (await req('/api/sites/boulangerie-artisanale/files', { token: client.token })).status === 403);
  check('Client : GET /api/config -> 200 (booléens providers)', (await req('/api/config', { token: client.token })).status === 200);

  // Anti-escalade : un client ne peut pas s'auto-promouvoir ni voir les autres comptes
  const me = await req('/api/users/me', { token: client.token });
  const myId = me.json?.user?.id;
  check('Client : /api/users/me -> soi-même', Boolean(myId) && me.json.user.email === 'client@client.com');

  if (myId) {
    await req(`/api/users/${myId}`, { method: 'PATCH', body: { roles: ['admin'] }, token: client.token });
    const after = await req('/api/users/me', { token: client.token });
    const roles = after.json?.user?.roles ?? [];
    check('Client : tentative roles=admin neutralisée', !roles.includes('admin'), JSON.stringify(roles));
  }

  const users = await req('/api/users', { token: client.token });
  const emails = (users.json?.docs ?? []).map((u) => u.email);
  check('Client : ne liste que son propre compte', emails.length === 1 && emails[0] === 'client@client.com', JSON.stringify(emails));
}

// ---- Admin : accès complet ----
const admin = await login('admin@admin.com', ADMIN_PASSWORD);
check('Admin : login -> 200 + cookie', admin.status === 200 && Boolean(admin.token));

if (admin.token) {
  check('Admin : GET /api/sites -> 200', (await req('/api/sites', { token: admin.token })).status === 200);
  check('Admin : POST /api/sites/scan -> 200', (await req('/api/sites/scan', { method: 'POST', body: {}, token: admin.token })).status === 200);
  check('Admin : GET files -> 200', (await req('/api/sites/boulangerie-artisanale/files', { token: admin.token })).status === 200);

  const users = await req('/api/users', { token: admin.token });
  const emails = (users.json?.docs ?? []).map((u) => u.email).sort();
  check('Admin : liste tous les comptes', emails.includes('admin@admin.com') && emails.includes('client@client.com'), JSON.stringify(emails));
}

console.log(failures === 0 ? '\n✔ Matrice de sécurité : tous les contrôles passent.' : `\n✖ ${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
