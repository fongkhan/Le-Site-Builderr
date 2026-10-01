// Configuration du compte et fonctionnalités IA : assistant de rédaction du CMS et
// onboarding (création d'un site complet depuis une description).
const express = require('express');
const path = require('path');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const aiQuota = require('../ai-quota');
const plans = require('../lib/plans');
const { runOnboard, runAssist } = require('../ai');
const { generateSlug } = require('../lib/paths');
const { sendError } = require('../core/http');
const { logAudit } = require('../core/audit');
const { getPayloadInstance } = require('../core/payload');
const { REPOSITORIES_DIR, getSitePagesFile, getSiteThemeFile } = require('../core/config');
const { DEFAULT_PAGES, DEFAULT_THEME } = require('../services/defaults');
const { writeJsonFile } = require('../services/content');
const {
  toPosixPath,
  defaultDocumentRoot,
  resolveSiteDomain,
  initialSslStatus,
  provisionRepository,
  uniqueSlug,
  attachSiteToUser,
} = require('../services/sites');

const router = express.Router();

const ASSIST_ACTIONS = ['rewrite', 'generate-description', 'seo', 'article'];

// Réponse 429 commune quand le quota IA journalier est épuisé.
function sendQuotaExceeded(res, quota) {
  return res.status(429).json({
    error: `Quota IA journalier atteint (${quota.used}/${quota.limit}). Réinitialisation à minuit.`,
    quota
  });
}

// Configuration et clés disponibles (booléens uniquement, jamais les clés elles-mêmes)
router.get('/api/config', auth.authenticate, auth.requireAuth, (req, res) => {
  const limits = plans.limitsFor(req.user, { isAdmin: auth.isAdmin(req.user) });
  res.json({
    availableProviders: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY
    },
    defaultProvider: process.env.DEFAULT_PROVIDER || 'openai',
    devNoAuth: auth.DEV_NO_AUTH,
    // null = illimité (admin) ; sinon { limit, used, remaining }
    aiQuota: aiQuota.getQuota(req.user),
    // Offre du compte : null = sans limite (admin). Sinon { plan, label, maxSites, aiDailyQuota }
    // + le nombre de sites déjà utilisés, pour l'affichage.
    plan: limits ? { ...limits, sitesUsed: (req.userSiteSlugs || new Set()).size } : null
  });
});

// Assistant de rédaction pour le CMS (améliorer un texte, générer une description,
// proposer des meta SEO, rédiger un article). Auth + ownership du site + quota IA.
router.post('/api/ai/assist', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.body && req.body.site), async (req, res) => {
  const { action, input, context, provider } = req.body || {};
  if (!ASSIST_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "Action d'assistance invalide." });
  }

  const reservation = await aiQuota.reserveSlot(req.user);
  if (!reservation.ok) return sendQuotaExceeded(res, reservation.quota);

  try {
    res.json(await runAssist(provider, { action, input, context }));
  } catch (error) {
    // Échec IA (clé absente, appel raté…) : on libère le créneau (jamais décompté sur échec)
    await aiQuota.releaseSlot(req.user.id);
    return sendError(res, "L'assistant IA n'a pas pu répondre.", error);
  }
});

// Stack déduite de la qualification IA.
function stackFromQualification(qualification) {
  const needs = qualification.stack_requirements;
  if (needs.need_medusajs) return "Astro Hybride + Payload + Medusa";
  if (needs.need_payload) return "Astro SSG + Payload CMS";
  return "Astro SSG";
}

// Assistant d'Onboarding (Routage Stack, Ébauche & Thème) — accessible aux admins ET aux clients :
// le site créé est automatiquement rattaché au compte de l'utilisateur connecté.
router.post('/api/onboard', auth.authenticate, auth.requireAuth, async (req, res) => {
  const { name, description, features, ambiance, image, inspirationUrl, provider } = req.body;
  if (!description) {
    return res.status(400).json({ error: "La description est requise." });
  }

  // Offre du compte : nombre de sites borné (les admins ne sont jamais limités).
  // Vérifié AVANT de consommer un créneau IA, pour ne pas facturer un refus.
  const siteQuota = plans.canCreateSite(req.user, (req.userSiteSlugs || new Set()).size, { isAdmin: auth.isAdmin(req.user) });
  if (!siteQuota.allowed) {
    return res.status(403).json({ error: siteQuota.reason });
  }

  // Quota IA : on RÉSERVE un créneau AVANT l'appel (incrément atomique sérialisé) pour
  // fermer la fenêtre TOCTOU où deux requêtes concurrentes passaient toutes deux la vérif.
  // Les admins/dev sont illimités (reservation.ok=true, quota=null, aucune écriture).
  const reservation = await aiQuota.reserveSlot(req.user);
  if (!reservation.ok) return sendQuotaExceeded(res, reservation.quota);

  let result;
  try {
    result = await runOnboard(provider, { name, description, features, ambiance, image, inspirationUrl });
  } catch (error) {
    // L'appel IA a échoué : on libère le créneau réservé (jamais décompté sur échec)
    await aiQuota.releaseSlot(req.user.id);
    return sendError(res, "Échec de la génération du site par IA.", error);
  }

  try {
    // L'IA a réussi : le créneau réservé reste consommé.

    // Slug validé (jamais vide → jamais de documentRoot partagé) et unique
    const siteName = name || result.qualification.site_name || "Nouveau Site";
    const finalSlug = await uniqueSlug(generateSlug(siteName) || generateSlug(result.qualification.site_name || '') || 'site');

    const newSite = await sitesStore.createSite({
      slug: finalSlug,
      name: siteName,
      domain: await resolveSiteDomain(finalSlug),
      documentRoot: defaultDocumentRoot(finalSlug),
      repositoryPath: toPosixPath(path.join(REPOSITORIES_DIR, finalSlug)),
      stack: stackFromQualification(result.qualification),
      createdWithTool: true,
      status: "draft",
      sslStatus: initialSslStatus()
    });

    provisionRepository(newSite.repositoryPath);

    // Pages et thème générés pour ce site (theme.css n'est pas écrit ici : fichier
    // global, régénéré au build depuis le fichier de thème du site).
    writeJsonFile(getSitePagesFile(finalSlug), result.pages && result.pages.docs ? result.pages : DEFAULT_PAGES);
    writeJsonFile(getSiteThemeFile(finalSlug), { theme: result.theme || DEFAULT_THEME.theme });

    // Référence le site dans Payload et le rattache au compte du client créateur
    if (getPayloadInstance()) {
      try {
        const siteDoc = await sitesStore.getOrCreatePayloadDoc(finalSlug);
        if (req.user && !req.user.devMode && !auth.isAdmin(req.user)) {
          await attachSiteToUser(req.user.id, siteDoc.id);
        }
      } catch (dbError) {
        console.error("Erreur de rattachement du site au compte :", dbError.message);
      }
    }

    logAudit(req, 'site.creation-ia', finalSlug, `nom=${siteName}`);
    res.json({
      qualification: result.qualification,
      pages: result.pages || DEFAULT_PAGES,
      theme: result.theme || DEFAULT_THEME.theme,
      site: newSite
    });
  } catch (error) {
    sendError(res, "Échec de la génération du site par IA.", error);
  }
});

module.exports = router;
