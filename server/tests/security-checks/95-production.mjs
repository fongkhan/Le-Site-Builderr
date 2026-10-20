// Lot 10 — production : optimiseur d'images de Next fermé, grandes images ramenées à
// 2400 px (sharp), et, si EXPECT_ORCHESTRATOR=true (serveur démarré par
// « npm run start:prod » avec orchestrator/dist construit), interface de l'orchestrateur
// servie sur la même origine sans masquer l'API, l'admin Payload ni un fichier sensible.
// Tout ce qui est créé ici est nettoyé (aucun échec de connexion).
import zlib from 'node:zlib';

// PNG en niveaux de gris (8 bits), généré à la volée : width × height pixels gris moyen
function grayPng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 0; // niveaux de gris
  const row = Buffer.alloc(width + 1, 0x80);
  row[0] = 0; // filtre « aucun »
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export default async function ({ BASE, ORIGIN, req, check, admin, client }) {
  const raw = (p, headers = {}) => fetch(`${BASE}${p}`, { headers: { Origin: ORIGIN, ...headers } });

  // ---- Optimiseur d'images de Next : jamais atteint ----
  {
    const r = await raw('/_next/image?url=%2Ffavicon.svg&w=64&q=75');
    const body = await r.json().catch(() => null);
    check("Optimiseur d'images Next : /_next/image -> 404 JSON", r.status === 404 && body?.error === 'Ressource introuvable.', `HTTP ${r.status} ${JSON.stringify(body)}`);
  }

  // ---- Grandes photos ramenées à 2400 px de large ----
  if (client.token && admin.token) {
    const siteId = (await req('/api/payload_sites?where[slug][equals]=boulangerie-artisanale&depth=0', { token: admin.token })).json?.docs?.[0]?.id;
    if (siteId) {
      const form = new FormData();
      form.append('file', new Blob([grayPng(3000, 10)], { type: 'image/png' }), 'large-sc-production.png');
      form.append('_payload', JSON.stringify({ site: siteId }));
      const res = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: `payload-token=${client.token}` }, body: form });
      const json = await res.json().catch(() => null);
      const doc = json?.doc;
      try {
        check('Media : image de 3000 px ramenée à 2400 px', res.status === 201 && doc?.width === 2400, `HTTP ${res.status} ${doc?.width}×${doc?.height}`);
      } finally {
        if (doc?.id) await req(`/api/media/${doc.id}`, { method: 'DELETE', token: admin.token });
      }
    } else {
      check('Media : image de 3000 px ramenée à 2400 px', false, 'site boulangerie-artisanale introuvable');
    }
  }

  // ---- Interface de l'orchestrateur servie en production ----
  if (process.env.EXPECT_ORCHESTRATOR === 'true') {
    const html = { Accept: 'text/html' };
    const home = await raw('/', html);
    const homeBody = await home.text();
    check('Production : GET / -> interface de l\'orchestrateur (id="root")', home.status === 200 && homeBody.includes('id="root"'), `HTTP ${home.status}`);
    check('Production : page de l\'interface jamais mise en cache, non indexée, non encadrable',
      (home.headers.get('cache-control') || '') === 'no-cache'
        && (home.headers.get('x-robots-tag') || '').includes('noindex')
        && (home.headers.get('content-security-policy') || '').includes("frame-ancestors 'self'"),
      `${home.headers.get('cache-control')} | ${home.headers.get('x-robots-tag')} | ${home.headers.get('content-security-policy')}`);

    const asset = homeBody.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    const assetRes = asset ? await raw(asset) : null;
    check('Production : fichiers /assets/* servis avec un cache long (immutable)', Boolean(assetRes) && assetRes.status === 200 && (assetRes.headers.get('cache-control') || '').includes('immutable'), `${asset} HTTP ${assetRes?.status} ${assetRes?.headers.get('cache-control')}`);

    const design = await raw('/sites/boulangerie-artisanale/design', html);
    check('Production : /sites/<slug>/design -> interface (routage côté navigateur)', design.status === 200 && (await design.text()).includes('id="root"'), `HTTP ${design.status}`);

    const env = await raw('/server/.env', html);
    check('Production : /server/.env jamais servi', env.status !== 200, `HTTP ${env.status}`);

    const adminLogin = await raw('/admin/login', html);
    const adminBody = await adminLogin.text();
    check("Production : /admin/login -> page de l'admin Payload (pas l'interface)", adminLogin.status === 200 && (adminLogin.headers.get('content-type') || '').includes('text/html') && !adminBody.includes('id="root"') && adminBody.includes('/_next/'), `HTTP ${adminLogin.status}`);

    const api = await raw('/api/sites', html);
    const apiBody = await api.json().catch(() => null);
    check('Production : /api/sites anonyme -> 401 JSON (jamais l\'interface)', api.status === 401 && Boolean(apiBody?.error), `HTTP ${api.status}`);
  }
}
