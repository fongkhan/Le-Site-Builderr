// CMS : pages, articles de blog et thème d'un site. Le paramètre ?site= est obligatoire
// et l'accès est vérifié par ownership (admin ou propriétaire du site).
const express = require('express');
const auth = require('../auth');
const { generateSlug } = require('../lib/paths');
const { validateTheme } = require('../lib/theme');
const { sendError } = require('../core/http');
const { logAudit } = require('../core/audit');
const content = require('../services/content');

const router = express.Router();
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
  await content.saveSitePages(req.query.site, req.body);
  res.json({ success: true, message: "Pages enregistrées avec succès !" });
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
  // Le slug de l'article est dérivé/validé (jamais vide, URL-safe) — sinon dérivé du titre.
  const postSlug = generateSlug(body.slug) || generateSlug(title);
  if (!postSlug) return res.status(400).json({ error: "Titre invalide : impossible d'en dériver une adresse." });

  try {
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
  res.json(await content.readSiteTheme(req.query.site));
});

router.post('/api/theme', ...siteAccess, async (req, res) => {
  const themeData = req.body;

  // Valider avant toute écriture : les valeurs finissent interpolées dans theme.css
  // (injection CSS possible) et une police hors-liste casse le rendu du site généré.
  const validation = validateTheme(themeData && themeData.theme);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  await content.saveSiteTheme(req.query.site, themeData);
  res.json({ success: true, message: "Thème mis à jour avec succès !" });
});

module.exports = router;
