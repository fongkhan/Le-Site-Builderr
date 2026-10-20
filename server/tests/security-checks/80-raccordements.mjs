// Raccordements entre fonctions (lot 8) : le logo du thème suit le site dans la
// duplication et la restauration en copie (copie de l'image et URL remappée, informations
// légales reprises), l'export et l'import d'archive reprennent les informations légales,
// et le logo ne peut pas être supprimé de la médiathèque tant qu'il est le logo du site.
// Aucune connexion ni envoi de formulaire ; tout ce qui est créé (sites, archives) est
// supprimé à la fin, les archives existantes du serveur testé sont mises à l'abri.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BACKUP_NAME, shelterBackups } from './30-restauration.mjs';

const AdmZip = createRequire(import.meta.url)('adm-zip');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKUPS_DIR = path.join(path.dirname(SERVER_DIR), 'backups');
const THEME = {
  colors: { primary: '#8B5A2B', secondary: '#F5E6CC', background: '#FAFAFA', text: '#2D241E' },
  fonts: { heading: 'Playfair Display', body: 'Inter' },
  radius: '12px',
};
const LEGAL = { companyName: 'Raccordements SC', address: '1 rue du Test\n69000 Lyon', phone: '04 78 00 00 00', email: 'contact@raccordements.example', publisherName: 'Camille Test' };

export default async function ({ BASE, ORIGIN, req, check, admin }) {
  if (!admin.token) {
    check('Raccordements : compte admin connecté', false);
    return;
  }
  const token = admin.token;
  // Entrées d'audit de cette exécution seulement (le slug peut resservir d'une exécution à l'autre)
  const since = Date.now() - 2000;
  const payloadSiteId = async (slug) => (await req(`/api/payload_sites?where[slug][equals]=${slug}&depth=0`, { token })).json?.docs?.[0]?.id;
  const siteMedia = async (slug) => {
    const id = await payloadSiteId(slug);
    return id ? (await req(`/api/media?where[site][equals]=${id}&depth=0`, { token })).json?.docs || [] : [];
  };
  const themeOf = async (slug) => (await req(`/api/theme?site=${slug}`, { token })).json?.theme;
  const legalOf = async (slug) => (await req(`/api/sites/${slug}/legal`, { token })).json?.legal;
  const upload = async (siteId, name) => {
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), name);
    form.append('_payload', JSON.stringify({ site: siteId }));
    const res = await fetch(`${BASE}/api/media`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: `payload-token=${token}` }, body: form });
    let json = null;
    try { json = await res.clone().json(); } catch { /* non-JSON */ }
    return { status: res.status, doc: json?.doc };
  };
  // Le logo cite exactement l'unique image du site, et ce n'est pas l'image d'origine
  const logoIsOwnCopy = (theme, media, original) =>
    media.length === 1 && media[0].filename !== original && theme?.logo === `/api/media/file/${encodeURIComponent(media[0].filename)}`;

  const createdSites = new Set();
  const createdArchives = new Set();
  let restoreShelter = null;
  try {
    // Restes d'une exécution interrompue
    for (const leftover of ['raccordements-sc', 'raccordements-sc-2', 'raccordements-sc-copie', 'raccordements-sc-restauration']) {
      await req(`/api/sites/${leftover}?deleteFiles=true`, { method: 'DELETE', token });
    }

    // Site de test : un PNG valide en logo, informations légales renseignées
    const created = await req('/api/sites', { method: 'POST', body: { name: 'Raccordements SC' }, token });
    const slug = created.json?.site?.slug;
    if (slug) createdSites.add(slug);
    const siteId = slug ? await payloadSiteId(slug) : null;
    const up = siteId ? await upload(siteId, 'raccord-logo.png') : { status: 0 };
    const original = up.doc?.filename;
    const themed = original ? await req(`/api/theme?site=${slug}`, { method: 'POST', body: { theme: { ...THEME, logo: up.doc.url } }, token }) : { status: 0 };
    const legal = slug ? await req(`/api/sites/${slug}/legal`, { method: 'PUT', body: LEGAL, token }) : { status: 0 };
    if (!(original && themed.status === 200 && legal.status === 200)) {
      check('Raccordements : préparation du site de test', false, `site=${slug} upload=${up.status} thème=${themed.status} légal=${legal.status}`);
      return;
    }

    // ---- Médiathèque : le logo est un usage de l'image ----
    const library = (await req(`/api/sites/${slug}/media`, { token })).json?.items || [];
    const logoItem = library.find((i) => i.filename === original);
    check('Médiathèque : le logo apparaît comme usage « thème »', Boolean(logoItem) && logoItem.usedIn.some((u) => u.type === 'theme'), JSON.stringify(logoItem?.usedIn));
    const del = await req(`/api/sites/${slug}/media/${up.doc.id}`, { method: 'DELETE', token });
    check('Médiathèque : le logo du site ne peut pas être supprimé', del.status === 409 && /thème \(logo\)/.test(del.json?.error || '') && (await req(`/api/media/${up.doc.id}?depth=0`, { token })).status === 200, `HTTP ${del.status} ${JSON.stringify(del.json)}`);

    // ---- Duplication : le jumeau a sa propre copie du logo ----
    const dup = await req(`/api/sites/${slug}/duplicate`, { method: 'POST', token });
    const twin = dup.json?.site?.slug;
    if (twin) createdSites.add(twin);
    if (dup.status === 200 && twin) {
      const twinMedia = await siteMedia(twin);
      const twinTheme = await themeOf(twin);
      check('Duplication : le logo du jumeau cite sa propre copie', logoIsOwnCopy(twinTheme, twinMedia, original), `${twinMedia.length} média(s) ${twinMedia.map((m) => m.filename).join(',')} logo=${twinTheme?.logo}`);
      check('Duplication : couleurs du thème reprises', twinTheme?.colors?.primary === THEME.colors.primary, JSON.stringify(twinTheme?.colors));
      const twinLegal = await legalOf(twin);
      check('Duplication : informations légales reprises', twinLegal?.companyName === LEGAL.companyName && twinLegal?.address === LEGAL.address, JSON.stringify(twinLegal));
    } else {
      check('Duplication : le logo du jumeau cite sa propre copie', false, `HTTP ${dup.status} ${JSON.stringify(dup.json)}`);
    }
    // Le logo de la source est intact (sa propre image)
    const sourceTheme = await themeOf(slug);
    check('Duplication : logo de la source inchangé', sourceTheme?.logo === up.doc.url, `${sourceTheme?.logo} (attendu ${up.doc.url})`);

    // ---- Export puis import d'archive : informations légales reprises ----
    const exp = await fetch(`${BASE}/api/sites/${slug}/export`, { headers: { Origin: ORIGIN, Cookie: `payload-token=${token}` } });
    const zipBuf = exp.status === 200 ? Buffer.from(await exp.arrayBuffer()) : null;
    let exportedLegal = null;
    try { exportedLegal = zipBuf ? JSON.parse(new AdmZip(zipBuf).readAsText('meta.json')).legal : null; } catch { /* archive illisible */ }
    check('Export : meta.json porte les informations légales', exportedLegal?.companyName === LEGAL.companyName && exportedLegal?.address === LEGAL.address, `HTTP ${exp.status} ${JSON.stringify(exportedLegal)}`);
    if (zipBuf) {
      const imp = await fetch(`${BASE}/api/sites/import-archive`, {
        method: 'POST',
        headers: { Origin: ORIGIN, Cookie: `payload-token=${token}`, 'Content-Type': 'application/zip' },
        body: zipBuf,
      });
      const imported = (await imp.json().catch(() => null))?.site?.slug;
      if (imported) createdSites.add(imported);
      const importedLegal = imported ? await legalOf(imported) : null;
      check('Import d’archive : informations légales reprises', imp.status === 200 && importedLegal?.companyName === LEGAL.companyName && importedLegal?.publisherName === LEGAL.publisherName, `HTTP ${imp.status} ${imported} ${JSON.stringify(importedLegal)}`);
    }

    // ---- Restauration en copie : logo remappé vers l'image restaurée ----
    // Une archive créée (sauvegarde manuelle) : celles du serveur testé à l'abri
    restoreShelter = await shelterBackups(req, token, 1);
    if (!restoreShelter) {
      check('Restauration en copie : scénario ignoré (archives du serveur testé hors de portée, la rétention en supprimerait)', true);
    } else {
      const made = await req('/api/admin/backups', { method: 'POST', token });
      const archive = made.json?.filename;
      if (archive) createdArchives.add(archive);
      if (!(made.status === 200 && BACKUP_NAME.test(archive || ''))) {
        check('Restauration en copie : logo remappé', false, `sauvegarde HTTP ${made.status} ${archive}`);
        return;
      }
      const copy = await req('/api/admin/backups/restore', { method: 'POST', body: { name: archive, slug, mode: 'copy' }, token });
      const copySlug = copy.json?.site?.slug;
      if (copySlug) createdSites.add(copySlug);
      if (copy.status === 200 && copySlug) {
        const copyMedia = await siteMedia(copySlug);
        const copyTheme = await themeOf(copySlug);
        check('Restauration en copie : logo remappé', logoIsOwnCopy(copyTheme, copyMedia, original), `${copyMedia.length} média(s) ${copyMedia.map((m) => m.filename).join(',')} logo=${copyTheme?.logo}`);
        const copyLegal = await legalOf(copySlug);
        check('Restauration en copie : informations légales reprises', copyLegal?.companyName === LEGAL.companyName && copyLegal?.publisherName === LEGAL.publisherName, JSON.stringify(copyLegal));
      } else {
        check('Restauration en copie : logo remappé', false, `HTTP ${copy.status} ${JSON.stringify(copy.json)}`);
      }
    }

    // ---- Logo retiré du thème : l'image se supprime, une seule entrée d'audit ----
    await req(`/api/theme?site=${slug}`, { method: 'POST', body: { theme: THEME }, token });
    const freed = await req(`/api/sites/${slug}/media/${up.doc.id}`, { method: 'DELETE', token });
    check('Médiathèque : logo retiré du thème -> suppression 200', freed.status === 200, `HTTP ${freed.status} ${JSON.stringify(freed.json)}`);
    // Écritures d'audit non attendues par les routes : relecture jusqu'à la première
    // entrée, puis une dernière après 600 ms (un doublon écrit par le hook arriverait après)
    const deletions = async () => {
      const audit = await req(`/api/audit?action=media.&target=${encodeURIComponent(slug)}`, { token });
      const docs = Array.isArray(audit.json) ? audit.json : audit.json?.docs || [];
      return docs.filter((d) => d.action === 'media.suppression' && Date.parse(d.createdAt) >= since);
    };
    let entries = [];
    for (let i = 0; i < 15 && entries.length === 0; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200));
      entries = await deletions();
    }
    await new Promise((r) => setTimeout(r, 600));
    entries = await deletions();
    check('Médiathèque : suppression auditée une fois (fichier=<nom>)', entries.length === 1 && entries[0].details === `fichier=${original}`, JSON.stringify(entries.map((d) => d.details)));
  } finally {
    for (const s of createdSites) await req(`/api/sites/${s}?deleteFiles=true`, { method: 'DELETE', token });
    for (const name of createdArchives) {
      if (BACKUP_NAME.test(name)) fs.rmSync(path.join(BACKUPS_DIR, name), { force: true });
    }
    // Après le retrait des archives de la matrice : celles de l'exploitant reviennent
    if (restoreShelter) restoreShelter();
  }
}
