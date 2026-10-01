// Sites : liste, CRUD admin, scan/import, gestionnaire de fichiers, versions, rollback,
// export/import d'archive, duplication, historique des builds, prévisualisation.
const express = require('express');
const fs = require('fs');
const path = require('path');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const hosting = require('../core/hosting');
const releases = require('../lib/releases');
const analytics = require('../lib/analytics');
const { generateSlug, assertSafePath } = require('../lib/paths');
const { validateTheme } = require('../lib/theme');
const { replaceDirAtomically } = require('../lib/fs-swap');
const { sendError } = require('../core/http');
const { logAudit } = require('../core/audit');
const { appendBuildLog } = require('../core/build-log');
const { getPayloadInstance } = require('../core/payload');
const {
  PROJECT_DIR,
  PUBLIC_HTML_DIR,
  RELEASES_DIR,
  getSitePagesFile,
  getSiteThemeFile,
} = require('../core/config');
const { DEFAULT_PAGES, DEFAULT_THEME } = require('../services/defaults');
const { readSitePages, writeJsonFile } = require('../services/content');
const {
  toPosixPath,
  defaultDocumentRoot,
  resolveSiteDomain,
  initialSslStatus,
  ensureConfinedPaths,
  provisionRepository,
  uniqueSlug,
  updateSiteStatus,
  getSiteOwnersMap,
} = require('../services/sites');
const build = require('../services/build');

const router = express.Router();

// Nom lisible dérivé d'un slug (« mon-site » → « Mon Site »).
const titleFromSlug = (slug) => slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// List sites: un admin voit tout, un client uniquement ses sites
router.get('/api/sites', auth.authenticate, auth.requireAuth, async (req, res) => {
  try {
    let sites = await sitesStore.listSites();
    if (!auth.isAdmin(req.user)) {
      sites = sites.filter(s => req.userSiteSlugs.has(s.slug));
    }
    res.json(sites);
  } catch (e) {
    sendError(res, "Impossible de lire la liste des sites.", e);
  }
});

// Propriétaires de chaque site (admin only) : { slug: [emails] }. Déclaré AVANT toute
// route paramétrée /api/sites/:xxx pour éviter toute collision de matching Express.
router.get('/api/sites/owners', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    res.json(await getSiteOwnersMap());
  } catch (e) {
    sendError(res, "Impossible de lire les propriétaires des sites.", e);
  }
});

// Create manual site (admin uniquement)
router.post('/api/sites', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { name, domain, stack, documentRoot, repositoryPath } = req.body;
  if (!name) return res.status(400).json({ error: "Le nom du site est requis." });

  const slug = generateSlug(name);
  if (!slug) return res.status(400).json({ error: "Nom de site invalide : au moins un caractère alphanumérique est requis." });
  if (!ensureConfinedPaths(res, { documentRoot, repositoryPath })) return;

  try {
    if (await sitesStore.getSiteBySlug(slug)) {
      return res.status(400).json({ error: "Un site avec ce nom/slug existe déjà." });
    }

    const newSite = await sitesStore.createSite({
      slug,
      name,
      domain: await resolveSiteDomain(slug, domain),
      documentRoot: documentRoot ? toPosixPath(documentRoot) : defaultDocumentRoot(slug),
      repositoryPath: toPosixPath(repositoryPath || ""),
      stack: stack || "Astro SSG",
      createdWithTool: true,
      status: "draft",
      sslStatus: initialSslStatus()
    });

    provisionRepository(newSite.repositoryPath);

    // Fichiers de contenu initiaux du site
    writeJsonFile(getSitePagesFile(slug), DEFAULT_PAGES);
    writeJsonFile(getSiteThemeFile(slug), DEFAULT_THEME);

    logAudit(req, 'site.creation', slug, `nom=${name}`);
    res.json({ success: true, site: newSite });
  } catch (e) {
    sendError(res, "Impossible de créer le site.", e);
  }
});

// Update manual site metadata (admin uniquement)
router.put('/api/sites/:slug', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const { name, domain, documentRoot, repositoryPath, stack, sslStatus, status, analyticsProvider, analyticsId, analyticsHost } = req.body;

  if (!ensureConfinedPaths(res, { documentRoot, repositoryPath })) return;

  // Mesure d'audience : validation stricte (ces valeurs finissent dans les pages publiées)
  let analyticsChanges = {};
  if (analyticsProvider !== undefined || analyticsId !== undefined || analyticsHost !== undefined) {
    const current = await sitesStore.getSiteBySlug(slug);
    if (!current) return res.status(404).json({ error: "Site non trouvé." });
    const checked = analytics.validateAnalytics({
      provider: analyticsProvider !== undefined ? analyticsProvider : current.analyticsProvider,
      id: analyticsId !== undefined ? analyticsId : current.analyticsId,
      host: analyticsHost !== undefined ? analyticsHost : current.analyticsHost,
    });
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    analyticsChanges = checked.value;
  }

  try {
    const site = await sitesStore.updateSite(slug, {
      name: name || undefined,
      domain: domain || undefined,
      documentRoot: documentRoot ? toPosixPath(documentRoot) : undefined,
      repositoryPath: repositoryPath !== undefined ? toPosixPath(repositoryPath || "") : undefined,
      stack: stack || undefined,
      sslStatus: sslStatus || undefined,
      status: status || undefined,
      ...analyticsChanges
    });
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    res.json({ success: true, site });
  } catch (e) {
    sendError(res, "Impossible de mettre à jour le site.", e);
  }
});

// Delete site (admin uniquement — supprime aussi les fichiers si demandé)
router.delete('/api/sites/:slug', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const deleteFiles = req.query.deleteFiles === 'true';

  try {
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) {
      return res.status(404).json({ error: "Site non trouvé." });
    }

    // La suppression Payload nettoie aussi pages/themes rattachés et la relation users.sites
    await sitesStore.deleteSite(slug);

    // Fichiers JSON de fallback du site
    for (const file of [getSitePagesFile(slug), getSiteThemeFile(slug)]) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    // Dossier de production du site
    if (deleteFiles && site.documentRoot && fs.existsSync(site.documentRoot)) {
      fs.rmSync(site.documentRoot, { recursive: true, force: true });
    }

    logAudit(req, 'site.suppression', req.params.slug, `fichiers=${Boolean(deleteFiles)}`);
    res.json({ success: true, message: "Site supprimé avec succès." });
  } catch (e) {
    sendError(res, "Impossible de supprimer le site.", e);
  }
});

// Scan folder for unregistered sites (admin uniquement — accède au filesystem serveur)
router.post('/api/sites/scan', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const scanPath = req.body.scanPath || req.query.scanPath || PUBLIC_HTML_DIR;

  try {
    const sites = await sitesStore.listSites();
    const registeredRoots = sites.filter(s => s.documentRoot).map(s => path.resolve(s.documentRoot).toLowerCase());
    const registeredRepos = sites.filter(s => s.repositoryPath).map(s => path.resolve(s.repositoryPath).toLowerCase());

    // Les chemins relatifs sont résolus depuis la racine du projet (pas depuis server/)
    const targetDir = path.isAbsolute(scanPath)
      ? path.resolve(scanPath)
      : path.resolve(PROJECT_DIR, scanPath);
    if (!fs.existsSync(targetDir)) {
      return res.status(400).json({ error: `Le chemin spécifié n'existe pas : ${targetDir}` });
    }

    const dirs = fs.readdirSync(targetDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const scanned = [];
    for (const dirName of dirs) {
      const dirPath = path.join(targetDir, dirName);
      const resolvedPath = path.resolve(dirPath);

      // Skip folders already registered
      if (registeredRoots.includes(resolvedPath.toLowerCase()) || registeredRepos.includes(resolvedPath.toLowerCase())) {
        continue;
      }

      const hasIndex = fs.existsSync(path.join(dirPath, 'index.html'));
      const hasPackage = fs.existsSync(path.join(dirPath, 'package.json'));

      if (hasIndex || hasPackage) {
        let detectedStack = "Static HTML";
        if (hasIndex && hasPackage) detectedStack = "Astro Site (Source + Build)";
        else if (hasPackage) detectedStack = "Node.js / CMS Repository";
        else if (hasIndex) detectedStack = "Static Build / HTML";

        scanned.push({
          slug: dirName,
          name: titleFromSlug(dirName),
          documentRoot: toPosixPath(resolvedPath),
          repositoryPath: hasPackage ? toPosixPath(resolvedPath) : "",
          domain: `${dirName}.o2switch.site`,
          stack: detectedStack
        });
      }
    }
    res.json(scanned);
  } catch (e) {
    sendError(res, "Erreur lors du scan du répertoire.", e);
  }
});

// Import scanned site (admin uniquement)
router.post('/api/sites/import', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug: rawSlug, name, domain, stack, documentRoot, repositoryPath } = req.body;
  if (!rawSlug) return res.status(400).json({ error: "Le slug est requis pour l'import." });
  const slug = generateSlug(rawSlug);
  if (!slug) return res.status(400).json({ error: "Slug d'import invalide." });
  if (!ensureConfinedPaths(res, { documentRoot, repositoryPath })) return;

  try {
    if (await sitesStore.getSiteBySlug(slug)) {
      return res.status(400).json({ error: "Ce site est déjà enregistré." });
    }

    const newSite = await sitesStore.createSite({
      slug,
      name: name || titleFromSlug(slug),
      domain: await resolveSiteDomain(slug, domain),
      documentRoot: documentRoot ? toPosixPath(documentRoot) : defaultDocumentRoot(slug),
      repositoryPath: toPosixPath(repositoryPath || ""),
      stack: stack || "Plain HTML (Importé)",
      createdWithTool: false,
      status: "active",
      sslStatus: initialSslStatus()
    });

    provisionRepository(newSite.repositoryPath);

    logAudit(req, 'site.import', slug);
    res.json({ success: true, site: newSite });
  } catch (e) {
    sendError(res, "Impossible d'importer le site.", e);
  }
});

// Racine consultée par le gestionnaire de fichiers : build publié ou dépôt de sources.
const fileManagerRoot = (site, pathType) => (pathType === 'repository' ? site.repositoryPath : site.documentRoot);

// Arborescence d'un dossier de site. Dans un dépôt, on ignore node_modules/.git/.astro
// et on borne la profondeur (évite d'épuiser la mémoire du navigateur).
function walkDir(dir, baseDir, pathType) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (pathType === 'repository' && (file === 'node_modules' || file === '.git' || file === '.astro')) {
      continue;
    }

    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    const relativePath = toPosixPath(path.relative(baseDir, filePath));

    if (stat.isDirectory()) {
      results.push({
        name: file,
        path: relativePath,
        isDir: true,
        mtime: stat.mtime
      });

      const depth = relativePath.split('/').length;
      if (pathType === 'repository' && depth > 3) {
        continue;
      }
      results = results.concat(walkDir(filePath, baseDir, pathType));
    } else {
      results.push({
        name: file,
        path: relativePath,
        isDir: false,
        size: stat.size,
        mtime: stat.mtime
      });
    }
  }
  return results;
}

// List files of a specific site for file manager (admin uniquement)
router.get('/api/sites/:slug/files', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const pathType = req.query.type || 'documentRoot'; // 'documentRoot' or 'repository'

  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const rootDir = fileManagerRoot(site, pathType);
    if (!rootDir || !fs.existsSync(rootDir)) {
      return res.json([]);
    }
    res.json(walkDir(rootDir, rootDir, pathType));
  } catch (e) {
    sendError(res, "Erreur lors de la lecture des fichiers.", e);
  }
});

// View text file content of a specific site (admin uniquement)
router.get('/api/sites/:slug/files/view', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const relativePath = req.query.path;
  const pathType = req.query.type || 'documentRoot'; // 'documentRoot' or 'repository'

  if (!relativePath) return res.status(400).json({ error: "Le chemin du fichier est requis." });

  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const rootDir = fileManagerRoot(site, pathType);
    if (!rootDir || !fs.existsSync(rootDir)) {
      return res.status(404).json({ error: "Dossier racine introuvable." });
    }

    const filePath = path.join(rootDir, relativePath);
    // Anti-traversée : le fichier doit rester sous la racine
    const rel = path.relative(rootDir, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(403).json({ error: "Accès interdit." });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: "Fichier non trouvé." });
    }

    if (fs.statSync(filePath).size > 200 * 1024) {
      return res.status(400).json({ error: "Fichier trop volumineux pour l'affichage." });
    }

    res.json({ content: fs.readFileSync(filePath, 'utf-8') });
  } catch (e) {
    sendError(res, "Impossible de lire le fichier.", e);
  }
});

// --- Releases & rollback (admin only) ---

// Versions de déploiement disponibles pour un site (plus récentes d'abord)
router.get('/api/sites/:slug/releases', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    res.json(releases.listReleases(RELEASES_DIR, req.params.slug));
  } catch (e) {
    sendError(res, "Impossible de lister les versions.", e);
  }
});

// Historique des builds d'un site (admin ou propriétaire — ownership vérifié).
router.get('/api/sites/:slug/builds', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.params.slug), async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    const payloadInstance = getPayloadInstance();
    if (!payloadInstance) return res.json([]);
    const siteDoc = await sitesStore.getOrCreatePayloadDoc(req.params.slug);
    const out = await payloadInstance.find({
      collection: 'builds',
      where: { site: { equals: siteDoc.id } },
      sort: '-createdAt',
      limit: 10,
      depth: 0,
      overrideAccess: true,
    });
    res.json(out.docs.map((b) => ({
      status: b.status,
      durationMs: b.durationMs ?? null,
      triggeredBy: b.triggeredBy ?? null,
      createdAt: b.createdAt,
    })));
  } catch (e) {
    sendError(res, "Impossible de lire l'historique des builds.", e);
  }
});

// Prévisualisation brouillon : compile le contenu courant vers /draft/<slug>/ sans
// rien publier. Accessible au propriétaire du site (comme le CMS qu'il édite).
router.post('/api/sites/:slug/preview-build', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.params.slug), async (req, res) => {
  const slug = req.params.slug;
  try {
    // Astro écrit dans un dossier dist unique : pas de build concurrent.
    if (build.isBusy()) {
      return res.status(409).json({ error: "Un build est en cours : réessayez dans un instant." });
    }
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const url = await build.runDraftPreview(slug);
    logAudit(req, 'site.previsualisation', slug);
    res.json({ success: true, url });
  } catch (e) {
    sendError(res, "Impossible de générer la prévisualisation.", e);
  }
});

// Rollback : republie une version conservée dans le documentRoot (bascule atomique).
router.post('/api/sites/:slug/rollback', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const slug = req.params.slug;
  try {
    // Pas de rollback pendant un build : le pipeline va justement remplacer la cible
    if (build.isBusy()) {
      return res.status(409).json({ error: "Un build est en cours : réessayez quand il sera terminé." });
    }
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    // L'identifiant client n'est jamais utilisé comme chemin : la release est résolue
    // depuis RELEASES_DIR/slug uniquement (identifiants hostiles → null → 400).
    const releaseDir = releases.resolveRelease(RELEASES_DIR, slug, req.body?.release);
    if (!releaseDir) return res.status(400).json({ error: "Version inconnue ou invalide." });

    const siteDestDir = site.documentRoot;
    assertSafePath(siteDestDir, PUBLIC_HTML_DIR);
    // Même motif atomique que le déploiement : copie complète puis bascule par rename
    replaceDirAtomically(releaseDir, siteDestDir, 'rollback');

    // En mode cpanel : republier aussi la version restaurée sur l'hébergement réel
    if (hosting.isRemote) {
      await hosting.publish(slug, siteDestDir);
    }

    updateSiteStatus(slug, 'active');
    appendBuildLog(`ROLLBACK : site "${slug}" restauré sur la release ${req.body.release}.`);
    logAudit(req, 'site.rollback', slug, `release=${req.body.release}`);
    res.json({ success: true, release: req.body.release });
  } catch (e) {
    sendError(res, "Échec du retour à la version précédente.", e);
  }
});

// --- Export / import de site (admin only) ---

// Export : archive zip streamée contenant meta.json, pages.json, theme.json et le
// build déployé (dist/) s'il existe. Sert de sauvegarde ou de transfert.
router.get('/api/sites/:slug/export', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const archiver = require('archiver');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="site-${site.slug}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (e) => { console.error('Erreur export zip :', e.message); res.destroy(); });
    archive.pipe(res);

    const meta = { slug: site.slug, name: site.name, domain: site.domain, stack: site.stack, exportedAt: new Date().toISOString() };
    archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' });
    archive.append(JSON.stringify(await readSitePages(site.slug), null, 2), { name: 'pages.json' });

    const themeFile = getSiteThemeFile(site.slug);
    if (fs.existsSync(themeFile)) {
      archive.file(themeFile, { name: 'theme.json' });
    }
    if (site.documentRoot && fs.existsSync(site.documentRoot)) {
      try {
        assertSafePath(site.documentRoot, PUBLIC_HTML_DIR);
        archive.directory(site.documentRoot, 'dist');
      } catch {
        // documentRoot hérité hors périmètre : on exporte sans le build
      }
    }
    logAudit(req, 'site.export', site.slug);
    await archive.finalize();
  } catch (e) {
    sendError(res, "Échec de l'export du site.", e);
  }
});

// Import : recrée un site depuis une archive d'export. Corps = zip brut (bornés à 50 Mo).
// Anti zip-slip : chaque entrée est filtrée (basename/segments contrôlés) et écrite
// uniquement sous le documentRoot fraîchement créé via assertSafePath.
router.post('/api/sites/import-archive',
  auth.authenticate, auth.requireAdmin,
  express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '50mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Archive manquante (envoyez le zip en corps de requête, Content-Type: application/zip)." });
      }
      const AdmZip = require('adm-zip');
      let zip;
      try {
        zip = new AdmZip(req.body);
      } catch {
        return res.status(400).json({ error: "Archive illisible : zip invalide." });
      }

      const readEntry = (name) => {
        const entry = zip.getEntry(name);
        return entry ? zip.readAsText(entry) : null;
      };

      let meta;
      try {
        meta = JSON.parse(readEntry('meta.json') || '');
      } catch {
        return res.status(400).json({ error: "meta.json absent ou invalide dans l'archive." });
      }

      const baseSlug = generateSlug(meta.slug || meta.name || '');
      if (!baseSlug) return res.status(400).json({ error: "Slug invalide dans meta.json." });
      const slug = await uniqueSlug(baseSlug);

      const documentRoot = defaultDocumentRoot(slug);
      const newSite = await sitesStore.createSite({
        slug,
        name: meta.name || slug,
        domain: await resolveSiteDomain(slug),
        documentRoot,
        repositoryPath: "",
        stack: meta.stack || "Astro SSG",
        createdWithTool: true,
        status: "draft",
        sslStatus: initialSslStatus()
      });

      // Pages : fichier JSON de fallback (repris par le CMS puis persisté dans Payload
      // à la première sauvegarde). Thème : validé avant écriture.
      const pagesRaw = readEntry('pages.json');
      if (pagesRaw) {
        try {
          const pagesData = JSON.parse(pagesRaw);
          if (pagesData && Array.isArray(pagesData.docs)) {
            writeJsonFile(getSitePagesFile(slug), pagesData);
          }
        } catch { /* pages illisibles : le site démarre avec les pages par défaut */ }
      }
      const themeRaw = readEntry('theme.json');
      if (themeRaw) {
        try {
          const themeData = JSON.parse(themeRaw);
          if (validateTheme(themeData && themeData.theme).ok) {
            writeJsonFile(getSiteThemeFile(slug), themeData);
          }
        } catch { /* thème illisible : défaut au premier enregistrement */ }
      }

      // Build embarqué (dist/) : extraction contrôlée entrée par entrée
      let extracted = 0;
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith('dist/')) continue;
        const relative = entry.entryName.slice('dist/'.length);
        // refuser toute entrée louche (segments vides, "..", chemins absolus)
        const segments = relative.split('/');
        if (segments.some((s) => s === '' || s === '.' || s === '..')) continue;
        const dest = path.join(documentRoot, ...segments);
        assertSafePath(dest, PUBLIC_HTML_DIR);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
        extracted++;
      }
      if (extracted > 0) updateSiteStatus(slug, 'active');

      logAudit(req, 'site.import-archive', slug, `fichiers=${extracted}`);
      res.json({ success: true, site: newSite, extractedFiles: extracted });
    } catch (e) {
      sendError(res, "Échec de l'import de l'archive.", e);
    }
  });

// Duplication d'un site (admin) : crée un jumeau (contenu + thème) sous un nouveau slug.
router.post('/api/sites/:slug/duplicate', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const source = await sitesStore.getSiteBySlug(req.params.slug);
    if (!source) return res.status(404).json({ error: "Site source introuvable." });

    const slug = await uniqueSlug(generateSlug(`${source.slug}-copie`) || `${source.slug}-copie`);
    const newSite = await sitesStore.createSite({
      slug,
      name: `${source.name} (copie)`,
      domain: await resolveSiteDomain(slug),
      documentRoot: defaultDocumentRoot(slug),
      repositoryPath: "",
      stack: source.stack,
      createdWithTool: true,
      status: "draft",
      sslStatus: initialSslStatus()
    });

    // Contenu + thème copiés via le fallback JSON (repris par le CMS, persisté dans
    // Payload à la première sauvegarde) — même approche que l'import d'archive.
    try {
      const pagesData = await readSitePages(source.slug);
      if (pagesData && Array.isArray(pagesData.docs)) {
        writeJsonFile(getSitePagesFile(slug), pagesData);
      }
    } catch { /* pages source illisibles : le jumeau démarre avec les pages par défaut */ }
    const srcTheme = getSiteThemeFile(source.slug);
    if (fs.existsSync(srcTheme)) {
      try { fs.copyFileSync(srcTheme, getSiteThemeFile(slug)); } catch { /* thème par défaut sinon */ }
    }

    logAudit(req, 'site.duplication', slug, `source=${source.slug}`);
    res.json({ success: true, site: newSite });
  } catch (e) {
    sendError(res, "Échec de la duplication du site.", e);
  }
});

module.exports = router;
