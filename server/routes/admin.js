// Administration : vue d'ensemble multi-sites, sauvegardes, journal d'audit, hébergement.
const fs = require('fs');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const hosting = require('../core/hosting');
const stats = require('../lib/stats');
const { sendError, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const { parseAuditQuery, parseRetentionDays } = require('../lib/audit-events');
const { getPayloadInstance } = require('../core/payload');
const { getSiteStatsFile } = require('../core/config');
const { readJsonFile } = require('../services/content');
const backups = require('../services/backups');

const router = createRouter();

// Vue d'ensemble multi-sites (admin) : statut, domaine/SSL et visites agrégées par site.
router.get('/api/admin/overview', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const sites = await sitesStore.listSites();
    const rows = sites.map((s) => {
      let statsData;
      try { statsData = readJsonFile(getSiteStatsFile(s.slug), {}) || {}; } catch { statsData = {}; }
      const series = stats.lastNDays(statsData, 30);
      return {
        slug: s.slug,
        name: s.name,
        domain: s.domain,
        status: s.status,
        sslStatus: s.sslStatus,
        domainStatus: s.domainStatus || 'none',
        customDomain: s.customDomain || '',
        visitsTotal: stats.total(statsData),
        visits30: series.reduce((sum, d) => sum + d.count, 0),
        series: series.map((d) => d.count),
      };
    });
    const totals = {
      sites: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      visits30: rows.reduce((sum, r) => sum + r.visits30, 0),
      customDomains: rows.filter((r) => r.domainStatus === 'active').length,
    };
    res.json({ totals, sites: rows });
  } catch (e) {
    sendError(res, "Impossible de charger la vue d'ensemble.", e);
  }
});

// --- Sauvegardes automatiques du contenu ---

// Liste des sauvegardes (admin) + configuration courante.
router.get('/api/admin/backups', auth.authenticate, auth.requireAdmin, (req, res) => {
  try {
    res.json({ config: backups.backupConfig(), backups: backups.listBackups() });
  } catch (e) {
    sendError(res, "Impossible de lister les sauvegardes.", e);
  }
});

// Déclenche une sauvegarde immédiate (admin).
router.post('/api/admin/backups', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const filename = await backups.createBackupArchive();
    if (!filename) return res.status(409).json({ error: "Une sauvegarde est déjà en cours." });
    logAudit(req, 'sauvegarde.creation', 'global', filename);
    res.json({ success: true, filename });
  } catch (e) {
    sendError(res, "Échec de la sauvegarde.", e);
  }
});

// Téléchargement d'une sauvegarde (admin) — nom strictement validé (anti-traversée).
router.get('/api/admin/backups/download', auth.authenticate, auth.requireAdmin, (req, res) => {
  const name = req.query.name;
  const file = backups.backupFilePath(name);
  if (!file) return res.status(400).json({ error: "Nom de sauvegarde invalide." });
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Sauvegarde introuvable." });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  fs.createReadStream(file)
    .on('error', (e) => {
      if (res.headersSent) return res.destroy(e);
      sendError(res, "Lecture de la sauvegarde impossible.", e);
    })
    .pipe(res);
});

// --- Restauration d'une sauvegarde (admin) ---

// Erreur de restauration : message explicite (statut < 500) ou erreur serveur journalisée
// sans détail interne dans la réponse.
function sendRestoreError(res, e, fallback) {
  if (e instanceof backups.RestoreError) {
    if (e.status < 500) return res.status(e.status).json({ error: e.message });
    return sendError(res, e.message, e.cause || e, e.status);
  }
  return sendError(res, fallback, e);
}

// Sites contenus dans une sauvegarde (pages, articles, images, existence actuelle).
router.get('/api/admin/backups/sites', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    res.json(await backups.describeBackup(req.query.name));
  } catch (e) {
    sendRestoreError(res, e, "Impossible de lire la sauvegarde.");
  }
});

// Restaure un site : { name, slug, mode: 'copy' | 'replace' }.
router.post('/api/admin/backups/restore', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const parsed = backups.parseRestoreRequest(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { name, slug, mode } = parsed;
  try {
    const result = await backups.restoreSiteFromBackup(parsed);
    const images = result.media.restored + result.media.copied;
    const safety = result.safetyBackup ? ` securite=${result.safetyBackup}` : '';
    logAudit(req, 'sauvegarde.restauration', result.site.slug, `archive=${name} source=${slug} mode=${mode}${safety} images=${images}`);
    res.json({ success: true, ...result });
  } catch (e) {
    if (e && e.safetyBackup) {
      logAudit(req, 'sauvegarde.restauration', slug, `archive=${name} source=${slug} mode=replace échec securite=${e.safetyBackup}`);
    }
    sendRestoreError(res, e, "Échec de la restauration.");
  }
});

// --- Hébergement (admin only) : état du driver et test de connexion cPanel ---
// status() ne renvoie JAMAIS le jeton API (hôte/utilisateur/domaine racine seulement).
router.get('/api/hosting/status', auth.authenticate, auth.requireAdmin, (req, res) => {
  res.json(hosting.status());
});

router.post('/api/hosting/test', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    res.json(await hosting.testConnection());
  } catch (e) {
    // Message contrôlé par le driver (jamais le jeton)
    res.status(502).json({ ok: false, error: e.message });
  }
});

// --- Journal d'audit (admin only, lecture seule) ---
// Page d'entrées, plus récentes d'abord : ?page=1&limit=50 (1 à 200), filtres facultatifs
// ?action=a.,b. (préfixes, contient), ?target= et ?actor= (valeur exacte).
router.get('/api/audit', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const query = parseAuditQuery(req.query);
  if (query.error) return res.status(400).json({ error: query.error });
  const { page, limit, where } = query;
  const retentionDays = parseRetentionDays(process.env.AUDIT_RETENTION_DAYS);
  try {
    const payloadInstance = getPayloadInstance();
    if (!payloadInstance) {
      return res.json({ docs: [], totalDocs: 0, page: 1, totalPages: 0, hasNextPage: false, limit, retentionDays });
    }
    const out = await payloadInstance.find({
      collection: 'audit_logs',
      // Identifiant en second critère : pagination stable à date égale
      sort: ['-createdAt', '-id'],
      page,
      limit,
      ...(where ? { where } : {}),
      depth: 0,
      overrideAccess: true,
    });
    res.json({
      docs: out.docs.map((d) => ({
        id: d.id,
        action: d.action,
        actor: d.actor,
        target: d.target,
        details: d.details,
        createdAt: d.createdAt,
      })),
      totalDocs: out.totalDocs,
      page: out.page,
      totalPages: out.totalPages,
      hasNextPage: out.hasNextPage,
      limit,
      retentionDays,
    });
  } catch (e) {
    sendError(res, "Impossible de lire le journal d'audit.", e);
  }
});

module.exports = router;
