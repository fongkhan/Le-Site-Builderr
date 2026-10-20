// Panneau Système (admin) : état du serveur et nettoyage des données orphelines.
const auth = require('../auth');
const { sendError, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const { getPayloadInstance } = require('../core/payload');
const system = require('../services/system');

const router = createRouter();

// Version, disque, dossiers, build, sauvegardes, données orphelines (sans chemin absolu).
router.get('/api/admin/system', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await system.collectSystemInfo());
  } catch (e) {
    sendError(res, "Impossible de lire l'état du système.", e);
  }
});

// Nettoyage des données orphelines. Corps : { categories: [...], names?: [...] } — des
// catégories et des noms seulement, l'inventaire est recalculé côté serveur.
router.post('/api/admin/system/orphans/purge', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { categories, names } = req.body || {};
  if (!Array.isArray(categories) || categories.length === 0 || categories.some((c) => !system.PURGE_CATEGORIES.includes(c))) {
    return res.status(400).json({ error: 'Catégories de nettoyage invalides.' });
  }
  if (names !== undefined && (!Array.isArray(names) || names.some((n) => typeof n !== 'string' || n.length > 300))) {
    return res.status(400).json({ error: "Liste d'éléments à nettoyer invalide." });
  }
  // Sans base, la liste des sites (repli JSON) peut être périmée : un site existant serait
  // pris pour un site supprimé
  if (!getPayloadInstance()) {
    return res.status(503).json({ error: 'Nettoyage indisponible sans base de données : la liste des sites ne peut pas être vérifiée.' });
  }
  try {
    const result = await system.purgeOrphans({ categories, names });
    const { dataFiles, releases, drafts, repositories } = result.removed;
    logAudit(req, 'maintenance.purge', 'orphelins', `dataFiles=${dataFiles.length} releases=${releases.length} drafts=${drafts.length} repositories=${repositories.length} octets=${result.bytes}`);
    res.json({ success: true, ...result });
  } catch (e) {
    sendError(res, 'Impossible de nettoyer les données orphelines.', e);
  }
});

module.exports = router;
