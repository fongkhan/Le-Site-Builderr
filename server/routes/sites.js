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
const { generateSlug, assertSafePath, assertStrictlyInside, previewPathFor } = require('../lib/paths');
const { publicSiteView } = require('../lib/sites-view');
const { validateTheme } = require('../lib/theme');
const { replaceDirAtomically } = require('../lib/fs-swap');
const { sendError, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const { getPayloadInstance } = require('../core/payload');
const {
  PROJECT_DIR,
  PUBLIC_HTML_DIR,
  REPOSITORIES_DIR,
  RELEASES_DIR,
  getSitePagesFile,
  getSiteThemeFile,
} = require('../core/config');
const { DEFAULT_THEME, starterPages } = require('../services/defaults');
const { readSitePages, readSitePosts, normalizePost, writePostsFile, writeJsonFile, findPayloadSiteId } = require('../services/content');
const {
  toPosixPath,
  defaultDocumentRoot,
  resolveSiteDomain,
  initialSslStatus,
  ensureConfinedPaths,
  provisionRepository,
  purgeSiteData,
  uniqueSlug,
  updateSiteStatus,
  getSiteOwnersMap,
} = require('../services/sites');
const build = require('../services/build');

const router = createRouter();

// Nom lisible dérivé d'un slug (« mon-site » → « Mon Site »).
const titleFromSlug = (slug) => slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// List sites: un admin voit tout, un client uniquement ses sites
router.get('/api/sites', auth.authenticate, auth.requireAuth, async (req, res) => {
  try {
    let sites = await sitesStore.listSites();
    if (!auth.isAdmin(req.user)) {
      sites = sites.filter(s => req.userSiteSlugs.has(s.slug));
    }
    // Adresse de la copie servie par l'orchestrateur (publication simulée), calculée
    // avant le retrait des chemins serveur pour un client
    const isAdmin = auth.isAdmin(req.user);
    res.json(sites.map((s) => publicSiteView(
      { ...s, previewPath: `${previewPathFor(s.documentRoot, PUBLIC_HTML_DIR, s.slug)}/` },
      { isAdmin }
    )));
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
  const invalid = invalidSiteFields({ name, domain, stack });
  if (invalid) return res.status(400).json({ error: invalid });

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

    // Fichiers de contenu initiaux du site : pages de départ à son nom, thème par défaut
    writeJsonFile(getSitePagesFile(slug), starterPages(name));
    writeJsonFile(getSiteThemeFile(slug), DEFAULT_THEME);

    logAudit(req, 'site.creation', slug, `nom=${name}`);
    res.json({ success: true, site: newSite });
  } catch (e) {
    sendError(res, "Impossible de créer le site.", e);
  }
});

const SITE_STATUSES = ['draft', 'active', 'error'];
const SSL_STATUSES = ['active', 'pending', 'none'];

// Champs texte d'un site : chaîne bornée, sinon message d'erreur (valeur absente = OK).
function invalidSiteFields({ name, domain, stack, status, sslStatus }) {
  const badString = (v, max) => v !== undefined && v !== null && (typeof v !== 'string' || v.length > max);
  if (badString(name, 200) || badString(domain, 253) || badString(stack, 100)) return "Champ texte invalide ou trop long.";
  if (status !== undefined && status !== '' && !SITE_STATUSES.includes(status)) return "Statut de site inconnu.";
  if (sslStatus !== undefined && sslStatus !== '' && !SSL_STATUSES.includes(sslStatus)) return "Statut SSL inconnu.";
  return null;
}

// Update manual site metadata (admin uniquement)
router.put('/api/sites/:slug', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const { name, domain, documentRoot, repositoryPath, stack, sslStatus, status, analyticsProvider, analyticsId, analyticsHost } = req.body;

  const invalid = invalidSiteFields(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
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
    const changed = Object.keys(req.body || {}).filter((k) => req.body[k] !== undefined).join(',');
    logAudit(req, 'site.modification', slug, changed ? `champs=${changed}` : '');
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

    // Fichiers de production : jamais hors du périmètre ni la racine partagée elle-même
    // (un documentRoot hérité invalide n'est pas supprimé, le site l'est quand même).
    let removableRoot = null;
    if (deleteFiles && site.documentRoot) {
      try {
        removableRoot = assertStrictlyInside(site.documentRoot, PUBLIC_HTML_DIR);
      } catch {
        console.error(`⚠️ [Sites] documentRoot hors périmètre conservé lors de la suppression de ${slug} : ${site.documentRoot}`);
      }
    }

    // Hébergement distant (cPanel) : retrait du site en ligne AVANT la suppression locale
    // (le domaine personnalisé n'est plus connu ensuite). Chaque étape est tentée ; un
    // retrait partiel n'empêche pas la suppression locale mais est signalé.
    let remote = null;
    if (hosting.isRemote && deleteFiles) {
      try {
        remote = await hosting.removeSite(slug, { customDomain: site.customDomain || '' });
      } catch (e) {
        console.error(`⚠️ [Sites] Retrait distant de ${slug} refusé : ${e.message}`);
        remote = { removed: false, customDomain: 'failed', subdomain: 'failed', files: 'failed' };
      }
    }

    // La suppression Payload nettoie aussi les contenus rattachés (médias et leurs
    // fichiers compris) et la relation users.sites
    await sitesStore.deleteSite(slug);
    purgeSiteData(slug);

    if (removableRoot && fs.existsSync(removableRoot)) {
      fs.rmSync(removableRoot, { recursive: true, force: true });
    }

    const remoteAudit = remote ? ` distant=${remote.removed ? 'ok' : 'partiel'}` : '';
    logAudit(req, 'site.suppression', req.params.slug, `fichiers=${Boolean(deleteFiles)}${remoteAudit}`);
    res.json({
      success: true,
      message: remote && !remote.removed
        ? "Site supprimé, mais son retrait de l'hébergement est incomplet : vérifiez le serveur."
        : "Site supprimé avec succès.",
      remote,
    });
  } catch (e) {
    sendError(res, "Impossible de supprimer le site.", e);
  }
});

// Vrai si `p` est dans `base` (ou est `base`).
const isWithin = (p, base) => {
  try { assertSafePath(p, base); return true; } catch { return false; }
};

// Scan folder for unregistered sites (admin uniquement — accède au filesystem serveur).
// Confiné aux racines importables (production simulée, dépôts) : un dossier situé
// ailleurs ne pourrait de toute façon pas être importé.
router.post('/api/sites/scan', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const scanPath = req.body.scanPath || req.query.scanPath || PUBLIC_HTML_DIR;

  try {
    const sites = await sitesStore.listSites();
    const registeredRoots = sites.filter(s => s.documentRoot).map(s => path.resolve(s.documentRoot).toLowerCase());
    const registeredRepos = sites.filter(s => s.repositoryPath).map(s => path.resolve(s.repositoryPath).toLowerCase());

    // Les chemins relatifs sont résolus depuis la racine du projet (pas depuis server/)
    const targetDir = path.isAbsolute(String(scanPath))
      ? path.resolve(String(scanPath))
      : path.resolve(PROJECT_DIR, String(scanPath));
    if (!isWithin(targetDir, PUBLIC_HTML_DIR) && !isWithin(targetDir, REPOSITORIES_DIR)) {
      return res.status(400).json({ error: "Chemin non autorisé : le scan est limité au dossier de production et aux dépôts du projet." });
    }
    if (!fs.existsSync(targetDir)) {
      return res.status(400).json({ error: `Le chemin spécifié n'existe pas : ${targetDir}` });
    }

    // Copies de bascule (X.tmp-…, X.old-…) jamais proposées à l'import
    const dirs = fs.readdirSync(targetDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !/\.(tmp|old)-/.test(dirent.name))
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

        // Proposés uniquement dans leurs racines d'import respectives (sinon l'import
        // refuserait le chemin) : un build sert de documentRoot, des sources de dépôt.
        const inPublic = isWithin(resolvedPath, PUBLIC_HTML_DIR);
        scanned.push({
          slug: dirName,
          name: titleFromSlug(dirName),
          documentRoot: inPublic ? toPosixPath(resolvedPath) : "",
          repositoryPath: hasPackage && isWithin(resolvedPath, REPOSITORIES_DIR) ? toPosixPath(resolvedPath) : "",
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

// Arborescence d'un dossier de site. Les liens symboliques ne sont jamais suivis (pas de
// boucle ni de sortie de la racine) ; profondeur et nombre d'entrées sont bornés. Dans un
// dépôt, on ignore node_modules/.git/.astro et on limite davantage la profondeur.
const WALK_MAX_ENTRIES = 5000;
function walkDir(dir, baseDir, pathType, results = []) {
  const maxDepth = pathType === 'repository' ? 3 : 12;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (results.length >= WALK_MAX_ENTRIES) break;
    const file = entry.name;
    if (pathType === 'repository' && (file === 'node_modules' || file === '.git' || file === '.astro')) {
      continue;
    }
    if (entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, file);
    const stat = fs.lstatSync(filePath);
    const relativePath = toPosixPath(path.relative(baseDir, filePath));

    if (stat.isDirectory()) {
      results.push({
        name: file,
        path: relativePath,
        isDir: true,
        mtime: stat.mtime
      });
      if (relativePath.split('/').length <= maxDepth) {
        walkDir(filePath, baseDir, pathType, results);
      }
    } else if (stat.isFile()) {
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

    const filePath = path.join(rootDir, String(relativePath));
    // Anti-traversée : le fichier doit rester sous la racine
    const rel = path.relative(rootDir, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(403).json({ error: "Accès interdit." });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: "Fichier non trouvé." });
    }
    // Un lien symbolique pourrait pointer hors de la racine : chemin réel vérifié aussi
    const realRel = path.relative(fs.realpathSync(rootDir), fs.realpathSync(filePath));
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      return res.status(403).json({ error: "Accès interdit." });
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
    // Lecture seule : un GET ne crée jamais de référence de site en base
    const siteId = await findPayloadSiteId(payloadInstance, req.params.slug);
    if (!siteId) return res.json([]);
    const out = await payloadInstance.find({
      collection: 'builds',
      where: { site: { equals: siteId } },
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
  // Astro écrit dans un dossier dist unique : pas de build concurrent. Réservation
  // SYNCHRONE du créneau (aucun await avant) : deux demandes simultanées ne peuvent
  // pas compiler en même temps.
  if (!build.tryReserve()) {
    return res.status(409).json({ error: "Un build est en cours : réessayez dans un instant." });
  }
  let handedOver = false;
  try {
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    handedOver = true; // runDraftPreview libère le créneau dans tous les cas
    const url = await build.runDraftPreview(slug);
    logAudit(req, 'site.previsualisation', slug);
    res.json({ success: true, url });
  } catch (e) {
    sendError(res, "Impossible de générer la prévisualisation.", e);
  } finally {
    if (!handedOver) build.release();
  }
});

// Rollback : republie une version conservée dans le documentRoot (bascule atomique).
router.post('/api/sites/:slug/rollback', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const slug = req.params.slug;
  // Pas de rollback pendant un build (le pipeline remplace justement la cible) ; le
  // créneau est réservé pendant toute la bascule pour qu'aucun build ne démarre en parallèle.
  if (!build.tryReserve()) {
    return res.status(409).json({ error: "Un build est en cours : réessayez quand il sera terminé." });
  }
  try {
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    // L'identifiant client n'est jamais utilisé comme chemin : la release est résolue
    // depuis RELEASES_DIR/slug uniquement (identifiants hostiles → null → 400).
    const releaseDir = releases.resolveRelease(RELEASES_DIR, slug, req.body?.release);
    if (!releaseDir) return res.status(400).json({ error: "Version inconnue ou invalide." });

    const siteDestDir = site.documentRoot;
    assertStrictlyInside(siteDestDir, PUBLIC_HTML_DIR);
    // Même motif atomique que le déploiement : copie complète puis bascule par rename
    replaceDirAtomically(releaseDir, siteDestDir, 'rollback');

    // En mode cpanel : republier aussi la version restaurée sur l'hébergement réel
    if (hosting.isRemote) {
      try {
        await hosting.publish(slug, siteDestDir);
      } catch (publishErr) {
        // La copie locale est déjà restaurée : on le dit, et le site passe en erreur
        updateSiteStatus(slug, 'error');
        logAudit(req, 'site.rollback', slug, `release=${req.body.release} (publication distante échouée)`);
        return sendError(res, "Version restaurée localement, mais sa publication sur l'hébergement a échoué.", publishErr, 502);
      }
    }

    updateSiteStatus(slug, 'active');
    logAudit(req, 'site.rollback', slug, `release=${req.body.release}`);
    res.json({ success: true, release: req.body.release });
  } catch (e) {
    sendError(res, "Échec du retour à la version précédente.", e);
  } finally {
    build.release();
  }
});

// --- Export / import de site (admin only) ---

// Export : archive zip streamée contenant meta.json, pages.json, posts.json, theme.json
// et le build déployé (dist/) s'il existe. Sert de sauvegarde ou de transfert.
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
    archive.append(JSON.stringify(await readSitePosts(site.slug), null, 2), { name: 'posts.json' });

    const themeFile = getSiteThemeFile(site.slug);
    if (fs.existsSync(themeFile)) {
      archive.file(themeFile, { name: 'theme.json' });
    }
    if (site.documentRoot && fs.existsSync(site.documentRoot)) {
      try {
        assertStrictlyInside(site.documentRoot, PUBLIC_HTML_DIR);
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

// Bornes de l'archive importée (anti zip bomb) : nombre d'entrées et taille décompressée.
const IMPORT_MAX_ENTRIES = 5000;
const IMPORT_MAX_UNCOMPRESSED = 200 * 1024 * 1024;

// Import : recrée un site depuis une archive d'export. Corps = zip brut (bornés à 50 Mo).
// Anti zip-slip : chaque entrée est filtrée (segments contrôlés) et écrite uniquement sous
// le documentRoot fraîchement créé via assertSafePath. En cas d'échec après la création,
// le site partiellement importé est supprimé.
router.post('/api/sites/import-archive',
  auth.authenticate, auth.requireAdmin,
  express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '50mb' }),
  async (req, res) => {
    let createdSlug = null;
    let createdDocumentRoot = null;
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
        meta = null;
      }
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return res.status(400).json({ error: "meta.json absent ou invalide dans l'archive." });
      }

      const entries = zip.getEntries();
      const uncompressed = entries.reduce((sum, e) => sum + (Number(e.header && e.header.size) || 0), 0);
      if (entries.length > IMPORT_MAX_ENTRIES || uncompressed > IMPORT_MAX_UNCOMPRESSED) {
        return res.status(400).json({ error: "Archive trop volumineuse une fois décompressée." });
      }

      const asText = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');
      const baseSlug = generateSlug(asText(meta.slug, 200) || asText(meta.name, 200));
      if (!baseSlug) return res.status(400).json({ error: "Slug invalide dans meta.json." });
      const slug = await uniqueSlug(baseSlug);

      const documentRoot = defaultDocumentRoot(slug);
      // uniqueSlug écarte les dossiers existants : en cas d'échec, on ne supprime que ce
      // que cet import a créé (jamais des fichiers conservés d'un ancien site).
      const documentRootExisted = fs.existsSync(documentRoot);
      const newSite = await sitesStore.createSite({
        slug,
        name: asText(meta.name, 200) || slug,
        domain: await resolveSiteDomain(slug),
        documentRoot,
        repositoryPath: "",
        stack: asText(meta.stack, 100) || "Astro SSG",
        createdWithTool: true,
        status: "draft",
        sslStatus: initialSslStatus()
      });
      createdSlug = slug;
      createdDocumentRoot = documentRootExisted ? null : documentRoot;

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
      const postsRaw = readEntry('posts.json');
      if (postsRaw) {
        try {
          const postsData = JSON.parse(postsRaw);
          if (postsData && Array.isArray(postsData.docs)) {
            const posts = postsData.docs
              .filter((p) => p && typeof p === 'object' && typeof p.title === 'string' && generateSlug(p.slug))
              .map((p) => normalizePost({ ...p, slug: generateSlug(p.slug) }));
            writePostsFile(slug, posts);
          }
        } catch { /* articles illisibles : le blog démarre vide */ }
      }

      // Build embarqué (dist/) : extraction contrôlée entrée par entrée
      let extracted = 0;
      for (const entry of entries) {
        if (entry.isDirectory || !entry.entryName.startsWith('dist/')) continue;
        const relative = entry.entryName.slice('dist/'.length);
        // refuser toute entrée louche (segments vides, "..", chemins absolus, séparateurs
        // Windows ou caractères de contrôle)
        const segments = relative.split('/');
        if (segments.some((s) => s === '' || s === '.' || s === '..' || /[\\:\0]/.test(s))) continue;
        const dest = path.join(documentRoot, ...segments);
        assertSafePath(dest, documentRoot);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
        extracted++;
      }
      if (extracted > 0) updateSiteStatus(slug, 'active');

      logAudit(req, 'site.import-archive', slug, `fichiers=${extracted}`);
      res.json({ success: true, site: newSite, extractedFiles: extracted });
    } catch (e) {
      // Pas de site à moitié importé : on défait la création (best-effort).
      if (createdSlug) {
        try {
          await sitesStore.deleteSite(createdSlug);
          purgeSiteData(createdSlug);
          if (createdDocumentRoot) {
            fs.rmSync(assertStrictlyInside(createdDocumentRoot, PUBLIC_HTML_DIR), { recursive: true, force: true });
          }
        } catch (cleanupErr) {
          console.error("Nettoyage de l'import raté :", cleanupErr.message);
        }
      }
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
    let pagesData = null;
    try { pagesData = await readSitePages(source.slug); } catch { /* pages source illisibles : pages par défaut */ }
    let postsDocs = null;
    try { postsDocs = (await readSitePosts(source.slug)).docs; } catch { /* articles source illisibles : pas de blog */ }

    // Images : le jumeau reçoit ses propres copies (supprimer l'un ne casse pas l'autre),
    // et son contenu cite les nouveaux noms de fichiers.
    const { copySiteMedia } = require('../services/sites');
    const { remapMediaFilenames } = require('../lib/media');
    let mediaMap = {};
    try {
      const payloadInstance = getPayloadInstance();
      const targetId = payloadInstance ? await findPayloadSiteId(payloadInstance, slug) : null;
      if (targetId) mediaMap = await copySiteMedia(source.slug, targetId, { pages: pagesData, posts: postsDocs });
    } catch (e) {
      console.error(`[Duplication] Médias de ${source.slug} non copiés :`, e.message);
    }

    if (pagesData && Array.isArray(pagesData.docs)) {
      try {
        writeJsonFile(getSitePagesFile(slug), remapMediaFilenames(pagesData, mediaMap));
      } catch { /* le jumeau démarre avec les pages par défaut */ }
    }
    const srcTheme = getSiteThemeFile(source.slug);
    if (fs.existsSync(srcTheme)) {
      try { fs.copyFileSync(srcTheme, getSiteThemeFile(slug)); } catch { /* thème par défaut sinon */ }
    }
    if (postsDocs) {
      try { writePostsFile(slug, remapMediaFilenames(postsDocs, mediaMap)); } catch { /* le jumeau démarre sans blog */ }
    }

    logAudit(req, 'site.duplication', slug, `source=${source.slug} médias=${Object.keys(mediaMap).length}`);
    res.json({ success: true, site: newSite });
  } catch (e) {
    sendError(res, "Échec de la duplication du site.", e);
  }
});

module.exports = router;
