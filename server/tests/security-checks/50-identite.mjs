// Identité des sites publiés : avertissements de contraste (jamais bloquants), logo limité
// à la médiathèque DU site (API du thème et REST Payload), logo publié dans le brouillon.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const BASE_THEME = {
  colors: { primary: '#8B5A2B', secondary: '#F5E6CC', background: '#FAFAFA', text: '#2D241E' },
  fonts: { heading: 'Playfair Display', body: 'Inter' },
  radius: '12px',
};
const OWN_SLUG = 'boulangerie-artisanale';

export default async function ({ BASE, ORIGIN, req, check, admin, client }) {
  if (!admin.token || !client.token) {
    check('Identité : comptes de démonstration connectés', false);
    return;
  }
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const projectDir = path.dirname(serverDir);

  const upload = async (token, siteId, name) => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), name);
    form.append('_payload', JSON.stringify({ site: siteId }));
    const res = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: `payload-token=${token}` }, body: form });
    let json = null;
    try { json = await res.clone().json(); } catch { /* non-JSON */ }
    return { status: res.status, doc: json?.doc };
  };
  const payloadSiteId = async (slug) => (await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token: admin.token })).json?.docs?.[0]?.id;
  const postTheme = (token, theme, slug = OWN_SLUG) => req(`/api/theme?site=${slug}`, { method: 'POST', body: { theme }, token });

  // Thème actuel du site de démonstration : remis en fin de contrôle
  const before = (await req(`/api/theme?site=${OWN_SLUG}`, { token: admin.token })).json?.theme;
  const ownId = await payloadSiteId(OWN_SLUG);
  let ownMedia = null;
  let otherSlug = null;
  try {
    // Contraste insuffisant : enregistré quand même, avec un avertissement lisible
    const grey = await postTheme(client.token, { ...BASE_THEME, colors: { ...BASE_THEME.colors, background: '#ffffff', text: '#999999' } });
    const warnings = grey.json?.warnings;
    check('Thème : contraste insuffisant -> 200 avec avertissement', grey.status === 200 && Array.isArray(warnings) && warnings.some((w) => w.includes('2,8:1')), `HTTP ${grey.status} ${JSON.stringify(warnings)}`);
    const ok = await postTheme(client.token, BASE_THEME);
    check('Thème : thème lisible -> 200 sans avertissement', ok.status === 200 && Array.isArray(ok.json?.warnings) && ok.json.warnings.length === 0, `HTTP ${ok.status} ${JSON.stringify(ok.json?.warnings)}`);

    // Logos refusés : schémas dangereux, URL externe, traversée encodée, SVG
    for (const [label, logo] of [
      ['javascript:', 'javascript:alert(1)'],
      ['https externe', 'https://cdn.example/logo.png'],
      ['..%2F', '/api/media/file/..%2Fx.png'],
      ['.svg', '/api/media/file/logo.svg'],
    ]) {
      const r = await postTheme(client.token, { ...BASE_THEME, logo });
      check(`Thème : logo ${label} -> 400`, r.status === 400 && /Logo invalide/.test(r.json?.error || ''), `HTTP ${r.status} ${JSON.stringify(r.json)}`);
    }

    // Logo d'un autre site (fichier téléversé par l'admin sur un site de test)
    const other = await req('/api/sites', { method: 'POST', body: { name: 'Identite SC' }, token: admin.token });
    otherSlug = other.json?.site?.slug || null;
    const otherId = otherSlug ? await payloadSiteId(otherSlug) : null;
    const otherMedia = otherId ? (await upload(admin.token, otherId, 'identite-sc.png')).doc : null;
    if (otherMedia?.url) {
      const foreign = await postTheme(client.token, { ...BASE_THEME, logo: otherMedia.url });
      check("Thème : logo d'un autre site -> 400", foreign.status === 400 && /médiathèque du site/.test(foreign.json?.error || ''), `HTTP ${foreign.status} ${JSON.stringify(foreign.json)}`);
    } else {
      check("Thème : logo d'un autre site -> 400", false, 'site ou média de test non créé');
    }

    // Logo de la médiathèque du site : accepté et relu
    ownMedia = ownId ? (await upload(client.token, ownId, 'logo-identite-sc.png')).doc : null;
    if (ownMedia?.url) {
      const saved = await postTheme(client.token, { ...BASE_THEME, logo: ownMedia.url });
      const read = await req(`/api/theme?site=${OWN_SLUG}`, { token: client.token });
      check('Thème : logo de la médiathèque du site -> 200 et relu par GET /api/theme', saved.status === 200 && read.json?.theme?.logo === `/api/media/file/${ownMedia.filename}`, `HTTP ${saved.status} ${JSON.stringify(read.json?.theme?.logo)}`);
      const removed = await postTheme(client.token, BASE_THEME);
      const reread = await req(`/api/theme?site=${OWN_SLUG}`, { token: client.token });
      check('Thème : logo retiré -> absent à la relecture', removed.status === 200 && !reread.json?.theme?.logo, JSON.stringify(reread.json?.theme?.logo));
    } else {
      check('Thème : logo de la médiathèque du site -> 200 et relu par GET /api/theme', false, 'média de test non téléversé');
    }

    // REST Payload : même règle de format sur la collection themes (jeton client)
    const themeDoc = ownId ? (await req(`/api/themes?where[site][equals]=${ownId}&depth=0`, { token: client.token })).json?.docs?.[0] : null;
    if (themeDoc?.id) {
      const patch = await req(`/api/themes/${themeDoc.id}`, { method: 'PATCH', body: { logo: 'javascript:alert(1)' }, token: client.token });
      check("Thème : logo javascript: via PATCH /api/themes/:id (REST Payload) -> 400", patch.status === 400, `HTTP ${patch.status}`);
    } else {
      check("Thème : logo javascript: via PATCH /api/themes/:id (REST Payload) -> 400", false, 'fiche de thème introuvable');
    }

    // Brouillon d'un site avec logo : en-tête, icône d'onglet et fichier publiés
    if (otherSlug && otherMedia?.filename) {
      const themed = await postTheme(admin.token, { ...BASE_THEME, logo: otherMedia.url }, otherSlug);
      const preview = await req(`/api/sites/${otherSlug}/preview-build`, { method: 'POST', token: admin.token });
      const draftDir = path.join(projectDir, 'drafts', otherSlug);
      const html = fs.existsSync(path.join(draftDir, 'index.html')) ? fs.readFileSync(path.join(draftDir, 'index.html'), 'utf-8') : '';
      const src = `/draft/${otherSlug}/media/${otherMedia.filename}`;
      const favicon = fs.existsSync(path.join(draftDir, 'favicon.svg')) ? fs.readFileSync(path.join(draftDir, 'favicon.svg'), 'utf-8') : '';
      check('Brouillon : logo publié', themed.status === 200 && preview.status === 200
        && html.includes(`<img class="site-brand-logo" src="${src}"`)
        && html.includes(`<link rel="icon" href="${src}">`)
        && fs.existsSync(path.join(draftDir, 'media', otherMedia.filename))
        && favicon.startsWith('<svg') && !favicon.includes('M50.4 78.5'),
      `thème=${themed.status} brouillon=${preview.status} ${JSON.stringify(preview.json?.error || '')}`);
    } else {
      check('Brouillon : logo publié', false, 'site de test non préparé');
    }
  } finally {
    const restored = before ? await postTheme(admin.token, before) : null;
    if (!restored || restored.status !== 200) await postTheme(admin.token, BASE_THEME);
    if (ownMedia?.id) await req(`/api/media/${ownMedia.id}`, { method: 'DELETE', token: admin.token });
    if (otherSlug) await req(`/api/sites/${otherSlug}?deleteFiles=true`, { method: 'DELETE', token: admin.token });
  }
}
