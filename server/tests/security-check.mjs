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
  check('Anonyme : GET /internal/site-posts sans jeton -> 401', (await req('/internal/site-posts?site=boulangerie-artisanale')).status === 401);
  check('Anonyme : GET /api/site-posts -> 401', (await req('/api/site-posts?site=boulangerie-artisanale')).status === 401);
  check('Anonyme : GET /api/config -> 401', (await req('/api/config')).status === 401);
  check('Anonyme : GET /api/sites/owners -> 401', (await req('/api/sites/owners')).status === 401);
  check('Anonyme : GET /api/hosting/status -> 401', (await req('/api/hosting/status')).status === 401);
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

  // Blog / actualités : même modèle d'ownership que les pages
  check('Client : site-posts de SON site -> 200', (await req('/api/site-posts?site=boulangerie-artisanale', { token: client.token })).status === 200);
  check("Client : site-posts d'un autre slug -> 403", (await req('/api/site-posts?site=site-dun-autre', { token: client.token })).status === 403);
  check('Client : POST article sans titre -> 400', (await req('/api/site-posts?site=boulangerie-artisanale', { method: 'POST', body: { title: '' }, token: client.token })).status === 400);

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

  const owners = await req('/api/sites/owners', { token: admin.token });
  check('Admin : GET /api/sites/owners -> 200 (map slug->emails)', owners.status === 200 && owners.json && typeof owners.json === 'object', `HTTP ${owners.status}`);
  check('Admin : owners rattache le client à son site', Array.isArray(owners.json?.['boulangerie-artisanale']) && owners.json['boulangerie-artisanale'].includes('client@client.com'), JSON.stringify(owners.json?.['boulangerie-artisanale']));
}

if (client.token) {
  check('Client : GET /api/sites/owners -> 403', (await req('/api/sites/owners', { token: client.token })).status === 403);
  check('Client : GET /api/hosting/status -> 403', (await req('/api/hosting/status', { token: client.token })).status === 403);
}

// ---- Médiathèque (ownership à la création) ----
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const uploadAs = async (token, siteId) => {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
    form.append('_payload', JSON.stringify({ site: siteId }));
    const res = await fetch(`${BASE}/api/media`, {
      method: 'POST',
      headers: { Origin: ORIGIN, ...(token ? { Cookie: `payload-token=${token}` } : {}) },
      body: form,
    });
    let json = null;
    try { json = await res.clone().json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  };

  const anon = await uploadAs(null, 1);
  check('Media : upload anonyme -> 401/403', anon.status === 401 || anon.status === 403, `HTTP ${anon.status}`);

  if (client.token && admin.token) {
    // id du site du client (boulangerie-artisanale) via l'API admin
    const siteRes = await req('/api/payload_sites?where[slug][equals]=boulangerie-artisanale&limit=1&depth=0', { token: admin.token });
    const ownSiteId = siteRes.json?.docs?.[0]?.id;
    if (ownSiteId) {
      const ok = await uploadAs(client.token, ownSiteId);
      check('Media : client -> upload sur SON site accepté', ok.status === 201 && Boolean(ok.json?.doc?.url), `HTTP ${ok.status}`);
      const denied = await uploadAs(client.token, 999999);
      check('Media : client -> upload sur un autre site refusé', denied.status === 403 || denied.status === 400, `HTTP ${denied.status}`);
      // Nettoyage du média de test
      if (ok.json?.doc?.id) await req(`/api/media/${ok.json.doc.id}`, { method: 'DELETE', token: admin.token });
    }
  }
}

// ---- Historique des builds (admin ou propriétaire) ----
{
  check('Builds : anonyme -> 401', (await req('/api/sites/boulangerie-artisanale/builds')).status === 401);
  if (client.token) {
    check('Builds : client sur SON site -> 200 (tableau)', await (async () => {
      const r = await req('/api/sites/boulangerie-artisanale/builds', { token: client.token });
      return r.status === 200 && Array.isArray(r.json);
    })());
    check("Builds : client sur un autre site -> 403", (await req('/api/sites/site-dun-autre/builds', { token: client.token })).status === 403);
  }
}

// ---- Duplication de site (admin only) ----
{
  check('Duplicate : anonyme -> 401', (await req('/api/sites/boulangerie-artisanale/duplicate', { method: 'POST' })).status === 401);
  if (client.token) {
    check('Duplicate : client -> 403', (await req('/api/sites/boulangerie-artisanale/duplicate', { method: 'POST', token: client.token })).status === 403);
  }
  if (admin.token) {
    const dup = await req('/api/sites/boulangerie-artisanale/duplicate', { method: 'POST', token: admin.token });
    check('Duplicate : admin -> crée un jumeau sous nouveau slug', dup.status === 200 && dup.json?.site?.slug?.startsWith('boulangerie-artisanale-copie'), JSON.stringify(dup.json?.site?.slug));
    if (dup.json?.site?.slug) {
      await req(`/api/sites/${dup.json.site.slug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
    }
  }
}

// ---- Releases & rollback (admin only) ----
{
  check('Releases : anonyme -> 401', (await req('/api/sites/boulangerie-artisanale/releases')).status === 401);
  if (client.token) {
    check('Releases : client -> 403', (await req('/api/sites/boulangerie-artisanale/releases', { token: client.token })).status === 403);
    check('Rollback : client -> 403', (await req('/api/sites/boulangerie-artisanale/rollback', { method: 'POST', body: { release: '1' }, token: client.token })).status === 403);
  }
  if (admin.token) {
    const rel = await req('/api/sites/boulangerie-artisanale/releases', { token: admin.token });
    check('Releases : admin -> 200 (tableau)', rel.status === 200 && Array.isArray(rel.json));
    check('Rollback : identifiant hostile -> 400', (await req('/api/sites/boulangerie-artisanale/rollback', { method: 'POST', body: { release: '../../etc' }, token: admin.token })).status === 400);
    check('Rollback : release inexistante -> 400', (await req('/api/sites/boulangerie-artisanale/rollback', { method: 'POST', body: { release: '1111111111111' }, token: admin.token })).status === 400);
  }
}

// ---- Hébergement (admin only) ----
if (admin.token) {
  const hs = await req('/api/hosting/status', { token: admin.token });
  check('Hébergement : status admin -> 200 avec driver', hs.status === 200 && typeof hs.json?.driver === 'string', JSON.stringify(hs.json?.driver));
  check('Hébergement : status ne fuite jamais de jeton', !JSON.stringify(hs.json || {}).toLowerCase().includes('token'));
  const ht = await req('/api/hosting/test', { method: 'POST', token: admin.token });
  check('Hébergement : test admin -> ok en simulation', ht.status === 200 && ht.json?.ok === true, JSON.stringify(ht.json));
}

// ---- Domaine personnalisé (admin only) ----
{
  const path = '/api/sites/boulangerie-artisanale/custom-domain';
  // Fermé aux anonymes et aux clients (admin only)
  check('Domaine : POST anonyme -> 401', (await req(path, { method: 'POST', body: { domain: 'exemple.fr' } })).status === 401);
  check('Domaine : verify anonyme -> 401', (await req(`${path}/verify`, { method: 'POST' })).status === 401);
  check('Domaine : DELETE anonyme -> 401', (await req(path, { method: 'DELETE' })).status === 401);
  if (client.token) {
    check('Domaine : POST client -> 403', (await req(path, { method: 'POST', body: { domain: 'exemple.fr' }, token: client.token })).status === 403);
    check('Domaine : DELETE client -> 403', (await req(path, { method: 'DELETE', token: client.token })).status === 403);
  }
  if (admin.token) {
    // Domaine invalide -> 400
    check('Domaine : admin domaine invalide -> 400', (await req(path, { method: 'POST', body: { domain: 'pas un domaine' }, token: admin.token })).status === 400);
    // Sous-domaine du root interne -> 400 (si le root est connu)
    // Saisie valide -> 200 + enregistrement TXT renvoyé
    const attach = await req(path, { method: 'POST', body: { domain: 'HTTPS://WWW.Exemple-Domaine-Test.FR/' }, token: admin.token });
    check('Domaine : admin saisie valide -> 200 + TXT', attach.status === 200 && attach.json?.customDomain === 'exemple-domaine-test.fr' && attach.json?.record?.type === 'TXT' && typeof attach.json?.record?.value === 'string', JSON.stringify(attach.json?.record));
    check('Domaine : statut passe à pending', attach.json?.domainStatus === 'pending', attach.json?.domainStatus);
    // Vérification sans TXT publié -> verified:false (jamais 500)
    const verify = await req(`${path}/verify`, { method: 'POST', token: admin.token });
    check('Domaine : verify sans TXT -> verified:false (pas 500)', verify.status === 200 && verify.json?.verified === false, `HTTP ${verify.status} ${JSON.stringify(verify.json?.verified)}`);
    // Le site reflète le domaine personnalisé en attente
    const sites = await req('/api/sites', { token: admin.token });
    const site = Array.isArray(sites.json) ? sites.json.find((s) => s.slug === 'boulangerie-artisanale') : null;
    check('Domaine : le site expose customDomain + domainStatus', site?.customDomain === 'exemple-domaine-test.fr' && site?.domainStatus === 'pending', JSON.stringify({ c: site?.customDomain, s: site?.domainStatus }));
    // Détachement -> retour au sous-domaine
    const detach = await req(path, { method: 'DELETE', token: admin.token });
    check('Domaine : détachement -> none + sous-domaine', detach.status === 200 && detach.json?.domainStatus === 'none' && typeof detach.json?.domain === 'string', JSON.stringify(detach.json));
  }
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

  // Assistant IA du CMS : même quota que l'onboarding, ownership sur ?site
  const assistOwn = await req('/api/ai/assist', { method: 'POST', body: { site: 'boulangerie-artisanale', action: 'rewrite', input: 'Bonjour' }, token: client.token });
  check('AI assist : client sur SON site, quota épuisé -> 429', assistOwn.status === 429, `HTTP ${assistOwn.status}`);
}

// ---- Assistant IA du CMS : auth & ownership (indépendant du quota) ----
{
  check('AI assist : anonyme -> 401', (await req('/api/ai/assist', { method: 'POST', body: { site: 'boulangerie-artisanale', action: 'rewrite', input: 'x' } })).status === 401);
  if (client.token) {
    check("AI assist : client sur un autre site -> 403", (await req('/api/ai/assist', { method: 'POST', body: { site: 'site-dun-autre', action: 'rewrite', input: 'x' }, token: client.token })).status === 403);
    check('AI assist : action invalide -> 400', (await req('/api/ai/assist', { method: 'POST', body: { site: 'boulangerie-artisanale', action: 'pirater', input: 'x' }, token: client.token })).status === 400);
  }
}

// ---- Offres d'abonnement : limite du nombre de sites ----
if (admin.token) {
  // Compte jetable sur l'offre par défaut (Découverte = 1 site) déjà rattaché à un site :
  // toute création supplémentaire doit être refusée AVANT toute consommation de quota IA.
  const email = 'sec-check-plan@nulle-part.example';
  const existing = await req(`/api/users?where[email][equals]=${encodeURIComponent(email)}`, { token: admin.token });
  const existingId = existing.json?.docs?.[0]?.id;
  if (existingId) await req(`/api/users/${existingId}`, { method: 'DELETE', token: admin.token });

  const sitesList = await req('/api/sites', { token: admin.token });
  const demoSiteId = Array.isArray(sitesList.json) ? undefined : undefined; // les slugs suffisent via Payload
  const payloadSites = await req('/api/payload_sites?where[slug][equals]=boulangerie-artisanale', { token: admin.token });
  const siteId = payloadSites.json?.docs?.[0]?.id ?? demoSiteId;

  const created = await req('/api/users', {
    method: 'POST',
    body: { email, password: 'Cheval-Correct-42!', roles: ['client'], plan: 'free', sites: siteId ? [siteId] : [] },
    token: admin.token,
  });
  const freeId = created.json?.doc?.id;
  const freeLogin = await login(email, 'Cheval-Correct-42!');
  if (freeLogin.token && siteId) {
    const refused = await req('/api/onboard', { method: 'POST', body: { description: 'un site de test' }, token: freeLogin.token });
    check("Offre : client Découverte au maximum -> 403 (avant tout appel IA)", refused.status === 403 && /offre/i.test(refused.json?.error || ''), `HTTP ${refused.status} ${JSON.stringify(refused.json?.error)}`);
  }
  const cfg = freeLogin.token ? await req('/api/config', { token: freeLogin.token }) : { json: null };
  check("Offre : /api/config expose l'offre du compte", Boolean(cfg.json?.plan && cfg.json.plan.maxSites === 1), JSON.stringify(cfg.json?.plan));
  const adminCfg = await req('/api/config', { token: admin.token });
  check('Offre : admin sans limite (plan null)', adminCfg.json?.plan === null, JSON.stringify(adminCfg.json?.plan));

  if (freeId) await req(`/api/users/${freeId}`, { method: 'DELETE', token: admin.token });
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

// ---- Création de compte client (admin only) ----
if (admin.token && client.token) {
  // Un client ne peut pas créer d'utilisateur (Payload access.create = isAdmin)
  const clientCreate = await req('/api/users', { method: 'POST', body: { email: 'hack@nulle-part.example', password: 'password123', roles: ['admin'] }, token: client.token });
  check('Users : POST /api/users par un client -> 403', clientCreate.status === 403, `HTTP ${clientCreate.status}`);

  // Admin crée un client (idempotent : on purge d'abord le compte de test)
  const testEmail = 'sec-check-client@nulle-part.example';
  const existing = await req(`/api/users?where[email][equals]=${encodeURIComponent(testEmail)}`, { token: admin.token });
  const existingId = existing.json?.docs?.[0]?.id;
  if (existingId) await req(`/api/users/${existingId}`, { method: 'DELETE', token: admin.token });

  const adminCreate = await req('/api/users', { method: 'POST', body: { email: testEmail, password: 'Cheval-Correct-42!', roles: ['client'] }, token: admin.token });
  check('Users : POST /api/users par un admin -> crée le compte', adminCreate.status === 200 || adminCreate.status === 201, `HTTP ${adminCreate.status}`);

  const newLogin = await req('/api/users/login', { method: 'POST', body: { email: testEmail, password: 'Cheval-Correct-42!' } });
  check('Users : le client créé peut se connecter', newLogin.status === 200, `HTTP ${newLogin.status}`);

  // Nettoyage
  const createdId = adminCreate.json?.doc?.id;
  if (createdId) await req(`/api/users/${createdId}`, { method: 'DELETE', token: admin.token });
}

// ---- Formulaire de contact public (rate-limité, honeypot) ----
{
  const valid = { name: 'Jean Test', email: 'jean@exemple.fr', message: 'Bonjour, ceci est un test.' };
  const ok = await req('/api/contact/boulangerie-artisanale', { method: 'POST', body: valid });
  check('Contact : message valide -> 200', ok.status === 200 && ok.json?.success === true, `HTTP ${ok.status}`);
  check('Contact : site inconnu -> 404', (await req('/api/contact/site-inexistant', { method: 'POST', body: valid })).status === 404);
  check('Contact : corps invalide -> 400', (await req('/api/contact/boulangerie-artisanale', { method: 'POST', body: { name: '', email: 'pas-un-email', message: '' } })).status === 400);
  const hp = await req('/api/contact/boulangerie-artisanale', { method: 'POST', body: { ...valid, company: 'robot inc' } });
  check('Contact : honeypot rempli -> 200 silencieux', hp.status === 200 && hp.json?.success === true);
}

// ---- Statistiques de visites : beacon public borné, lecture par ownership ----
{
  // Le beacon est public (appelé par le site déployé, sans auth) et répond 204 même
  // pour un slug inconnu — jamais d'erreur qui casserait la page.
  const hit = await req('/api/stats/hit/boulangerie-artisanale', { method: 'POST' });
  check('Stats : beacon public -> 204', hit.status === 204, `HTTP ${hit.status}`);
  const hitUnknown = await req('/api/stats/hit/site-inexistant', { method: 'POST' });
  check('Stats : beacon slug inconnu -> 204 silencieux', hitUnknown.status === 204, `HTTP ${hitUnknown.status}`);

  // La lecture des stats est réservée au propriétaire / admin.
  check('Stats : lecture anonyme -> 401', (await req('/api/sites/boulangerie-artisanale/stats')).status === 401);
  if (client.token) {
    const own = await req('/api/sites/boulangerie-artisanale/stats', { token: client.token });
    check('Stats : propriétaire lit ses stats -> 200', own.status === 200 && typeof own.json?.total === 'number' && Array.isArray(own.json?.days), `HTTP ${own.status}`);
    check("Stats : client sur un autre site -> 403", (await req('/api/sites/site-dun-autre/stats', { token: client.token })).status === 403);
    // Le beacon vient d'incrémenter le compteur du jour : le total doit être positif.
    check('Stats : le hit a été comptabilisé (total > 0)', (own.json?.total ?? 0) > 0, `total=${own.json?.total}`);
  }
}

// ---- Audit & export/import (admin only) ----
{
  check('Audit : anonyme -> 401', (await req('/api/audit')).status === 401);
  check('Export : anonyme -> 401', (await req('/api/sites/boulangerie-artisanale/export')).status === 401);
  check('Prévisualisation : anonyme -> 401', (await req('/api/sites/boulangerie-artisanale/preview-build', { method: 'POST' })).status === 401);
  check('Overview : anonyme -> 401', (await req('/api/admin/overview')).status === 401);
  check('Backups : anonyme -> 401', (await req('/api/admin/backups')).status === 401);
  if (client.token) {
    check('Audit : client -> 403', (await req('/api/audit', { token: client.token })).status === 403);
    check('Export : client -> 403', (await req('/api/sites/boulangerie-artisanale/export', { token: client.token })).status === 403);
    check("Prévisualisation : client sur un autre site -> 403", (await req('/api/sites/site-dun-autre/preview-build', { method: 'POST', token: client.token })).status === 403);
    check('Overview : client -> 403', (await req('/api/admin/overview', { token: client.token })).status === 403);
    check('Backups : client -> 403', (await req('/api/admin/backups', { token: client.token })).status === 403);
    check('Backups : POST client -> 403', (await req('/api/admin/backups', { method: 'POST', token: client.token })).status === 403);
  }
  if (admin.token) {
    const ov = await req('/api/admin/overview', { token: admin.token });
    check('Overview : admin -> 200 (totaux + sites)', ov.status === 200 && ov.json?.totals && Array.isArray(ov.json?.sites), `HTTP ${ov.status}`);
    const bk = await req('/api/admin/backups', { token: admin.token });
    check('Backups : admin -> 200 (config + liste)', bk.status === 200 && bk.json?.config && Array.isArray(bk.json?.backups), `HTTP ${bk.status}`);
    check('Backups : download nom hostile -> 400', (await req('/api/admin/backups/download?name=' + encodeURIComponent('../etc/passwd'), { token: admin.token })).status === 400);
  }
  if (admin.token) {
    const audit = await req('/api/audit', { token: admin.token });
    check('Audit : admin -> 200 (tableau)', audit.status === 200 && Array.isArray(audit.json));

    const exp = await fetch(`${BASE}/api/sites/boulangerie-artisanale/export`, { headers: { Origin: ORIGIN, Cookie: `payload-token=${admin.token}` } });
    check('Export : admin -> 200 (zip)', exp.status === 200 && (exp.headers.get('content-type') || '').includes('zip'));
    const zipBuf = Buffer.from(await exp.arrayBuffer());
    check('Export : archive non vide', zipBuf.length > 200, `${zipBuf.length} octets`);

    // Cycle complet : ré-import de l'archive exportée → nouveau site sous slug dédupliqué
    const imp = await fetch(`${BASE}/api/sites/import-archive`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: `payload-token=${admin.token}`, 'Content-Type': 'application/zip' },
      body: zipBuf,
    });
    const impJson = await imp.json().catch(() => null);
    check('Import : archive exportée ré-importée', imp.status === 200 && impJson?.success === true && impJson?.site?.slug?.startsWith('boulangerie-artisanale-'), JSON.stringify(impJson?.site?.slug));
    if (impJson?.site?.slug) {
      await req(`/api/sites/${impJson.site.slug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
    }

    // Anti zip-slip : une archive aux entrées hostiles ne doit rien extraire hors périmètre
    const { createRequire } = await import('node:module');
    const AdmZip = createRequire(import.meta.url)('adm-zip');
    const evil = new AdmZip();
    evil.addFile('meta.json', Buffer.from(JSON.stringify({ slug: 'test-zip-slip', name: 'Zip Slip' })));
    evil.addFile('dist/../../evil.txt', Buffer.from('owned'));
    evil.addFile('dist/../evil2.txt', Buffer.from('owned'));
    const slip = await fetch(`${BASE}/api/sites/import-archive`, {
      method: 'POST',
      headers: { Origin: ORIGIN, Cookie: `payload-token=${admin.token}`, 'Content-Type': 'application/zip' },
      body: evil.toBuffer(),
    });
    const slipJson = await slip.json().catch(() => null);
    check('Import : entrées zip-slip ignorées (0 fichier extrait)', slip.status === 200 && slipJson?.extractedFiles === 0, JSON.stringify(slipJson?.extractedFiles));
    if (slipJson?.site?.slug) {
      await req(`/api/sites/${slipJson.site.slug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
    }
  }
}

// ---- Refactorisation : CORS public, droits REST Payload, confinement, validation ----
{
  // Le formulaire de contact d'un site publié (autre domaine) envoie du JSON : le
  // preflight OPTIONS doit être accepté pour toute origine, sans cookie.
  const pre = await fetch(`${BASE}/api/contact/boulangerie-artisanale`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://site-client.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  check('CORS : preflight du formulaire de contact depuis un site publié -> autorisé (*)', pre.status < 300 && pre.headers.get('access-control-allow-origin') === '*', `HTTP ${pre.status} ACAO=${pre.headers.get('access-control-allow-origin')}`);
  const priv = await fetch(`${BASE}/api/sites`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  check("CORS : preflight d'une route privée depuis une origine inconnue -> refusé", !priv.headers.get('access-control-allow-origin'), `ACAO=${priv.headers.get('access-control-allow-origin')}`);
  const big = await req('/api/contact/boulangerie-artisanale', { method: 'POST', body: { name: 'x', email: 'a@b.fr', message: 'x'.repeat(64 * 1024) } });
  check('Contact : corps de 64 Ko -> 413 (limite des endpoints publics)', big.status === 413, `HTTP ${big.status}`);
  // Demande de RDV envoyée par le script du site : le serveur compose le message
  const rdv = await req('/api/contact/boulangerie-artisanale', { method: 'POST', body: { kind: 'appointment', name: 'Client RDV', email: 'rdv@example.com', service: 'Coupe', slot: 'mardi', phone: '0600000000' } });
  check('Contact : demande de RDV en JSON (sans message libre) -> 200', rdv.status === 200, `HTTP ${rdv.status}`);
  // Formulaire posté sans JavaScript : une erreur s'affiche en page HTML, jamais en JSON brut
  const bigForm = await fetch(`${BASE}/api/contact/boulangerie-artisanale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `name=x&email=a%40b.fr&message=${'x'.repeat(40 * 1024)}`,
  });
  check('Contact sans JavaScript : message trop long -> 413 en page HTML', bigForm.status === 413 && (bigForm.headers.get('content-type') || '').includes('text/html'), `HTTP ${bigForm.status} ${bigForm.headers.get('content-type')}`);
}

// ---- Pages : suppression explicite, doublons, textes libres ----
if (admin.token) {
  const created = await req('/api/sites', { method: 'POST', body: { name: 'Pages SC' }, token: admin.token });
  const slug = created.json?.site?.slug;
  if (slug) {
    const url = `/api/site-pages?site=${slug}`;
    const pg = (s, extra = {}) => ({ title: s, slug: s, layout: [], ...extra });
    const keys = async () => ((await req(url, { token: admin.token })).json?.docs || []).map((p) => p.slug).sort().join(',');
    await req(url, { method: 'POST', body: { docs: [pg('home'), pg('tarifs'), pg('equipe')] }, token: admin.token });
    await req(url, { method: 'POST', body: { docs: [pg('home'), pg('tarifs')] }, token: admin.token });
    check('Pages : une page absente du corps (autre onglet) est conservée', (await keys()) === 'equipe,home,tarifs', await keys());
    await req(url, { method: 'POST', body: { docs: [pg('home'), pg('tarifs')], deleted: [{ slug: 'equipe', locale: 'fr' }] }, token: admin.token });
    check('Pages : une page listée dans deleted est supprimée', (await keys()) === 'home,tarifs', await keys());
    const faq = { blockType: 'faq', title: 'JavaScript & TypeScript', items: [{ question: 'JavaScript est-il nécessaire ?', answer: 'Non.' }] };
    const text = await req(url, { method: 'POST', body: { docs: [pg('home', { layout: [faq] }), pg('tarifs')] }, token: admin.token });
    check('Pages : le mot « JavaScript » dans un texte est accepté', text.status === 200, `HTTP ${text.status}`);
    const link = await req(url, { method: 'POST', body: { docs: [pg('home', { layout: [{ blockType: 'footer', socials: { x: 'javascript:alert(1)' } }] })] }, token: admin.token });
    check('Pages : lien javascript: dans un réseau social -> 400', link.status === 400, `HTTP ${link.status}`);
    // Doublon créé hors du CMS (REST Payload) : la lecture le masque, la sauvegarde le purge
    const siteDoc = await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token: admin.token });
    const siteId = siteDoc.json?.docs?.[0]?.id;
    if (siteId) {
      await req('/api/pages', { method: 'POST', body: { title: 'Doublon', slug: 'tarifs', locale: 'fr', site: siteId, layout: [] }, token: admin.token });
      check('Pages : un doublon en base est masqué à la lecture', (await keys()) === 'home,tarifs', await keys());
      const save = await req(url, { method: 'POST', body: { docs: [pg('home'), pg('tarifs')] }, token: admin.token });
      const count = await req(`/api/pages?where[site][equals]=${siteId}&where[slug][equals]=tarifs&depth=0`, { token: admin.token });
      check('Pages : la sauvegarde réussit et purge le doublon', save.status === 200 && count.json?.totalDocs === 1, `HTTP ${save.status}, ${count.json?.totalDocs} page(s) « tarifs »`);
    }
    await req(`/api/sites/${slug}`, { method: 'DELETE', token: admin.token });
  }
}

if (admin.token) {
  // Corps JSON invalide -> 400 JSON (jamais la page d'erreur HTML d'Express)
  const bad = await fetch(`${BASE}/api/site-pages?site=boulangerie-artisanale`, {
    method: 'POST',
    headers: { Origin: ORIGIN, Cookie: `payload-token=${admin.token}`, 'Content-Type': 'application/json' },
    body: '{ pas du json',
  });
  let badJson = null;
  try { badJson = await bad.json(); } catch { /* HTML */ }
  check('Robustesse : JSON invalide -> 400 avec erreur JSON', bad.status === 400 && typeof badJson?.error === 'string', `HTTP ${bad.status}`);
  check('Robustesse : pages au format invalide -> 400', (await req('/api/site-pages?site=boulangerie-artisanale', { method: 'POST', body: { docs: 'pas une liste' }, token: admin.token })).status === 400);
  check('Robustesse : ?site= non canonique (traversée) -> 400', (await req('/api/site-pages?site=..%2F..%2Fetc', { token: admin.token })).status === 400);
  check('Scan : chemin hors des racines du projet -> 400', (await req('/api/sites/scan', { method: 'POST', body: { scanPath: '/etc' }, token: admin.token })).status === 400);

  // La racine partagée de production ne peut pas devenir le documentRoot d'un site
  const list = await req('/api/sites', { token: admin.token });
  const demo = Array.isArray(list.json) ? list.json.find((x) => x.slug === 'boulangerie-artisanale') : null;
  if (demo?.documentRoot) {
    const root = demo.documentRoot.replace(/\/[^/]+\/?$/, '');
    const r = await req('/api/sites', { method: 'POST', body: { name: 'Racine partagée SC', documentRoot: root }, token: admin.token });
    check('Confinement : documentRoot = racine partagée -> 400', r.status === 400, `HTTP ${r.status}`);
    if (r.json?.site?.slug) await req(`/api/sites/${r.json.site.slug}`, { method: 'DELETE', token: admin.token });
  }

  // REST Payload directe : un client ne modifie jamais les champs pilotant le déploiement
  // de son site, ni ne déplace ses contenus vers le site d'un autre client.
  const own = await req('/api/payload_sites?where[slug][equals]=boulangerie-artisanale&depth=0', { token: admin.token });
  const ownId = own.json?.docs?.[0]?.id;
  const other = await req('/api/sites', { method: 'POST', body: { name: 'Isolation SC' }, token: admin.token });
  const otherSlug = other.json?.site?.slug;
  const otherDoc = otherSlug ? await req(`/api/payload_sites?where[slug][equals]=${otherSlug}&depth=0`, { token: admin.token }) : null;
  const otherId = otherDoc?.json?.docs?.[0]?.id;
  if (client.token && ownId) {
    const patch = await req(`/api/payload_sites/${ownId}`, { method: 'PATCH', body: { documentRoot: '/tmp/detourne', domainStatus: 'active' }, token: client.token });
    check('REST Payload : client PATCH payload_sites (documentRoot) -> refusé', patch.status === 403 || patch.status === 401, `HTTP ${patch.status}`);
    const after = await req(`/api/payload_sites/${ownId}?depth=0`, { token: admin.token });
    check('REST Payload : documentRoot du site inchangé', after.json?.documentRoot !== '/tmp/detourne', after.json?.documentRoot);
  }
  if (client.token && ownId && otherId) {
    const page = await req('/api/pages', { method: 'POST', body: { title: 'SC isolation', slug: 'sc-isolation', site: ownId, layout: [] }, token: client.token });
    const pageId = page.json?.doc?.id;
    check('REST Payload : client crée une page sur SON site -> 201', Boolean(pageId), `HTTP ${page.status}`);
    const foreign = await req('/api/pages', { method: 'POST', body: { title: 'SC intrusion', slug: 'sc-intrusion', site: otherId, layout: [] }, token: client.token });
    check("REST Payload : client crée une page sur le site d'un autre -> 403", foreign.status === 403, `HTTP ${foreign.status}`);
    if (pageId) {
      await req(`/api/pages/${pageId}`, { method: 'PATCH', body: { site: otherId }, token: client.token });
      const moved = await req(`/api/pages/${pageId}?depth=0`, { token: admin.token });
      check("REST Payload : client ne peut pas déplacer sa page vers le site d'un autre", String(moved.json?.site) === String(ownId), `site=${moved.json?.site}`);
      await req(`/api/pages/${pageId}`, { method: 'DELETE', token: admin.token });
    }
  }
  if (otherSlug) await req(`/api/sites/${otherSlug}`, { method: 'DELETE', token: admin.token });
}

// ---- Durcissement HTTP : en-têtes helmet ----
{
  const r = await req('/api/config');
  check('Helmet : en-tête X-Content-Type-Options=nosniff présent', r.res.headers.get('x-content-type-options') === 'nosniff', r.res.headers.get('x-content-type-options') || 'absent');
}

// ---- Lot 1 : comptes et sessions ----
// Un seul échec de login ici (email inconnu) : le budget du limiteur par IP reste
// disponible pour le contrôle final de rate-limit.
{
  const STRONG = 'Cheval-Correct-42!';
  const LOGIN_FAILED = 'Email ou mot de passe incorrect, ou compte temporairement verrouillé.';

  // Échec de login : message unifié (aucune distinction compte inconnu / verrouillé)
  const unknownLogin = await req('/api/users/login', { method: 'POST', body: { email: 'lot1-inconnu@nulle-part.example', password: 'mauvais-mot-de-passe' } });
  check('Login : email inconnu -> 401 + message unifié', unknownLogin.status === 401 && unknownLogin.json?.errors?.[0]?.message === LOGIN_FAILED, `HTTP ${unknownLogin.status} ${JSON.stringify(unknownLogin.json?.errors?.[0]?.message)}`);

  // Déverrouillage : admin only, 403 identique que le compte existe ou non
  if (client.token) {
    const u1 = await req('/api/users/unlock', { method: 'POST', body: { email: 'admin@admin.com' }, token: client.token });
    const u2 = await req('/api/users/unlock', { method: 'POST', body: { email: 'lot1-inconnu@nulle-part.example' }, token: client.token });
    check('Unlock : client sur un compte existant -> 403', u1.status === 403, `HTTP ${u1.status}`);
    check('Unlock : client sur un email inexistant -> même 403', u2.status === 403 && JSON.stringify(u2.json) === JSON.stringify(u1.json), `HTTP ${u2.status}`);
  }
  const anonUnlock = await req('/api/users/unlock', { method: 'POST', body: { email: 'admin@admin.com' } });
  check('Unlock : anonyme -> 403', anonUnlock.status === 403, `HTTP ${anonUnlock.status}`);

  // Chemins serveur des sites : lisibles par un admin seulement
  if (client.token) {
    const list = await req('/api/sites', { token: client.token });
    const s = Array.isArray(list.json) ? list.json[0] : null;
    check('Sites : client GET /api/sites sans documentRoot/repositoryPath, avec previewPath', Boolean(s) && !('documentRoot' in s) && !('repositoryPath' in s) && !('domainVerifyToken' in s) && typeof s.previewPath === 'string', JSON.stringify(s && Object.keys(s)));
    const rest = await req('/api/payload_sites?depth=0', { token: client.token });
    const d = rest.json?.docs?.[0];
    check('Sites : client GET /api/payload_sites sans chemins serveur', Boolean(d) && d.documentRoot === undefined && d.repositoryPath === undefined && d.domainVerifyToken === undefined, JSON.stringify(d && Object.keys(d)));
    const me = await req('/api/users/me', { token: client.token });
    const populated = (me.json?.user?.sites || []).find((x) => x && typeof x === 'object');
    check('Sites : client /api/users/me, sites peuplés sans chemins serveur', Boolean(populated) && populated.documentRoot === undefined && populated.repositoryPath === undefined, JSON.stringify(populated && Object.keys(populated)));
  }
  if (admin.token) {
    const list = await req('/api/sites', { token: admin.token });
    const s = Array.isArray(list.json) ? list.json.find((x) => x.slug === 'boulangerie-artisanale') : null;
    check('Sites : admin GET /api/sites avec documentRoot', Boolean(s?.documentRoot) && 'repositoryPath' in s, JSON.stringify(s && Object.keys(s)));
    const rest = await req('/api/payload_sites?depth=0&where[slug][equals]=boulangerie-artisanale', { token: admin.token });
    const d = rest.json?.docs?.[0];
    check('Sites : admin GET /api/payload_sites avec documentRoot', Boolean(d?.documentRoot), JSON.stringify(d && Object.keys(d)));
  }

  // Corps JSON : limite par route (256 Ko hors contenu/onboarding), avant toute auth
  {
    const big = { name: 'x'.repeat(3 * 1024 * 1024) };
    const r = await req('/api/sites', { method: 'POST', body: big });
    check('Corps : POST /api/sites anonyme avec 3 Mo de JSON -> 413', r.status === 413, `HTTP ${r.status}`);
  }

  // Politique de mot de passe (API REST)
  if (client.token) {
    const me = await req('/api/users/me', { token: client.token });
    const myId = me.json?.user?.id;
    if (myId) {
      const weak = await req(`/api/users/${myId}`, { method: 'PATCH', body: { password: 'abc' }, token: client.token });
      check('Mot de passe : client PATCH de son mot de passe à « abc » -> 400', weak.status === 400, `HTTP ${weak.status}`);
      const weakBulk = await req(`/api/users?where[id][equals]=${myId}`, { method: 'PATCH', body: { password: 'abc' }, token: client.token });
      check('Mot de passe : client PATCH groupé (where) à « abc » -> 400', weakBulk.status === 400, `HTTP ${weakBulk.status}`);
      const still = await login('client@client.com', CLIENT_PASSWORD);
      check('Mot de passe : refus sans effet (ancien mot de passe valide)', still.status === 200, `HTTP ${still.status}`);
    }
  }

  if (admin.token) {
    const email = 'lot1-sessions@nulle-part.example';
    const purge = async () => {
      const existing = await req(`/api/users?where[email][equals]=${encodeURIComponent(email)}`, { token: admin.token });
      const id = existing.json?.docs?.[0]?.id;
      if (id) await req(`/api/users/${id}`, { method: 'DELETE', token: admin.token });
    };
    await purge();

    const weakCreate = await req('/api/users', { method: 'POST', body: { email, password: 'abc', roles: ['client'] }, token: admin.token });
    check('Mot de passe : admin crée un compte avec « abc » -> 400', weakCreate.status === 400, `HTTP ${weakCreate.status}`);
    const sameAsEmail = await req('/api/users', { method: 'POST', body: { email, password: email, roles: ['client'] }, token: admin.token });
    check("Mot de passe : identique à l'email -> 400", sameAsEmail.status === 400, `HTTP ${sameAsEmail.status}`);

    // Révocation des sessions au changement de mot de passe
    const created = await req('/api/users', { method: 'POST', body: { email, password: STRONG, roles: ['client'] }, token: admin.token });
    const id = created.json?.doc?.id;
    check('Sessions : compte jetable créé (mot de passe robuste)', Boolean(id), `HTTP ${created.status}`);
    if (id) {
      const a = await login(email, STRONG);
      const b = await login(email, STRONG);
      const changed = await req(`/api/users/${id}`, { method: 'PATCH', body: { password: 'Nouveau-Cheval-43?' }, token: a.token });
      check('Sessions : changement de son mot de passe -> 200', changed.status === 200, `HTTP ${changed.status}`);
      const meB = await req('/api/users/me', { token: b.token });
      check('Sessions : autre session (B) révoquée après changement', meB.status === 200 && meB.json?.user === null, `user=${JSON.stringify(meB.json?.user?.email ?? null)}`);
      const meA = await req('/api/users/me', { token: a.token });
      check('Sessions : session courante (A) conservée', meA.json?.user?.email === email, `user=${JSON.stringify(meA.json?.user?.email ?? null)}`);
      check('Sessions : rôles du compte intacts après révocation', JSON.stringify(meA.json?.user?.roles) === '["client"]', JSON.stringify(meA.json?.user?.roles));

      // Changement par un admin : toutes les sessions du compte sont révoquées
      await req(`/api/users/${id}`, { method: 'PATCH', body: { password: 'Encore-Cheval-44!' }, token: admin.token });
      const meA2 = await req('/api/users/me', { token: a.token });
      check('Sessions : changement par un admin -> session du compte révoquée', meA2.json?.user === null, `user=${JSON.stringify(meA2.json?.user?.email ?? null)}`);
      const meAdmin = await req('/api/users/me', { token: admin.token });
      check("Sessions : la session de l'admin reste valide", meAdmin.json?.user?.email === 'admin@admin.com');

      const unlocked = await req('/api/users/unlock', { method: 'POST', body: { email }, token: admin.token });
      check('Unlock : admin -> 200', unlocked.status === 200, `HTTP ${unlocked.status}`);
    }
    await purge();
  }
}

// ---- Lot 2 : médias, brouillons, suppression ----
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const projectDir = path.dirname(serverDir);
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const upload = async (token, siteId, data, type, name) => {
    const form = new FormData();
    form.append('file', new Blob([data], { type }), name);
    form.append('_payload', JSON.stringify({ site: siteId }));
    const res = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: `payload-token=${token}` }, body: form });
    let json = null;
    try { json = await res.clone().json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  };
  const payloadSiteId = async (slug) => (await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token: admin.token })).json?.docs?.[0]?.id;
  const raw = (p, headers = {}) => fetch(`${BASE}${p}`, { headers: { Origin: ORIGIN, ...headers } });

  // Médiathèque : formats matriciels uniquement, taille bornée, cache privé
  if (client.token && admin.token) {
    const ownId = await payloadSiteId('boulangerie-artisanale');
    if (ownId) {
      const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>';
      const svgUp = await upload(client.token, ownId, svg, 'image/svg+xml', 'logo.svg');
      check('Media : SVG avec <script> (prologue XML) -> 400', svgUp.status === 400, `HTTP ${svgUp.status}`);
      if (svgUp.json?.doc?.id) await req(`/api/media/${svgUp.json.doc.id}`, { method: 'DELETE', token: admin.token });

      const big = Buffer.alloc(9 * 1024 * 1024, 0);
      pixel.copy(big);
      const bigUp = await upload(client.token, ownId, big, 'image/png', 'enorme.png');
      check('Media : PNG de 9 Mo -> 413', bigUp.status === 413, `HTTP ${bigUp.status}`);
      if (bigUp.json?.doc?.id) await req(`/api/media/${bigUp.json.doc.id}`, { method: 'DELETE', token: admin.token });

      const ok = await upload(client.token, ownId, pixel, 'image/png', 'pixel-lot2.png');
      check('Media : PNG 1 px -> 201', ok.status === 201, `HTTP ${ok.status}`);
      const filename = ok.json?.doc?.filename;
      if (filename) {
        const file = await raw(`/api/media/file/${encodeURIComponent(filename)}`, { Cookie: `payload-token=${client.token}` });
        const cache = file.headers.get('cache-control') || '';
        check('Media : fichier servi avec Cache-Control private', file.status === 200 && cache.includes('private'), `HTTP ${file.status} ${cache}`);
      }
      if (ok.json?.doc?.id) await req(`/api/media/${ok.json.doc.id}`, { method: 'DELETE', token: admin.token });
    }
  }

  // Aperçu : un SVG présent dans un site est servi dans un bac à sable ; les copies de
  // bascule interrompues ne sont jamais servies
  {
    const siteDir = path.join(projectDir, 'simulated_public_html', 'boulangerie-artisanale');
    const createdDir = !fs.existsSync(siteDir);
    fs.mkdirSync(siteDir, { recursive: true });
    const svgFile = path.join(siteDir, 'csp-test.svg');
    fs.writeFileSync(svgFile, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    try {
      const r = await raw('/preview/boulangerie-artisanale/csp-test.svg');
      const csp = r.headers.get('content-security-policy') || '';
      check('Aperçu : SVG servi avec une CSP « sandbox »', r.status === 200 && csp.includes('sandbox'), `HTTP ${r.status} ${csp}`);
    } finally {
      fs.rmSync(svgFile, { force: true });
      if (createdDir) fs.rmSync(siteDir, { recursive: true, force: true });
    }
    const swapDir = path.join(projectDir, 'simulated_public_html', 'sc-bascule.tmp-deploy');
    fs.mkdirSync(swapDir, { recursive: true });
    fs.writeFileSync(path.join(swapDir, 'index.html'), '<h1>copie interrompue</h1>');
    try {
      const r = await raw('/preview/sc-bascule.tmp-deploy/index.html');
      check('Aperçu : copie de bascule (.tmp-*) jamais servie -> 404', r.status === 404, `HTTP ${r.status}`);
    } finally {
      fs.rmSync(swapDir, { recursive: true, force: true });
    }
  }

  // Brouillons : réservés aux comptes ayant accès au site
  {
    const draftDir = path.join(projectDir, 'drafts', 'boulangerie-artisanale');
    const draftFile = path.join(draftDir, 'index.html');
    const createdDraftDir = !fs.existsSync(draftDir);
    const createdDraft = !fs.existsSync(draftFile);
    if (createdDraft) {
      fs.mkdirSync(draftDir, { recursive: true });
      fs.writeFileSync(draftFile, '<!doctype html><title>Brouillon</title>');
    }
    const url = '/draft/boulangerie-artisanale/index.html';
    try {
      const anonHtml = await raw(url, { Accept: 'text/html' });
      check('Brouillon : anonyme (navigateur) -> 401 en page HTML', anonHtml.status === 401 && (anonHtml.headers.get('content-type') || '').includes('text/html'), `HTTP ${anonHtml.status}`);
      const anonJson = await raw(url, { Accept: 'application/json' });
      check('Brouillon : anonyme (API) -> 401 JSON', anonJson.status === 401 && (anonJson.headers.get('content-type') || '').includes('json'), `HTTP ${anonJson.status}`);

      if (client.token) {
        const own = await raw(url, { Cookie: `payload-token=${client.token}` });
        const cache = own.headers.get('cache-control') || '';
        check('Brouillon : propriétaire -> 200 avec no-store', own.status === 200 && cache.includes('no-store'), `HTTP ${own.status} ${cache}`);
        const traversal = await raw('/draft/..%2F..%2Fetc/passwd', { Cookie: `payload-token=${client.token}` });
        check('Brouillon : traversée encodée -> jamais 200', traversal.status !== 200, `HTTP ${traversal.status}`);
        const traversal2 = await raw('/draft/%2e%2e/%2e%2e/server/.env', { Cookie: `payload-token=${client.token}` });
        check('Brouillon : traversée « %2e%2e » -> jamais 200', traversal2.status !== 200, `HTTP ${traversal2.status}`);
      }

      if (admin.token) {
        // Client d'un AUTRE site : compte jetable rattaché à un site jetable
        const email = 'sec-check-draft@nulle-part.example';
        const existing = await req(`/api/users?where[email][equals]=${encodeURIComponent(email)}`, { token: admin.token });
        if (existing.json?.docs?.[0]?.id) await req(`/api/users/${existing.json.docs[0].id}`, { method: 'DELETE', token: admin.token });
        const other = await req('/api/sites', { method: 'POST', body: { name: 'Brouillon SC' }, token: admin.token });
        const otherSlug = other.json?.site?.slug;
        const otherId = otherSlug ? await payloadSiteId(otherSlug) : null;
        const user = otherId
          ? await req('/api/users', { method: 'POST', body: { email, password: 'Cheval-Correct-42!', roles: ['client'], sites: [otherId] }, token: admin.token })
          : null;
        const otherLogin = user?.json?.doc?.id ? await login(email, 'Cheval-Correct-42!') : { token: null };
        if (otherLogin.token) {
          const foreign = await raw(url, { Cookie: `payload-token=${otherLogin.token}` });
          check("Brouillon : client d'un autre site -> 403", foreign.status === 403, `HTTP ${foreign.status}`);
        } else {
          check("Brouillon : client d'un autre site -> 403", false, 'compte de test non créé');
        }
        if (user?.json?.doc?.id) await req(`/api/users/${user.json.doc.id}`, { method: 'DELETE', token: admin.token });
        if (otherSlug) await req(`/api/sites/${otherSlug}`, { method: 'DELETE', token: admin.token });
      }
    } finally {
      if (createdDraftDir) fs.rmSync(draftDir, { recursive: true, force: true });
      else if (createdDraft) fs.rmSync(draftFile, { force: true });
    }
  }

  // Suppression d'un site : ses médias (fiches et fichiers) partent avec lui
  if (admin.token) {
    const created = await req('/api/sites', { method: 'POST', body: { name: 'Suppression SC' }, token: admin.token });
    const slug = created.json?.site?.slug;
    const siteId = slug ? await payloadSiteId(slug) : null;
    if (siteId) {
      const up = await upload(admin.token, siteId, pixel, 'image/png', 'suppression-sc.png');
      const mediaId = up.json?.doc?.id;
      const filename = up.json?.doc?.filename;
      check('Suppression : média téléversé sur le site', up.status === 201 && Boolean(filename), `HTTP ${up.status}`);
      const del = await req(`/api/sites/${slug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
      check('Suppression : DELETE ?deleteFiles=true (simulation) -> 200', del.status === 200 && (del.json?.remote ?? null) === null, `HTTP ${del.status} remote=${JSON.stringify(del.json?.remote)}`);
      const left = await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token: admin.token });
      check('Suppression : fiche payload_sites retirée', left.json?.totalDocs === 0, `${left.json?.totalDocs} fiche(s)`);
      if (mediaId) {
        check('Suppression : fiche média retirée -> 404', (await req(`/api/media/${mediaId}`, { token: admin.token })).status === 404);
      }
      if (filename) {
        const file = await raw(`/api/media/file/${encodeURIComponent(filename)}`, { Cookie: `payload-token=${admin.token}` });
        // Payload ne cherche pas la fiche pour un admin (accès total) : fichier absent du
        // disque -> 500 générique côté admin, 404 pour un client. Jamais 200.
        check('Suppression : fichier média plus servi', file.status !== 200 && file.status >= 400, `HTTP ${file.status}`);
        check('Suppression : fichier média effacé du disque', !fs.existsSync(path.join(serverDir, 'uploads', filename)));
      }
    } else if (slug) {
      check('Suppression : site de test créé dans Payload', false);
      await req(`/api/sites/${slug}`, { method: 'DELETE', token: admin.token });
    }
  }

  // Duplication : le jumeau reçoit ses propres copies d'images, citées par ses pages
  if (admin.token) {
    const created = await req('/api/sites', { method: 'POST', body: { name: 'Duplication SC' }, token: admin.token });
    const slug = created.json?.site?.slug;
    const siteId = slug ? await payloadSiteId(slug) : null;
    let twinSlug = null;
    if (siteId) {
      const up = await upload(admin.token, siteId, pixel, 'image/png', 'duplication-sc.png');
      const filename = up.json?.doc?.filename;
      const imageUrl = `/api/media/file/${filename}`;
      const save = await req(`/api/site-pages?site=${slug}`, {
        method: 'POST',
        body: { docs: [{ title: 'Accueil', slug: 'home', layout: [{ blockType: 'hero', title: 'Bienvenue', backgroundImage: imageUrl }] }] },
        token: admin.token,
      });
      const dup = await req(`/api/sites/${slug}/duplicate`, { method: 'POST', token: admin.token });
      twinSlug = dup.json?.site?.slug || null;
      const twinId = twinSlug ? await payloadSiteId(twinSlug) : null;
      if (filename && save.status === 200 && twinId) {
        const twinMedia = await req(`/api/media?where[site][equals]=${twinId}&depth=0`, { token: admin.token });
        const newName = twinMedia.json?.docs?.[0]?.filename;
        check('Duplication : le jumeau possède 1 média', twinMedia.json?.totalDocs === 1, `${twinMedia.json?.totalDocs} média(s)`);
        const twinPages = JSON.stringify((await req(`/api/site-pages?site=${twinSlug}`, { token: admin.token })).json || {});
        check('Duplication : les pages du jumeau citent la copie', Boolean(newName) && newName !== filename && twinPages.includes(`/api/media/file/${newName}`) && !twinPages.includes(imageUrl), `${filename} -> ${newName}`);
      } else {
        check('Duplication : préparation du site source', false, `upload=${up.status} pages=${save.status} jumeau=${twinSlug}`);
      }
    }
    if (twinSlug) await req(`/api/sites/${twinSlug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
    if (slug) await req(`/api/sites/${slug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
  }
}

// ---- Lot 3 : santé ----
{
  const live = await req('/api/health');
  check('Santé : GET /api/health anonyme -> 200 status ok', live.status === 200 && live.json?.status === 'ok' && Number.isFinite(live.json?.uptimeS), `HTTP ${live.status}`);
  const ready = await req('/api/health/ready');
  check('Santé : GET /api/health/ready -> 200 avec database ok', ready.status === 200 && ready.json?.checks?.database === 'ok', `HTTP ${ready.status} ${JSON.stringify(ready.json)}`);
  check('Santé : ready détaille storage et build', ready.json?.checks?.storage === 'ok' && typeof ready.json?.checks?.build?.inProgress === 'boolean' && Number.isInteger(ready.json?.checks?.build?.queueLength));
  // Aucune fuite : ni chaîne de connexion, ni secret, ni chemin absolu, ni version
  const bodies = `${JSON.stringify(live.json)}${JSON.stringify(ready.json)}`;
  const secret = process.env.PAYLOAD_SECRET;
  check('Santé : réponses sans chaîne de connexion postgres://', !bodies.includes('postgres://'));
  check('Santé : réponses sans PAYLOAD_SECRET', !secret || !bodies.includes(secret));
  check('Santé : réponses sans chemin absolu', !/"(\/[A-Za-z0-9._-]+){2,}|[A-Za-z]:\\\\/.test(bodies), bodies);
  check('Santé : réponses sans numéro de version', !/version/i.test(bodies));
}

// ---- Lot 5 ----
// Ordre du menu (navOrder) : contrôle distinct du tri alphabétique ci-dessus. Sauvegarde
// ciblée : renvoyer tel quel ce que l'éditeur a lu ne réécrit aucune page.
if (admin.token) {
  const created = await req('/api/sites', { method: 'POST', body: { name: 'Ordre menu SC' }, token: admin.token });
  const slug = created.json?.site?.slug;
  if (slug) {
    const url = `/api/site-pages?site=${slug}`;
    const pg = (s, extra = {}) => ({ title: s, slug: s, layout: [], ...extra });
    const order = async () => ((await req(url, { token: admin.token })).json?.docs || []).map((p) => p.slug).join(',');
    await req(url, { method: 'POST', body: { docs: [pg('home'), pg('tarifs'), pg('equipe')] }, token: admin.token });
    check('Pages : ordre du menu conservé (home, tarifs, equipe)', (await order()) === 'home,tarifs,equipe', await order());
    await req(url, { method: 'POST', body: { docs: [pg('equipe'), pg('tarifs'), pg('home')] }, token: admin.token });
    check("Pages : ordre du menu inversé à l'enregistrement", (await order()) === 'equipe,tarifs,home', await order());

    const badNav = await req(url, { method: 'POST', body: { docs: [pg('home', { hideFromNav: 'oui' })] }, token: admin.token });
    check('Pages : hideFromNav non booléen -> 400', badNav.status === 400, `HTTP ${badNav.status}`);

    // Contenu varié (listes, cases, groupe, galerie), masqué du menu, puis aller-retour
    const layout = [
      { blockType: 'hero', title: 'Bienvenue', subtitle: '', ctaText: 'Voir' },
      { blockType: 'gallery', title: 'Photos', images: ['https://exemple.fr/a.jpg'] },
      { blockType: 'pricing', title: 'Tarifs', plans: [{ name: 'Base', price: '0 €', isPopular: false, features: [{ feature: 'x' }] }] },
      { blockType: 'testimonials', title: 'Avis', testimonials: [{ quote: 'Super', author: 'A', rating: 5 }] },
      { blockType: 'footer', text: '©', socials: { instagram: 'https://instagram.com/x' } },
    ];
    await req(url, { method: 'POST', body: { docs: [pg('home', { layout }), pg('tarifs', { hideFromNav: true }), pg('equipe')] }, token: admin.token });
    const read = await req(url, { token: admin.token });
    const tarifs = read.json?.docs?.find((p) => p.slug === 'tarifs');
    check('Pages : hideFromNav enregistré et relu', tarifs?.hideFromNav === true, JSON.stringify(tarifs?.hideFromNav));
    const siteDoc = await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token: admin.token });
    const siteId = siteDoc.json?.docs?.[0]?.id;
    const stamps = async () => ((await req(`/api/pages?where[site][equals]=${siteId}&depth=0&limit=50&sort=slug`, { token: admin.token })).json?.docs || []).map((p) => `${p.slug}@${p.updatedAt}`).join(',');
    if (siteId && Array.isArray(read.json?.docs)) {
      const before = await stamps();
      const resave = await req(url, { method: 'POST', body: { docs: read.json.docs }, token: admin.token });
      const after = await stamps();
      check("Pages : renvoyer le contenu lu n'écrit aucune page (sauvegarde ciblée)", resave.status === 200 && before !== '' && before === after, `${before} → ${after}`);
    }
    await req(`/api/sites/${slug}`, { method: 'DELETE', token: admin.token });
  }
}

// ---- Rate-limit login (EN DERNIER : consomme le budget d'échecs de l'IP) ----
// Les connexions réussies ne comptent pas (skipSuccessfulRequests) : seules les
// tentatives ratées ci-dessous épuisent le quota jusqu'au 429. On cible un email
// INEXISTANT : le rate-limit par IP se déclenche quand même (échecs = 401), mais on
// évite de verrouiller un compte réel (Payload lock maxLoginAttempts).
{
  let saw429 = false;
  let attempts = 0;
  for (let i = 0; i < 20 && !saw429; i++) {
    attempts++;
    const r = await req('/api/users/login', { method: 'POST', body: { email: 'rate-limit-probe@nulle-part.example', password: 'mauvais-mot-de-passe' } });
    if (r.status === 429) saw429 = true;
  }
  check('Rate-limit : les tentatives de connexion échouées finissent par renvoyer 429', saw429, `429 après ${attempts} essais`);
}

console.log(failures === 0 ? '\n✔ Matrice de sécurité : tous les contrôles passent.' : `\n✖ ${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
