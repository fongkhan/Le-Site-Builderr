import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Texte alternatif des images : écrit dans la sauvegarde (media.json) et repris par la
// restauration en copie. Sites en JSON, médiathèque temporaire et Payload simulé (médias),
// installés AVANT le chargement des services (déstructuration de getPayloadInstance).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-alt-'));
const config = require('../../core/config.js');
fs.mkdirSync(config.DATA_DIR, { recursive: true });
config.BACKUPS_DIR = path.join(tmp, 'backups');
config.BACKUP_KEEP = 50;
config.BACKUP_MEDIA = true;
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.REPOSITORIES_DIR = path.join(tmp, 'repositories');
config.RELEASES_DIR = path.join(tmp, 'releases');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
config.UPLOADS_DIR = path.join(tmp, 'uploads');
fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
fs.writeFileSync(path.join(config.UPLOADS_DIR, 'vitrine.png'), PNG);
fs.writeFileSync(path.join(config.UPLOADS_DIR, 'sans-alt.png'), PNG);
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

const RUN = `${process.pid}-${Date.now()}`;
const SLUG = `zz-unit-alt-${RUN}`;
const COPY_SLUG = `${SLUG}-restauration`;
// Payload simulé : chaque site a un id, le site source possède deux images
const siteIds = new Map();
const creates = [];
const fakePayload = {
  async find({ collection, where }) {
    if (collection === 'payload_sites') {
      const slug = where.slug.equals;
      if (!siteIds.has(slug)) siteIds.set(slug, siteIds.size + 1);
      return { docs: [{ id: siteIds.get(slug) }] };
    }
    if (collection === 'media' && where.site?.equals === siteIds.get(SLUG)) {
      return { docs: [{ id: 1, filename: 'vitrine.png', alt: 'Vitrine de la boulangerie' }, { id: 2, filename: 'sans-alt.png', alt: null }] };
    }
    return { docs: [] };
  },
  async create(args) {
    creates.push(args);
    return { filename: `copie-${args.file.name}` };
  },
};
require('../../core/payload.js').getPayloadInstance = () => fakePayload;

const AdmZip = require('adm-zip');
const backups = require('../../services/backups.js');
const { purgeSiteData } = require('../../services/sites.js');

after(() => {
  for (const slug of [SLUG, COPY_SLUG]) purgeSiteData(slug);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('sauvegarde puis restauration en copie — le texte alternatif de chaque image est conservé', async () => {
  await sitesStore.createSite({ slug: SLUG, name: 'Textes alternatifs', status: 'draft' });
  const name = await backups.createBackupArchive();
  const zip = new AdmZip(path.join(config.BACKUPS_DIR, name));
  assert.ok(zip.getEntry(`sites/${SLUG}/media/vitrine.png`), 'image absente de la sauvegarde');
  assert.deepEqual(JSON.parse(zip.readAsText(`sites/${SLUG}/media.json`)), { 'vitrine.png': 'Vitrine de la boulangerie' });

  const r = await backups.restoreSiteFromBackup({ name, slug: SLUG, mode: 'copy' });
  assert.equal(r.site.slug, COPY_SLUG);
  assert.equal(r.media.restored, 2);
  const byName = Object.fromEntries(creates.map((c) => [c.file.name, c.data]));
  assert.deepEqual(byName['vitrine.png'], { site: siteIds.get(COPY_SLUG), alt: 'Vitrine de la boulangerie' });
  assert.deepEqual(byName['sans-alt.png'], { site: siteIds.get(COPY_SLUG) });
});
