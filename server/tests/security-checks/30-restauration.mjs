// Restauration des sauvegardes (lot 3) : droits et validation des endpoints, images (et
// leur texte alternatif) dans les sauvegardes, restauration en copie et en remplacement,
// sauvegarde préalable à la suppression d'un site. Tout ce qui est créé (sites, archives)
// est supprimé à la fin ; les archives existantes du serveur testé sont mises à l'abri.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKUPS_DIR = path.join(path.dirname(SERVER_DIR), 'backups');
export const BACKUP_NAME = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-securite)?\.zip$/;
const SAFETY_NAME = /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-securite\.zip$/;
const SHELTER_PREFIX = '.matrice-abri-';
const ALT = 'Vitrine de la boulangerie au matin';

// Remet en place les archives d'un abri qui ont disparu de backups/ (même fichier, même
// date), puis supprime l'abri.
function unshelter(dir) {
  for (const name of fs.readdirSync(dir)) {
    const dest = path.join(BACKUPS_DIR, name);
    if (BACKUP_NAME.test(name) && !fs.existsSync(dest)) {
      try { fs.renameSync(path.join(dir, name), dest); } catch (e) { console.error(`Archive ${name} non remise en place : ${e.message}`); }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// Chaque sauvegarde créée par la matrice applique la rétention du serveur testé, qui
// supprimerait les archives les plus anciennes de l'exploitant. Elles sont mises à l'abri
// (liens physiques dans un sous-dossier de backups/, ignoré par la liste et la rétention)
// et remises en place par la fonction renvoyée ; un abri laissé par une exécution
// interrompue est d'abord vidé. null : archives hors de portée (serveur distant) que les
// `created` archives créées pourraient évincer — scénario à ignorer.
export async function shelterBackups(req, token, created) {
  try {
    for (const name of fs.readdirSync(BACKUPS_DIR)) {
      if (name.startsWith(SHELTER_PREFIX)) unshelter(path.join(BACKUPS_DIR, name));
    }
  } catch { /* pas de dossier backups/ */ }
  const info = (await req('/api/admin/backups', { token })).json || {};
  const names = (info.backups || []).map((b) => b.name).filter((n) => BACKUP_NAME.test(n));
  if (names.length === 0) return () => {};
  if (!names.every((n) => fs.existsSync(path.join(BACKUPS_DIR, n)))) {
    const keep = Math.min(Number(info.config?.keep) || 0, Number(info.config?.keepSafety ?? info.config?.keep) || 0);
    return names.length + created <= keep ? () => {} : null;
  }
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(BACKUPS_DIR, SHELTER_PREFIX));
    for (const name of names) {
      const src = path.join(BACKUPS_DIR, name);
      const dest = path.join(dir, name);
      try {
        fs.linkSync(src, dest);
      } catch {
        fs.copyFileSync(src, dest);
        const st = fs.statSync(src);
        fs.utimesSync(dest, st.atime, st.mtime);
      }
    }
  } catch {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  return () => unshelter(dir);
}

export default async function ({ BASE, ORIGIN, req, check, admin, client }) {
  const restore = (body, token) => req('/api/admin/backups/restore', { method: 'POST', body, token });
  const describe = (name, token) => req(`/api/admin/backups/sites?name=${encodeURIComponent(name)}`, { token });

  // ---- Droits ----
  check('Restauration : GET sites anonyme -> 401', (await describe('x')).status === 401);
  check('Restauration : POST restore anonyme -> 401', (await restore({ name: 'x', slug: 'x' })).status === 401);
  if (client.token) {
    check('Restauration : GET sites client -> 403', (await describe('x', client.token)).status === 403);
    check('Restauration : POST restore client -> 403', (await restore({ name: 'x', slug: 'x' }, client.token)).status === 403);
  }
  if (!admin.token) return;
  const token = admin.token;

  // ---- Validation ----
  const cfg = await req('/api/admin/backups', { token });
  check('Sauvegardes : config.media booléen', cfg.status === 200 && typeof cfg.json?.config?.media === 'boolean', JSON.stringify(cfg.json?.config));
  check('Restauration : sites ?name=../etc/passwd -> 400', (await describe('../etc/passwd', token)).status === 400);
  const absent = 'backup-1999-01-01T00-00-00.zip';
  check('Restauration : sites d’une sauvegarde absente -> 404', (await describe(absent, token)).status === 404);
  check('Restauration : nom hostile -> 400', (await restore({ name: '../etc/passwd', slug: 'boulangerie-artisanale' }, token)).status === 400);
  check('Restauration : mode inconnu -> 400', (await restore({ name: absent, slug: 'boulangerie-artisanale', mode: 'tout' }, token)).status === 400);
  check('Restauration : slug hostile -> 400', (await restore({ name: absent, slug: '../x' }, token)).status === 400);
  check('Restauration : sauvegarde absente -> 404', (await restore({ name: absent, slug: 'boulangerie-artisanale' }, token)).status === 404);

  // ---- Scénario complet ----
  const payloadSiteId = async (slug) => (await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token })).json?.docs?.[0]?.id;
  const siteMedia = async (siteId) => (await req(`/api/media?where[site][equals]=${siteId}&depth=0`, { token })).json?.docs || [];
  const pagesOf = async (slug) => (await req(`/api/site-pages?site=${slug}`, { token })).json?.docs || [];
  const postsOf = async (slug) => (await req(`/api/site-posts?site=${slug}`, { token })).json?.docs || [];
  const upload = async (siteId, name) => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), name);
    form.append('_payload', JSON.stringify({ site: siteId, alt: ALT }));
    const res = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: `payload-token=${token}` }, body: form });
    let json = null;
    try { json = await res.clone().json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
  };

  const createdSites = new Set();
  const createdArchives = new Set();
  let restoreShelter = null;
  try {
    // Restes d'une exécution interrompue
    for (const leftover of ['restauration-sc', 'restauration-sc-restauration']) {
      await req(`/api/sites/${leftover}?deleteFiles=true`, { method: 'DELETE', token });
    }
    // Trois archives créées : sauvegarde manuelle, sécurité du remplacement, sauvegarde
    // préalable à la suppression
    restoreShelter = await shelterBackups(req, token, 3);
    if (!restoreShelter) {
      check('Restauration : scénario ignoré (archives du serveur testé hors de portée, la rétention en supprimerait)', true);
      return;
    }

    const created = await req('/api/sites', { method: 'POST', body: { name: 'Restauration SC' }, token });
    const slug = created.json?.site?.slug;
    if (slug) createdSites.add(slug);
    const siteId = slug ? await payloadSiteId(slug) : null;
    const up = siteId ? await upload(siteId, 'restauration-sc.png') : { status: 0 };
    const filename = up.json?.doc?.filename;
    const imageUrl = `/api/media/file/${filename}`;
    const savePages = slug && filename ? await req(`/api/site-pages?site=${slug}`, {
      method: 'POST',
      body: { docs: [{ title: 'Accueil', slug: 'home', layout: [{ blockType: 'hero', title: 'Restauration', backgroundImage: imageUrl }] }] },
      token,
    }) : { status: 0 };
    const savePost = slug ? await req(`/api/site-posts?site=${slug}`, { method: 'POST', body: { title: 'Article SC', body: 'Texte' }, token }) : { status: 0 };
    const postSlug = savePost.json?.slug;
    const t0 = slug ? (await req(`/api/theme?site=${slug}`, { token })).json?.theme : null;
    if (!(siteId && filename && savePages.status === 200 && postSlug && t0?.colors?.primary)) {
      check('Restauration : préparation du site de test', false, `site=${slug} upload=${up.status} pages=${savePages.status} article=${savePost.status}`);
      return;
    }

    // Sauvegarde : contenu et image du site
    const made = await req('/api/admin/backups', { method: 'POST', token });
    const archive = made.json?.filename;
    if (archive) createdArchives.add(archive);
    check('Sauvegarde : créée', made.status === 200 && BACKUP_NAME.test(archive || ''), `HTTP ${made.status} ${archive}`);
    if (!archive) return;
    const described = await describe(archive, token);
    const entry = described.json?.sites?.find((s) => s.slug === slug);
    check('Sauvegarde : format 2 (images incluses)', described.status === 200 && described.json?.format === 2, `HTTP ${described.status} format=${described.json?.format}`);
    check('Sauvegarde : le site y figure (1 page, 1 article, 1 image, existant)', entry?.pages === 1 && entry?.posts === 1 && entry?.media === 1 && entry?.exists === true, JSON.stringify(entry));
    check('Restauration : site absent de la sauvegarde -> 404', (await restore({ name: archive, slug: 'zz-absent-sc' }, token)).status === 404);

    // Copie : nouveau site, image recopiée sous un nouveau nom, contenu remappé
    const copy = await restore({ name: archive, slug, mode: 'copy' }, token);
    const copySlug = copy.json?.site?.slug;
    if (copySlug) createdSites.add(copySlug);
    check('Restauration copie -> 200 sous « <slug>-restauration »', copy.status === 200 && copy.json?.mode === 'copy' && Boolean(copySlug?.startsWith(`${slug}-restauration`)), `HTTP ${copy.status} ${copySlug} ${copy.json?.error || ''}`);
    if (copySlug) {
      const copyId = await payloadSiteId(copySlug);
      const media = copyId ? await siteMedia(copyId) : [];
      const newName = media[0]?.filename;
      check('Restauration copie : 1 image, sous un autre nom', media.length === 1 && Boolean(newName) && newName !== filename, `${media.length} média(s) ${filename} -> ${newName}`);
      check('Restauration copie : texte alternatif de l’image conservé', media[0]?.alt === ALT, JSON.stringify(media[0]?.alt));
      const copyPages = JSON.stringify(await pagesOf(copySlug));
      check('Restauration copie : les pages citent la nouvelle image', Boolean(newName) && copyPages.includes(`/api/media/file/${newName}`) && !copyPages.includes(imageUrl), `${filename} -> ${newName}`);
      check('Restauration copie : 1 article', (await postsOf(copySlug)).length === 1);
      check('Restauration copie : réponse { pages, posts, media }', copy.json?.pages === 1 && copy.json?.posts === 1 && copy.json?.media?.restored === 1, JSON.stringify({ pages: copy.json?.pages, posts: copy.json?.posts, media: copy.json?.media }));
    }

    // Remplacement : le site modifié depuis revient à l'état sauvegardé
    await req(`/api/site-pages?site=${slug}`, {
      method: 'POST',
      body: { docs: [{ title: 'Autre', slug: 'autre', layout: [{ blockType: 'hero', title: 'Autre' }] }], deleted: [{ slug: 'home' }] },
      token,
    });
    await req(`/api/theme?site=${slug}`, { method: 'POST', body: { theme: { ...t0, colors: { ...t0.colors, primary: '#123456' } } }, token });
    await req(`/api/site-posts?site=${slug}&slug=${postSlug}`, { method: 'DELETE', token });
    const replaced = await restore({ name: archive, slug, mode: 'replace' }, token);
    const safety = replaced.json?.safetyBackup;
    if (safety) createdArchives.add(safety);
    check('Restauration remplacement -> 200 avec sauvegarde de sécurité (backup-<date>-securite.zip)', replaced.status === 200 && SAFETY_NAME.test(safety || '') && safety !== archive, `HTTP ${replaced.status} ${safety} ${replaced.json?.error || ''}`);    const pages = await pagesOf(slug);
    check('Restauration remplacement : seule la page home, citant l’image d’origine', pages.length === 1 && pages[0]?.slug === 'home' && JSON.stringify(pages).includes(imageUrl), JSON.stringify(pages.map((p) => p.slug)));
    const theme = (await req(`/api/theme?site=${slug}`, { token })).json?.theme;
    check('Restauration remplacement : thème restauré', String(theme?.colors?.primary).toLowerCase() === String(t0.colors.primary).toLowerCase(), `${theme?.colors?.primary} (attendu ${t0.colors.primary})`);
    check('Restauration remplacement : article revenu', (await postsOf(slug)).some((p) => p.slug === postSlug));
    check('Restauration remplacement : toujours 1 image (conservée)', (await siteMedia(siteId)).length === 1 && replaced.json?.media?.kept === 1, `kept=${replaced.json?.media?.kept}`);
    const audit = await req('/api/audit', { token });
    const auditDocs = Array.isArray(audit.json) ? audit.json : audit.json?.docs || [];
    check('Restauration : auditée avec la sauvegarde de sécurité', auditDocs.some((a) => a.action === 'sauvegarde.restauration' && String(a.details).includes('mode=replace') && String(a.details).includes(`securite=${safety}`)));

    // Suppression avec sauvegarde préalable, puis restauration du site supprimé
    if (copySlug) {
      const del = await req(`/api/sites/${copySlug}?deleteFiles=true&backup=true`, { method: 'DELETE', token });
      const before = del.json?.backup;
      if (before) createdArchives.add(before);
      check('Suppression avec sauvegarde préalable -> 200 + nom de la sauvegarde de sécurité', del.status === 200 && SAFETY_NAME.test(before || ''), `HTTP ${del.status} ${before}`);
      if (del.status === 200) createdSites.delete(copySlug);
      if (before) {
        check('Restauration remplacement d’un site supprimé -> 404', (await restore({ name: before, slug: copySlug, mode: 'replace' }, token)).status === 404);
        const back = await restore({ name: before, slug: copySlug, mode: 'copy' }, token);
        if (back.json?.site?.slug) createdSites.add(back.json.site.slug);
        check('Restauration copie d’un site supprimé -> 200 sous le même slug', back.status === 200 && back.json?.site?.slug === copySlug, `HTTP ${back.status} ${back.json?.site?.slug}`);
        check('Restauration copie d’un site supprimé : image restaurée depuis la sauvegarde', back.json?.media?.restored === 1, JSON.stringify(back.json?.media));
        const backId = back.json?.site?.slug ? await payloadSiteId(back.json.site.slug) : null;
        const backMedia = backId ? await siteMedia(backId) : [];
        check('Restauration copie d’un site supprimé : texte alternatif conservé', backMedia.length === 1 && backMedia[0].alt === ALT, JSON.stringify(backMedia.map((m) => m.alt)));
      }
    }
  } finally {
    for (const s of createdSites) await req(`/api/sites/${s}?deleteFiles=true`, { method: 'DELETE', token });
    for (const name of createdArchives) {
      if (BACKUP_NAME.test(name)) fs.rmSync(path.join(BACKUPS_DIR, name), { force: true });
    }
    // Après le retrait des archives de la matrice : celles de l'exploitant reviennent
    if (restoreShelter) restoreShelter();
  }
}
