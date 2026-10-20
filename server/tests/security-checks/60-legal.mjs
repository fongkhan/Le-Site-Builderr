// Informations légales d'un site (GET/PUT /api/sites/:slug/legal) : propriétaire ou admin,
// saisie validée, jamais modifiable par l'API REST Payload pour un client. Aucun POST
// /api/contact, aucun échec de connexion ; l'objet initial est restauré en fin de contrôle.
export default async function ({ req, check, admin, client }) {
  const own = '/api/sites/boulangerie-artisanale/legal';
  const other = '/api/sites/site-dun-autre/legal';

  check('Infos légales : lecture anonyme -> 401', (await req(own)).status === 401);
  check('Infos légales : écriture anonyme -> 401', (await req(own, { method: 'PUT', body: {} })).status === 401);
  if (!client.token) return;

  const initial = await req(own, { token: client.token });
  check(
    'Infos légales : propriétaire -> 200 (champs manquants, conservation 12 mois)',
    initial.status === 200 && Array.isArray(initial.json?.missing) && initial.json?.retentionMonths === 12 && typeof initial.json?.legal === 'object',
    `HTTP ${initial.status}`
  );
  check("Infos légales : lecture d'un autre site -> 403", (await req(other, { token: client.token })).status === 403);
  check("Infos légales : écriture sur un autre site -> 403", (await req(other, { method: 'PUT', body: {}, token: client.token })).status === 403);
  if (initial.status !== 200) return;

  for (const [label, body] of [
    ['champ hors liste (documentRoot)', { documentRoot: '/etc' }],
    ['email invalide', { email: 'pas-un-email' }],
    ['valeur objet', { companyName: { $ne: '' } }],
    ['201 caractères', { companyName: 'x'.repeat(201) }],
  ]) {
    const r = await req(own, { method: 'PUT', body, token: client.token });
    check(`Infos légales : ${label} -> 400`, r.status === 400 && typeof r.json?.error === 'string', `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  }

  const statusOf = async () => ((await req('/api/sites', { token: client.token })).json || []).find?.((s) => s.slug === 'boulangerie-artisanale')?.status;
  const statusBefore = await statusOf();
  const legal = {
    ...initial.json.legal,
    companyName: `Boulangerie <script>alert(1)</script> ${process.pid}`,
    address: '1 rue du Pain\n75001 Paris',
    email: 'contact@boulangerie.example',
    phone: '01 23 45 67 89',
  };
  const saved = await req(own, { method: 'PUT', body: legal, token: client.token });
  check('Infos légales : saisie valide par le propriétaire -> 200', saved.status === 200 && saved.json?.success === true, `HTTP ${saved.status} ${JSON.stringify(saved.json)}`);
  const reread = await req(own, { token: client.token });
  check(
    'Infos légales : relecture identique (HTML conservé comme texte)',
    reread.status === 200 && reread.json?.legal?.companyName === legal.companyName && reread.json?.legal?.address === legal.address && reread.json?.legal?.email === legal.email,
    JSON.stringify(reread.json?.legal)
  );
  check('Infos légales : statut du site inchangé', (await statusOf()) === statusBefore, `${statusBefore} -> ${await statusOf()}`);

  // API REST Payload : la fiche du site reste réservée aux admins, champ legal compris
  const siteRes = await req('/api/payload_sites?where[slug][equals]=boulangerie-artisanale&limit=1&depth=0', { token: client.token });
  const siteId = siteRes.json?.docs?.[0]?.id;
  if (siteId !== undefined) {
    const patched = await req(`/api/payload_sites/${siteId}`, { method: 'PATCH', body: { legal: { companyName: 'Forgé' } }, token: client.token });
    check('Infos légales : PATCH REST Payload par un client -> 403', patched.status === 403, `HTTP ${patched.status}`);
    const after = await req(own, { token: client.token });
    check('Infos légales : saisie intacte après la tentative REST', after.json?.legal?.companyName === legal.companyName);
  } else {
    check('Infos légales : identifiant Payload du site lisible par son propriétaire', false, `HTTP ${siteRes.status}`);
  }

  if (admin.token) {
    const adminRead = await req(own, { token: admin.token });
    check('Infos légales : admin -> 200', adminRead.status === 200 && adminRead.json?.legal?.companyName === legal.companyName, `HTTP ${adminRead.status}`);
  }

  // Restauration de l'objet initial
  const restored = await req(own, { method: 'PUT', body: initial.json.legal, token: client.token });
  check('Infos légales : objet initial restauré', restored.status === 200 && JSON.stringify(restored.json?.legal) === JSON.stringify(initial.json.legal), `HTTP ${restored.status}`);
}
