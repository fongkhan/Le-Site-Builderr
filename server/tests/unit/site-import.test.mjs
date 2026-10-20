import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Création factorisée (import, duplication, restauration) et remplacement de contenu, en
// mode sans base : magasin de sites JSON temporaire et racines de publication isolées,
// remplacées AVANT le chargement des services (ils lisent ces chemins au chargement).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-import-'));
const config = require('../../core/config.js');
// Fichiers de données des sites de test : dossier data/ réel, créé d'emblée et jamais
// supprimé (d'autres fichiers de test, lancés en parallèle, peuvent l'utiliser)
fs.mkdirSync(config.DATA_DIR, { recursive: true });
config.PUBLIC_HTML_DIR = path.join(tmp, 'public_html');
config.REPOSITORIES_DIR = path.join(tmp, 'repositories');
config.RELEASES_DIR = path.join(tmp, 'releases');
config.DRAFTS_DIR = path.join(tmp, 'drafts');
config.UPLOADS_DIR = path.join(tmp, 'uploads');
const sitesFile = path.join(tmp, 'sites.json');
fs.writeFileSync(sitesFile, '[]');
const sitesStore = require('../../sites-store.js');
sitesStore.init({ getPayload: () => null, sitesFile });

const { getSitePagesFile, getSiteThemeFile, getSitePostsFile } = config;
const { DEFAULT_THEME } = require('../../services/defaults.js');
const {
  sanitizeSiteContent,
  parseSiteContent,
  restoreMediaFiles,
  themeForTarget,
  createSiteFromContent,
  replaceSiteContent,
} = require('../../services/site-import.js');
const { logoFilename } = require('../../lib/theme.js');

// Fichiers de données des sites de test : nettoyés à la fin
const RUN = `${process.pid}-${Date.now()}`;
const SLUG = `zz-unit-restauration-${RUN}`;
const FAILED_SLUG = `zz-unit-restauration-echec-${RUN}`;
const REPLACE_SLUG = `zz-unit-restauration-remplace-${RUN}`;
after(() => {
  for (const slug of [SLUG, `${SLUG}-2`, FAILED_SLUG, REPLACE_SLUG]) {
    for (const file of [getSitePagesFile(slug), getSiteThemeFile(slug), getSitePostsFile(slug)]) fs.rmSync(file, { force: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const THEME = { colors: { ...DEFAULT_THEME.theme.colors, primary: '#123456' }, fonts: { ...DEFAULT_THEME.theme.fonts }, radius: '8px' };
const page = (slug, title, extra = {}) => ({ title, slug, layout: [{ blockType: 'hero', title, ...extra }] });
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const listedSlugs = () => readJson(sitesFile).map((s) => s.slug);

test('sanitizeSiteContent — pages : lien javascript: et doublon écartés, valides gardées', () => {
  const home = page('home', 'Accueil');
  const out = sanitizeSiteContent({
    pages: {
      docs: [
        home,
        page('piege', 'Piège', { backgroundImage: 'javascript:alert(1)' }),
        page('home', 'Accueil en double'),
        { title: '', slug: 'sans-titre' },
        null,
      ],
      autre: 'clé ignorée',
    },
  });
  assert.deepEqual(out.pages, { docs: [home] });
  assert.equal(out.skipped.pages, 4);
  assert.equal(out.posts, null);
  assert.equal(out.theme, null);
  // Aucune page valide : élément absent (les pages existantes sont conservées)
  assert.equal(sanitizeSiteContent({ pages: { docs: [page('x', 'X', { image: 'javascript:x' })] } }).pages, null);
  assert.equal(sanitizeSiteContent({ pages: { docs: [] } }).pages, null);
  // Même slug dans deux langues : deux pages distinctes
  assert.equal(sanitizeSiteContent({ pages: { docs: [page('home', 'Accueil'), { ...page('home', 'Home'), locale: 'en' }] } }).pages.docs.length, 2);
});

test('sanitizeSiteContent — thème réduit à { theme } ; thème invalide écarté', () => {
  const valid = sanitizeSiteContent({ theme: { theme: THEME, parasite: '<script>' } });
  assert.deepEqual(valid.theme, { theme: THEME });
  assert.equal(valid.skipped.theme, false);
  const invalid = sanitizeSiteContent({ theme: { theme: { ...THEME, radius: '1px;}body{display:none' } } });
  assert.equal(invalid.theme, null);
  assert.equal(invalid.skipped.theme, true);
  // Thème absent : rien d'écarté
  assert.equal(sanitizeSiteContent({}).skipped.theme, false);
});

test('sanitizeSiteContent — thème : logo valide gardé (forme canonique), logo invalide seul retiré', () => {
  const withLogo = sanitizeSiteContent({ theme: { theme: { ...THEME, logo: '/api/media/file/logo%20(1).png' } } });
  assert.deepEqual(withLogo.theme, { theme: { ...THEME, logo: '/api/media/file/logo%20%281%29.png' } });
  assert.equal(withLogo.skipped.theme, false);
  // Logo refusé (schéma exécutable, SVG, URL externe) : couleurs, polices et rayon conservés
  for (const logo of ['javascript:alert(1)', '/api/media/file/logo.svg', 'https://cdn.example/logo.png']) {
    const out = sanitizeSiteContent({ theme: { theme: { ...THEME, logo } } });
    assert.deepEqual(out.theme, { theme: THEME }, logo);
    assert.equal(out.skipped.theme, false, logo);
  }
  // Thème qui n'est pas un objet : écarté
  for (const theme of ['#fff', ['x'], null]) {
    assert.equal(sanitizeSiteContent({ theme: { theme } }).skipped.theme, true, JSON.stringify(theme));
  }
});

test('themeForTarget — logo remappé vers la copie du site cible, retiré si le site ne la possède pas', () => {
  const theme = { ...THEME, logo: '/api/media/file/logo.png' };
  const media = { map: { 'logo.png': 'logo-1.png' }, owned: new Set(['logo-1.png']) };
  assert.deepEqual(themeForTarget(theme, media), { ...THEME, logo: '/api/media/file/logo-1.png' });
  assert.equal(theme.logo, '/api/media/file/logo.png', 'entrée modifiée');
  // Nom avec parenthèses : encodé en entier (relu sans troncature)
  const paren = themeForTarget({ ...THEME, logo: '/api/media/file/logo%20%281%29.png' }, { map: { 'logo (1).png': "logo (1)-l'ancien.png" }, owned: new Set(["logo (1)-l'ancien.png"]) });
  assert.equal(paren.logo, '/api/media/file/logo%20%281%29-l%27ancien.png');
  assert.equal(logoFilename(paren.logo), "logo (1)-l'ancien.png");
  // Déjà possédé (remplacement) : conservé tel quel
  assert.equal(themeForTarget(theme, { map: {}, owned: new Set(['logo.png']) }).logo, '/api/media/file/logo.png');
  // Fichier ni copié ni possédé (autre site, image absente de la sauvegarde) : logo retiré
  assert.deepEqual(themeForTarget(theme, { map: {}, owned: new Set() }), THEME);
  assert.deepEqual(themeForTarget(theme, { map: { 'logo.png': 'logo-1.png' }, owned: new Set() }), THEME);
});

test('sanitizeSiteContent — articles : titre requis, slug canonique, image sûre, sans doublon', () => {
  const out = sanitizeSiteContent({
    posts: {
      docs: [
        { title: 'Mon article', slug: 'Mon Article!', coverImage: 'javascript:x', body: 'Texte', publishedAt: '2026-10-01T10:00:00.000Z', status: 'published' },
        { title: '', slug: 'sans-titre' },
        { title: 'Sans slug', slug: '!!!' },
        { title: 'Doublon', slug: 'mon-article' },
        { title: 'Champs bizarres', slug: 'bizarre', excerpt: { html: 1 }, tags: ['a'], publishedAt: { $gt: '' } },
      ],
    },
  });
  assert.equal(out.skipped.posts, 3);
  assert.deepEqual(out.posts.map((p) => p.slug), ['mon-article', 'bizarre']);
  assert.equal(out.posts[0].coverImage, '');
  assert.equal(out.posts[0].status, 'published');
  assert.equal(out.posts[0].publishedAt, '2026-10-01T10:00:00.000Z');
  assert.equal(out.posts[1].excerpt, '');
  assert.equal(out.posts[1].tags, '');
  assert.equal(out.posts[1].publishedAt, null);
  assert.equal(out.posts[1].status, 'draft');
  // Blog vide : liste vide (les articles existants seront retirés), jamais null
  assert.deepEqual(sanitizeSiteContent({ posts: { docs: [] } }).posts, []);
  assert.deepEqual(sanitizeSiteContent({ posts: [] }).posts, []);
  // Au-delà de 500 articles : écartés
  const many = Array.from({ length: 502 }, (_, i) => ({ title: `A${i}`, slug: `a-${i}` }));
  const bounded = sanitizeSiteContent({ posts: many });
  assert.equal(bounded.posts.length, 500);
  assert.equal(bounded.skipped.posts, 2);
});

test('parseSiteContent — fichier absent, illisible ou en erreur : élément absent', () => {
  const files = {
    'pages.json': null,
    'posts.json': '{pas du json',
    'theme.json': JSON.stringify({ theme: THEME }),
  };
  const out = parseSiteContent((name) => files[name]);
  assert.equal(out.pages, null);
  assert.equal(out.posts, null);
  assert.deepEqual(out.theme, { theme: THEME });
  const failing = parseSiteContent(() => { throw new Error('lecture impossible'); });
  assert.deepEqual([failing.pages, failing.posts, failing.theme], [null, null, null]);
});

test('restoreMediaFiles — images restaurées, conservées ou ignorées sans lecture', async () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  const created = [];
  const finds = [];
  const fakePayload = {
    async find(args) {
      finds.push(args);
      return { docs: [{ filename: 'garde.png', site: 5 }, { filename: 'disparu.png', site: 5 }] };
    },
    async create(args) {
      created.push(args);
      if (args.file.name === 'refuse.png') throw new Error('Invalid MIME type: text/plain.');
      return { filename: args.file.name === 'photo.png' ? 'photo-1.png' : args.file.name };
    },
  };
  let bigRead = false;
  const files = [
    { filename: 'garde.png', size: PNG.length, read: () => { throw new Error('ne doit pas être lu'); } },
    { filename: 'photo.png', alt: '  Photo\u0007 du   four ', size: PNG.length, read: () => PNG },
    { filename: 'refuse.png', alt: 42, size: 13, read: () => Buffer.from('pas une image') },
    { filename: 'logo.svg', size: 6, read: () => Buffer.from('<svg/>') },
    { filename: 'enorme.png', size: 60 * 1024 * 1024, read: () => { bigRead = true; throw new Error('lu'); } },
  ];
  const r = await restoreMediaFiles(fakePayload, 5, files, { keepOwned: true, fileExists: (n) => n === 'garde.png' });

  assert.deepEqual(r.map, { 'photo.png': 'photo-1.png' });
  assert.equal(r.restored, 1);
  assert.equal(r.kept, 1);
  assert.deepEqual([...r.ownedNames], ['garde.png']); // fiche sans fichier : pas possédée
  assert.equal(finds[0].collection, 'media');
  assert.deepEqual(finds[0].where, { site: { equals: 5 } });
  assert.deepEqual(created.map((c) => c.file.name), ['photo.png', 'refuse.png']);
  assert.equal(created[0].collection, 'media');
  // Texte alternatif sauvegardé repris, nettoyé ; valeur non textuelle ignorée
  assert.deepEqual(created[0].data, { site: 5, alt: 'Photo du four' });
  assert.deepEqual(created[1].data, { site: 5 });
  assert.equal(created[0].file.mimetype, 'image/png');
  assert.equal(created[0].file.size, PNG.length);
  assert.equal(created[0].overrideAccess, true);
  assert.equal(bigRead, false);

  // Sans keepOwned : aucune lecture de la médiathèque, tout est recréé
  finds.length = 0;
  created.length = 0;
  const all = await restoreMediaFiles(fakePayload, 7, [{ filename: 'garde.png', size: PNG.length, read: () => PNG }]);
  assert.equal(finds.length, 0);
  assert.equal(all.restored, 1);
  assert.equal(all.kept, 0);
  assert.equal(created[0].data.site, 7);
});

test('createSiteFromContent — site brouillon créé avec le contenu nettoyé', async () => {
  const content = sanitizeSiteContent({
    pages: { docs: [page('home', 'Accueil'), page('piege', 'Piège', { backgroundImage: 'javascript:alert(1)' })] },
    posts: { docs: [{ title: 'Article', slug: 'article', body: 'Texte' }] },
    theme: { theme: THEME, parasite: true },
  });
  const r = await createSiteFromContent({ baseSlug: SLUG, name: 'Restauration unitaire', content });

  assert.equal(r.slug, SLUG);
  assert.equal(r.site.slug, SLUG);
  assert.equal(r.site.status, 'draft');
  assert.equal(r.site.name, 'Restauration unitaire');
  assert.equal(r.site.stack, 'Astro SSG');
  assert.equal(r.after, undefined);
  assert.deepEqual(r.media, { restored: 0, copied: 0, kept: 0, missing: [] });
  assert.ok(listedSlugs().includes(SLUG));
  assert.deepEqual(readJson(getSitePagesFile(SLUG)), { docs: [page('home', 'Accueil')] });
  assert.deepEqual(readJson(getSiteThemeFile(SLUG)), { theme: THEME });
  assert.deepEqual(readJson(getSitePostsFile(SLUG)).docs.map((p) => p.slug), ['article']);

  // Sans informations légales : 11 champs vides
  assert.equal(Object.keys(r.site.legal).length, 11);
  assert.ok(Object.values(r.site.legal).every((v) => v === ''));

  // Slug déjà pris : le suivant libre ; informations légales reprises, normalisées
  const twin = await createSiteFromContent({
    baseSlug: SLUG,
    legal: { companyName: '  Atelier Démo  ', phone: '04 78 00 00 00', address: '1 rue X\r\n69000 Lyon', inconnu: 'x' },
    content: { pages: null, posts: null, theme: null },
  });
  assert.equal(twin.slug, `${SLUG}-2`);
  assert.equal(twin.site.name, `${SLUG}-2`);
  assert.equal(twin.site.legal.companyName, 'Atelier Démo');
  assert.equal(twin.site.legal.phone, '04 78 00 00 00');
  assert.equal(twin.site.legal.address, '1 rue X\n69000 Lyon');
  assert.equal(twin.site.legal.inconnu, undefined);
  assert.deepEqual((await sitesStore.getSiteBySlug(twin.slug)).legal, twin.site.legal);
  await sitesStore.deleteSite(twin.slug);
});

test('createSiteFromContent — échec après la création : fiche, fichiers et dossier défaits', async () => {
  const content = sanitizeSiteContent({ pages: { docs: [page('home', 'Accueil')] }, posts: [], theme: { theme: THEME } });
  let documentRootSeen = null;
  await assert.rejects(
    createSiteFromContent({
      baseSlug: FAILED_SLUG,
      content,
      afterCreate: async ({ slug, documentRoot }) => {
        assert.equal(slug, FAILED_SLUG);
        documentRootSeen = documentRoot;
        fs.mkdirSync(documentRoot, { recursive: true });
        fs.writeFileSync(path.join(documentRoot, 'index.html'), '<h1>partiel</h1>');
        throw new Error('extraction impossible');
      },
    }),
    /extraction impossible/,
  );
  assert.ok(!listedSlugs().includes(FAILED_SLUG));
  for (const file of [getSitePagesFile(FAILED_SLUG), getSiteThemeFile(FAILED_SLUG), getSitePostsFile(FAILED_SLUG)]) {
    assert.ok(!fs.existsSync(file), file);
  }
  assert.ok(documentRootSeen && documentRootSeen.startsWith(config.PUBLIC_HTML_DIR));
  assert.ok(!fs.existsSync(documentRootSeen));
});

test('replaceSiteContent — pages, articles et thème remplacés ; élément absent conservé', async () => {
  await sitesStore.createSite({ slug: REPLACE_SLUG, name: 'Remplacement', status: 'draft' });
  fs.writeFileSync(getSitePagesFile(REPLACE_SLUG), JSON.stringify({ docs: [page('home', 'Ancien accueil'), page('ancienne', 'Ancienne')] }));
  fs.writeFileSync(getSitePostsFile(REPLACE_SLUG), JSON.stringify({ docs: [{ title: 'P1', slug: 'p1' }, { title: 'P2', slug: 'p2' }] }));
  fs.writeFileSync(getSiteThemeFile(REPLACE_SLUG), JSON.stringify(DEFAULT_THEME));

  // Logo d'une image que le site ne possède pas (sans base : aucune) : retiré
  const restored = sanitizeSiteContent({
    pages: { docs: [page('home', 'Accueil restauré'), page('nouvelle', 'Nouvelle')] },
    posts: [{ title: 'P2 restauré', slug: 'p2' }, { title: 'P3', slug: 'p3' }],
    theme: { theme: { ...THEME, logo: '/api/media/file/logo.png' } },
  });
  const r = await replaceSiteContent(REPLACE_SLUG, restored);
  assert.deepEqual(r, { pages: 2, posts: 2, theme: true, media: { restored: 0, copied: 0, kept: 0, missing: [] } });
  assert.deepEqual(readJson(getSitePagesFile(REPLACE_SLUG)).docs.map((p) => [p.slug, p.title]), [['home', 'Accueil restauré'], ['nouvelle', 'Nouvelle']]);
  assert.deepEqual(readJson(getSitePostsFile(REPLACE_SLUG)).docs.map((p) => [p.slug, p.title]), [['p2', 'P2 restauré'], ['p3', 'P3']]);
  assert.deepEqual(readJson(getSiteThemeFile(REPLACE_SLUG)), { theme: THEME });

  // Pages, articles et thème absents de la sauvegarde : l'existant reste intact
  const before = fs.readFileSync(getSitePagesFile(REPLACE_SLUG), 'utf-8');
  const beforePosts = fs.readFileSync(getSitePostsFile(REPLACE_SLUG), 'utf-8');
  const none = await replaceSiteContent(REPLACE_SLUG, { pages: null, posts: null, theme: null });
  assert.deepEqual([none.pages, none.posts, none.theme], [0, 0, false]);
  assert.equal(fs.readFileSync(getSitePagesFile(REPLACE_SLUG), 'utf-8'), before);
  assert.equal(fs.readFileSync(getSitePostsFile(REPLACE_SLUG), 'utf-8'), beforePosts);
  assert.deepEqual(readJson(getSiteThemeFile(REPLACE_SLUG)), { theme: THEME });

  // Blog vide dans la sauvegarde : tous les articles actuels retirés
  await replaceSiteContent(REPLACE_SLUG, { pages: null, posts: [], theme: null });
  assert.deepEqual(readJson(getSitePostsFile(REPLACE_SLUG)).docs, []);
  await sitesStore.deleteSite(REPLACE_SLUG);
});
