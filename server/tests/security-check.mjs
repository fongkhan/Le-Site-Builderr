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

// ---- Robustesse : validation slug + confinement des chemins (Lot 1) ----
if (admin.token) {
  check('Slug : POST /api/sites name="!!!" -> 400 (anti-slug-vide)', (await req('/api/sites', { method: 'POST', body: { name: '!!!' }, token: admin.token })).status === 400);
  check('Slug : POST /api/sites name="---" -> 400', (await req('/api/sites', { method: 'POST', body: { name: '---' }, token: admin.token })).status === 400);
  check('Chemins : PUT documentRoot="/etc" -> 400 (confinement)', (await req('/api/sites/boulangerie-artisanale', { method: 'PUT', body: { documentRoot: '/etc' }, token: admin.token })).status === 400);
  check('Chemins : POST /api/sites/import repositoryPath="/root" -> 400', (await req('/api/sites/import', { method: 'POST', body: { slug: 'x-import', repositoryPath: '/root' }, token: admin.token })).status === 400);
}

// ---- Robustesse : validation de thème avant écriture (Lot 2) ----
if (admin.token) {
  const baseTheme = { colors: { primary: '#8B5A2B', secondary: '#F5E6CC', background: '#FAFAFA', text: '#2D241E' }, fonts: { heading: 'Playfair Display', body: 'Inter' }, radius: '12px' };
  const postTheme = (theme) => req('/api/theme?site=boulangerie-artisanale', { method: 'POST', body: { theme }, token: admin.token });
  check('Thème : POST valide -> 200', (await postTheme(baseTheme)).status === 200);
  check('Thème : radius injectant du CSS -> 400', (await postTheme({ ...baseTheme, radius: '12px;} body{display:none}' })).status === 400);
  check('Thème : couleur non-hex -> 400', (await postTheme({ ...baseTheme, colors: { ...baseTheme.colors, primary: 'url(javascript:1)' } })).status === 400);
  check('Thème : police hors allowlist -> 400', (await postTheme({ ...baseTheme, fonts: { heading: 'Comic Sans', body: 'Inter' } })).status === 400);
}

// ---- Persistance : Payload est la source de vérité des sites ----
if (admin.token) {
  const put = await req('/api/sites/boulangerie-artisanale', { method: 'PUT', body: { status: 'active' }, token: admin.token });
  check('Sites : PUT status=active -> 200', put.status === 200 && put.json?.site?.status === 'active');
  check('Sites : réponse normalisée (pas de clé id)', put.json?.site && !('id' in put.json.site), JSON.stringify(Object.keys(put.json?.site ?? {})));

  const list = await req('/api/sites', { token: admin.token });
  const listed = (list.json ?? []).find((s) => s.slug === 'boulangerie-artisanale');
  check('Sites : GET /api/sites reflète le nouveau statut', listed?.status === 'active');

  // Preuve en base : la collection Payload elle-même porte la valeur
  const payloadDoc = await req('/api/payload_sites?where[slug][equals]=boulangerie-artisanale', { token: admin.token });
  check('Sites : payload_sites (REST Payload) porte status=active', payloadDoc.json?.docs?.[0]?.status === 'active');

  // Remise en état pour l'idempotence des runs
  await req('/api/sites/boulangerie-artisanale', { method: 'PUT', body: { status: 'draft' }, token: admin.token });
}

// ---- File d'attente de builds : exposition du statut ----
if (admin.token && client.token) {
  const adminStatus = await req('/api/build-status', { token: admin.token });
  check('Queue : build-status admin expose queue[] et queueLength', Array.isArray(adminStatus.json?.queue) && typeof adminStatus.json?.queueLength === 'number');

  const clientStatus = await req('/api/build-status', { token: client.token });
  check('Queue : build-status client expose queueLength + queuedSites (sans queue complète)',
    typeof clientStatus.json?.queueLength === 'number' && Array.isArray(clientStatus.json?.queuedSites) && !('queue' in (clientStatus.json ?? {})));
}

// ---- Quota IA (activé quand AI_DAILY_QUOTA=0, comme dans le job CI) ----
if (process.env.AI_DAILY_QUOTA === '0' && client.token && admin.token) {
  const cfg = await req('/api/config', { token: client.token });
  check('Quota : /api/config client -> aiQuota {limit:0, remaining:0}', cfg.json?.aiQuota?.limit === 0 && cfg.json?.aiQuota?.remaining === 0, JSON.stringify(cfg.json?.aiQuota));

  const cfgAdmin = await req('/api/config', { token: admin.token });
  check('Quota : /api/config admin -> aiQuota null (illimité)', cfgAdmin.json?.aiQuota === null);

  // Le 429 doit tomber AVANT tout appel IA (aucune clé API requise pour ce test)
  const onboardClient = await req('/api/onboard', { method: 'POST', body: { description: 'test quota' }, token: client.token });
  check('Quota : onboard client -> 429 (quota épuisé)', onboardClient.status === 429);

  const onboardAdmin = await req('/api/onboard', { method: 'POST', body: { description: 'test quota' }, token: admin.token });
  check('Quota : onboard admin -> pas de 429 (illimité)', onboardAdmin.status !== 429, `HTTP ${onboardAdmin.status}`);

  // Un client ne peut pas modifier son propre quota
  const me = await req('/api/users/me', { token: client.token });
  const myId = me.json?.user?.id;
  if (myId) {
    await req(`/api/users/${myId}`, { method: 'PATCH', body: { aiDailyQuota: 9999 }, token: client.token });
    const after = await req('/api/users/me', { token: client.token });
    check('Quota : tentative aiDailyQuota=9999 par le client neutralisée', after.json?.user?.aiDailyQuota == null, JSON.stringify(after.json?.user?.aiDailyQuota));
  }
}

// ---- Réinitialisation de mot de passe ----
{
  const known = await req('/api/users/forgot-password', { method: 'POST', body: { email: 'client@client.com' } });
  const unknown = await req('/api/users/forgot-password', { method: 'POST', body: { email: 'inconnu@nulle-part.example' } });
  check('Reset : forgot-password email connu -> 200', known.status === 200, `HTTP ${known.status}`);
  check('Reset : email inconnu -> même statut (anti-énumération)', unknown.status === known.status, `HTTP ${unknown.status}`);

  const badToken = await req('/api/users/reset-password', { method: 'POST', body: { token: 'jeton-invalide', password: 'nouveau-mdp-123' } });
  check('Reset : token invalide -> 4xx (pas 500)', badToken.status >= 400 && badToken.status < 500, `HTTP ${badToken.status}`);
}

console.log(failures === 0 ? '\n✔ Matrice de sécurité : tous les contrôles passent.' : `\n✖ ${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
