// Médiathèque d'un site (lot 4) : routes /api/sites/:slug/media (ownership), texte
// alternatif nettoyé, suppression REST réservée aux admins, suppression contrôlée par
// l'usage (pages et articles brouillons), canal interne du build fermé sans jeton.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PNG 1×1 valide (dimensions lues par Payload)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function ({ BASE, ORIGIN, req, check, admin, client }) {
  const OWN = 'boulangerie-artisanale';
  const upload = async (token, siteId, name) => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), name);
    form.append('_payload', JSON.stringify({ site: siteId }));
    const res = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: `payload-token=${token}` }, body: form });
    let json = null;
    try { json = await res.clone().json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  };
  const payloadSiteId = async (slug) => (await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token: admin.token })).json?.docs?.[0]?.id;
  const mediaPath = (slug, id) => `/api/sites/${slug}/media${id === undefined ? '' : `/${id}`}`;

  // ---- Fermé aux anonymes et aux autres clients ----
  check('Médiathèque : GET anonyme -> 401', (await req(mediaPath(OWN))).status === 401);
  check('Médiathèque : /internal/site-media sans jeton -> 401', (await req(`/internal/site-media?site=${OWN}`)).status === 401);
  if (client.token) {
    check("Médiathèque : client, GET d'un autre site -> 403", (await req(mediaPath('site-dun-autre'), { token: client.token })).status === 403);
    check("Médiathèque : client, PATCH d'un autre site -> 403", (await req(mediaPath('site-dun-autre', 1), { method: 'PATCH', body: { alt: 'x' }, token: client.token })).status === 403);
    check("Médiathèque : client, DELETE d'un autre site -> 403", (await req(mediaPath('site-dun-autre', 1), { method: 'DELETE', token: client.token })).status === 403);
  }
  if (!client.token || !admin.token) return;

  // ---- Client : son image, texte alternatif, suppression ----
  const ownId = await payloadSiteId(OWN);
  const up = ownId ? await upload(client.token, ownId, 'mediatheque-sc.png') : { status: 0, json: null };
  const id = up.json?.doc?.id;
  const filename = up.json?.doc?.filename;
  check('Médiathèque : client, PNG téléversé sur SON site -> 201', up.status === 201 && Boolean(id), `HTTP ${up.status}`);
  if (id) {
    check('Médiathèque : fichier téléversé présent sur le disque', Boolean(filename) && fs.existsSync(path.join(serverDir, 'uploads', filename)), filename);
    try {
      const list = await req(mediaPath(OWN), { token: client.token });
      const item = (list.json?.items || []).find((i) => String(i.id) === String(id));
      check('Médiathèque : image listée avec ses dimensions et sans usage', list.status === 200 && item?.width === 1 && item?.height === 1 && Array.isArray(item?.usedIn) && item.usedIn.length === 0, `HTTP ${list.status} ${JSON.stringify(item)}`);

      const cleaned = await req(mediaPath(OWN, id), { method: 'PATCH', body: { alt: '  Pixel\n de test ' }, token: client.token });
      check('Médiathèque : PATCH alt -> 200 texte nettoyé', cleaned.status === 200 && cleaned.json?.alt === 'Pixel de test', `HTTP ${cleaned.status} ${JSON.stringify(cleaned.json?.alt)}`);
      const long = await req(mediaPath(OWN, id), { method: 'PATCH', body: { alt: 'x'.repeat(300) }, token: client.token });
      check('Médiathèque : PATCH alt de 300 caractères -> 200 tronqué à 200', long.status === 200 && long.json?.alt?.length === 200, `HTTP ${long.status} ${long.json?.alt?.length}`);
      check('Médiathèque : PATCH alt non textuel -> 400', (await req(mediaPath(OWN, id), { method: 'PATCH', body: { alt: 42 }, token: client.token })).status === 400);
      check('Médiathèque : PATCH id invalide -> 400', (await req(mediaPath(OWN, 'abc'), { method: 'PATCH', body: { alt: 'x' }, token: client.token })).status === 400);

      const rest = await req(`/api/media/${id}`, { method: 'DELETE', token: client.token });
      check('Médiathèque : DELETE REST Payload par un client -> 403', rest.status === 403, `HTTP ${rest.status}`);
      check('Médiathèque : fiche conservée après le refus REST', (await req(`/api/media/${id}?depth=0`, { token: admin.token })).status === 200);

      const del = await req(mediaPath(OWN, id), { method: 'DELETE', token: client.token });
      check('Médiathèque : DELETE par la médiathèque (image inutilisée) -> 200', del.status === 200 && del.json?.success === true, `HTTP ${del.status} ${JSON.stringify(del.json)}`);
      check('Médiathèque : fiche supprimée -> 404', (await req(`/api/media/${id}?depth=0`, { token: admin.token })).status === 404);
      check('Médiathèque : fichier effacé du disque', Boolean(filename) && !fs.existsSync(path.join(serverDir, 'uploads', filename)), filename);
    } finally {
      // Filet de sécurité : jamais d'image de test laissée sur le site du client
      await req(`/api/media/${id}`, { method: 'DELETE', token: admin.token });
    }
  }

  // ---- Suppression refusée tant qu'un contenu cite l'image ----
  const created = await req('/api/sites', { method: 'POST', body: { name: 'Mediatheque SC' }, token: admin.token });
  const slug = created.json?.site?.slug;
  try {
    const siteId = slug ? await payloadSiteId(slug) : null;
    const upA = siteId ? await upload(admin.token, siteId, 'mediatheque-a.png') : null;
    const upB = siteId ? await upload(admin.token, siteId, 'mediatheque-b.png') : null;
    const a = upA?.json?.doc;
    const b = upB?.json?.doc;
    const savePage = (backgroundImage) => req(`/api/site-pages?site=${slug}`, {
      method: 'POST',
      body: { docs: [{ title: 'Accueil', slug: 'home', layout: [{ blockType: 'hero', title: 'Bienvenue', ...(backgroundImage ? { backgroundImage } : {}) }] }] },
      token: admin.token,
    });
    const page = a ? await savePage(`/api/media/file/${encodeURIComponent(a.filename)}`) : null;
    const post = b
      ? await req(`/api/site-posts?site=${slug}`, { method: 'POST', body: { title: 'Brouillon SC', coverImage: `/api/media/file/${encodeURIComponent(b.filename)}`, status: 'draft' }, token: admin.token })
      : null;
    if (!a || !b || page?.status !== 200 || post?.status !== 200) {
      check('Médiathèque : préparation du site de test', false, `site=${slug} A=${upA?.status} B=${upB?.status} page=${page?.status} article=${post?.status}`);
      return;
    }
    const inPage = await req(mediaPath(slug, a.id), { method: 'DELETE', token: admin.token });
    check('Médiathèque : image citée par une page -> 409 (usage nommé)', inPage.status === 409 && inPage.json?.usedIn?.[0]?.title === 'Accueil' && /Accueil/.test(inPage.json?.error || ''), `HTTP ${inPage.status} ${JSON.stringify(inPage.json)}`);
    const inDraft = await req(mediaPath(slug, b.id), { method: 'DELETE', token: admin.token });
    check('Médiathèque : image citée par un article brouillon -> 409', inDraft.status === 409 && inDraft.json?.usedIn?.[0]?.draft === true, `HTTP ${inDraft.status} ${JSON.stringify(inDraft.json?.usedIn)}`);
    check('Médiathèque : images refusées toujours présentes', (await req(`/api/media/${a.id}?depth=0`, { token: admin.token })).status === 200 && (await req(`/api/media/${b.id}?depth=0`, { token: admin.token })).status === 200);

    // Le client vise l'image d'un autre site par SON site : introuvable, jamais modifiée
    const foreignPatch = await req(mediaPath(OWN, a.id), { method: 'PATCH', body: { alt: 'Détournée' }, token: client.token });
    check("Médiathèque : client, PATCH de l'image d'un autre site via son site -> 404", foreignPatch.status === 404, `HTTP ${foreignPatch.status}`);
    const foreignDelete = await req(mediaPath(OWN, a.id), { method: 'DELETE', token: client.token });
    check("Médiathèque : client, DELETE de l'image d'un autre site via son site -> 404", foreignDelete.status === 404, `HTTP ${foreignDelete.status}`);
    const afterForeign = await req(`/api/media/${a.id}?depth=0`, { token: admin.token });
    check("Médiathèque : image de l'autre site intacte", afterForeign.status === 200 && !afterForeign.json?.alt, JSON.stringify(afterForeign.json?.alt));

    const resaved = await savePage(null);
    const freed = await req(mediaPath(slug, a.id), { method: 'DELETE', token: admin.token });
    check("Médiathèque : image retirée de la page -> suppression 200", resaved.status === 200 && freed.status === 200, `pages=${resaved.status} HTTP ${freed.status}`);
  } finally {
    if (slug) await req(`/api/sites/${slug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
  }
}
