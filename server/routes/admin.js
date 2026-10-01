// Administration : vue d'ensemble multi-sites, sauvegardes, journal d'audit, hébergement.
const express = require('express');
const fs = require('fs');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const hosting = require('../core/hosting');
const stats = require('../lib/stats');
const { sendError } = require('../core/http');
const { logAudit } = require('../core/audit');
const { getPayloadInstance } = require('../core/payload');
const { getSiteStatsFile } = require('../core/config');
const { readJsonFile } = require('../services/content');
const backups = require('../services/backups');

const router = express.Router();

// Vue d'ensemble multi-sites (admin) : statut, domaine/SSL et visites agrégées par site.
router.get('/api/admin/overview', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const sites = await sitesStore.listSites();
    const rows = sites.map((s) => {
      const statsData = readJsonFile(getSiteStatsFile(s.slug), {}) || {};
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
  fs.createReadStream(file).pipe(res);
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
router.get('/api/audit', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const payloadInstance = getPayloadInstance();
    if (!payloadInstance) return res.json([]);
    const out = await payloadInstance.find({
      collection: 'audit_logs',
      sort: '-createdAt',
      limit: 50,
      depth: 0,
      overrideAccess: true,
    });
    res.json(out.docs.map((d) => ({
      action: d.action,
      actor: d.actor,
      target: d.target,
      details: d.details,
      createdAt: d.createdAt,
    })));
  } catch (e) {
    sendError(res, "Impossible de lire le journal d'audit.", e);
  }
});

module.exports = router;
