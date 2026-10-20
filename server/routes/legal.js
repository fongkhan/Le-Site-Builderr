// Informations légales d'un site (mentions légales, politique de confidentialité du site
// publié) : lecture et saisie par le propriétaire du site ou un admin. Les autres champs
// du site (chemins, domaine, statut) restent réservés aux admins (PUT /api/sites/:slug).
const auth = require('../auth');
const sitesStore = require('../sites-store');
const { sendError, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const { LEGAL_KEYS, validateLegal, legalView } = require('../lib/legal');
const { SUBMISSION_RETENTION } = require('../lib/submissions');

const router = createRouter();
const siteAccess = [auth.authenticate, auth.requireAuth, auth.requireSiteAccess((req) => req.params.slug)];

// Saisie, hébergeur par défaut du serveur, champs obligatoires manquants et durée de
// conservation des messages (dérivée de la rétention de la boîte de réception).
const viewOf = (legal) => legalView(legal, { env: process.env, retentionDays: SUBMISSION_RETENTION.retentionDays });

router.get('/api/sites/:slug/legal', ...siteAccess, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    res.json(viewOf(site.legal));
  } catch (e) {
    sendError(res, "Impossible de lire les informations légales.", e);
  }
});

// Objet complet : un champ absent est vidé. Publié au prochain déploiement du site.
router.put('/api/sites/:slug/legal', ...siteAccess, async (req, res) => {
  const checked = validateLegal(req.body);
  if (!checked.ok) {
    return res.status(400).json({ error: checked.error, ...(checked.field ? { field: checked.field } : {}) });
  }
  try {
    const site = await sitesStore.updateSite(req.params.slug, { legal: checked.value });
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    // Noms des champs renseignés seulement : jamais les valeurs dans le journal d'audit
    const filled = LEGAL_KEYS.filter((key) => checked.value[key] !== '');
    logAudit(req, 'site.informations-legales', site.slug, `champs=${filled.join(',') || 'aucun'}`);
    res.json({ success: true, ...viewOf(site.legal) });
  } catch (e) {
    sendError(res, "Impossible d'enregistrer les informations légales.", e);
  }
});

module.exports = router;
