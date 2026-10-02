// CMS : pages, articles de blog et thème d'un site (paramètre ?site= obligatoire), et
// messages reçus (/api/sites/:slug/submissions). L'accès est vérifié par ownership
// (admin ou propriétaire du site).
const auth = require('../auth');
const { generateSlug } = require('../lib/paths');
const { validateTheme } = require('../lib/theme');
const { sendError, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const content = require('../services/content');
const submissions = require('../services/submissions');
const sitesStore = require('../sites-store');

const router = createRouter();
const siteAccess = [auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site)];

// --- Pages ---

router.get('/api/site-pages', ...siteAccess, async (req, res) => {
  try {
    res.json(await content.readSitePages(req.query.site));
  } catch (e) {
    sendError(res, "Impossible de lire les pages du site.", e);
  }
});

router.post('/api/site-pages', ...siteAccess, async (req, res) => {
  const invalid = content.validatePagesBody(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    await content.saveSitePages(req.query.site, req.body);
    res.json({ success: true, message: "Pages enregistrées avec succès !" });
  } catch (e) {
    sendError(res, "Impossible d'enregistrer les pages.", e);
  }
});

// --- Blog / actualités ---

// Liste des articles (brouillons + publiés) pour la gestion dans le CMS.
router.get('/api/site-posts', ...siteAccess, async (req, res) => {
  try {
    res.json(await content.readSitePosts(req.query.site));
  } catch (e) {
    sendError(res, "Impossible de lire les articles du site.", e);
  }
});

// Crée ou met à jour un article (identifié par son slug au sein du site).
router.post('/api/site-posts', ...siteAccess, async (req, res) => {
  const siteSlug = req.query.site;
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return res.status(400).json({ error: "Le titre de l'article est requis." });
  // Slug fourni = mise à jour de cet article. Sinon (nouvel article), slug dérivé du titre
  // et rendu unique : un titre déjà utilisé n'écrase jamais l'article existant.
  const explicitSlug = generateSlug(body.slug);
  const derivedSlug = generateSlug(title);
  if (!explicitSlug && !derivedSlug) return res.status(400).json({ error: "Titre invalide : impossible d'en dériver une adresse." });

  try {
    let postSlug = explicitSlug;
    if (!postSlug) {
      const taken = new Set((await content.readSitePosts(siteSlug)).docs.map((p) => p.slug));
      postSlug = derivedSlug;
      for (let n = 2; taken.has(postSlug); n++) postSlug = `${derivedSlug}-${n}`;
    }
    await content.upsertPost(siteSlug, content.normalizePost({ ...body, title, slug: postSlug }));
    logAudit(req, 'article.enregistrement', siteSlug, postSlug);
    res.json({ success: true, slug: postSlug });
  } catch (e) {
    sendError(res, "Impossible d'enregistrer l'article.", e);
  }
});

// Supprime un article par slug.
router.delete('/api/site-posts', ...siteAccess, async (req, res) => {
  const siteSlug = req.query.site;
  const postSlug = generateSlug(req.query.slug);
  if (!postSlug) return res.status(400).json({ error: "Article invalide." });
  try {
    await content.deletePost(siteSlug, postSlug);
    logAudit(req, 'article.suppression', siteSlug, postSlug);
    res.json({ success: true });
  } catch (e) {
    sendError(res, "Impossible de supprimer l'article.", e);
  }
});

// --- Thème ---

router.get('/api/theme', ...siteAccess, async (req, res) => {
  try {
    res.json(await content.readSiteTheme(req.query.site));
  } catch (e) {
    sendError(res, "Impossible de lire le thème du site.", e);
  }
});

router.post('/api/theme', ...siteAccess, async (req, res) => {
  const themeData = req.body;

  // Valider avant toute écriture : les valeurs finissent interpolées dans theme.css
  // (injection CSS possible) et une police hors-liste casse le rendu du site généré.
  const validation = validateTheme(themeData && themeData.theme);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    // Seul le thème validé est persisté (pas d'autres clés arbitraires du corps)
    await content.saveSiteTheme(req.query.site, { theme: themeData.theme });
    res.json({ success: true, message: "Thème mis à jour avec succès !" });
  } catch (e) {
    sendError(res, "Impossible d'enregistrer le thème.", e);
  }
});

// --- Messages reçus (boîte de réception des formulaires du site) ---
// Lecture, marquage et suppression par le propriétaire du site (ou un admin). Aucune
// trace dans le journal d'audit : il ne doit pas contenir de données personnelles.

const inboxAccess = [auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.params.slug)];

router.get('/api/sites/:slug/submissions', ...inboxAccess, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    const items = await submissions.listSubmissions(site.slug);
    res.json({ items, unread: items.filter((s) => !s.read).length });
  } catch (e) {
    sendError(res, "Impossible de lire les messages du site.", e);
  }
});

router.patch('/api/sites/:slug/submissions/:id', ...inboxAccess, async (req, res) => {
  const read = req.body && req.body.read;
  if (typeof read !== 'boolean') return res.status(400).json({ error: "Le champ « read » (booléen) est requis." });
  if (!submissions.isValidSubmissionId(req.params.id)) return res.status(400).json({ error: "Message invalide." });
  try {
    const updated = await submissions.markSubmissionRead(req.params.slug, req.params.id, read);
    if (!updated) return res.status(404).json({ error: "Message introuvable." });
    res.json(updated);
  } catch (e) {
    sendError(res, "Impossible de mettre à jour le message.", e);
  }
});

router.delete('/api/sites/:slug/submissions/:id', ...inboxAccess, async (req, res) => {
  if (!submissions.isValidSubmissionId(req.params.id)) return res.status(400).json({ error: "Message invalide." });
  try {
    const removed = await submissions.removeSubmission(req.params.slug, req.params.id);
    if (!removed) return res.status(404).json({ error: "Message introuvable." });
    res.json({ success: true });
  } catch (e) {
    sendError(res, "Impossible de supprimer le message.", e);
  }
});

module.exports = router;
