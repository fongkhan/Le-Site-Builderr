// Médiathèque d'un site (/api/sites/:slug/media) : liste avec usages, texte alternatif,
// suppression contrôlée. Accès : admin ou propriétaire du site. Le téléversement reste
// servi par Payload (POST /api/media, ownership vérifié à la création).
const auth = require('../auth');
const { sendError, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const { cleanAlt, isPayloadMediaId, usageMessage } = require('../lib/media-library');
const mediaService = require('../services/media');
const sitesStore = require('../sites-store');

const router = createRouter();
const mediaAccess = [auth.authenticate, auth.requireAuth, auth.requireSiteAccess((req) => req.params.slug)];

router.get('/api/sites/:slug/media', ...mediaAccess, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    res.json({ items: await mediaService.listSiteMedia(site.slug) });
  } catch (e) {
    sendError(res, "Impossible de lire la médiathèque du site.", e);
  }
});

router.patch('/api/sites/:slug/media/:id', ...mediaAccess, async (req, res) => {
  if (!isPayloadMediaId(req.params.id)) return res.status(400).json({ error: "Image invalide." });
  const alt = cleanAlt(req.body && req.body.alt);
  if (alt === null) return res.status(400).json({ error: "Le texte alternatif doit être une chaîne de caractères." });
  try {
    const item = await mediaService.updateSiteMediaAlt(req.params.slug, req.params.id, alt);
    if (!item) return res.status(404).json({ error: "Image introuvable." });
    res.json(item);
  } catch (e) {
    sendError(res, "Impossible d'enregistrer le texte alternatif.", e);
  }
});

router.delete('/api/sites/:slug/media/:id', ...mediaAccess, async (req, res) => {
  if (!isPayloadMediaId(req.params.id)) return res.status(400).json({ error: "Image invalide." });
  try {
    const result = await mediaService.deleteSiteMedia(req.params.slug, req.params.id);
    if (result.status === 'not_found') return res.status(404).json({ error: "Image introuvable." });
    if (result.status === 'in_use') return res.status(409).json({ error: usageMessage(result.usedIn), usedIn: result.usedIn });
    logAudit(req, 'media.suppression', req.params.slug, `fichier=${result.filename}`);
    res.json({ success: true });
  } catch (e) {
    sendError(res, "Impossible de supprimer l'image.", e);
  }
});

module.exports = router;
