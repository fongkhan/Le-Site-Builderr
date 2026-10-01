// Domaine personnalisé (ADMIN only) : rattacher le vrai nom de domaine d'un client.
// Preuve de propriété par enregistrement TXT, puis création du domaine additionnel côté
// cPanel (AutoSSL prend le relais pour le certificat). Fonctionne aussi en simulation.
const dns = require('dns').promises;
const auth = require('../auth');
const sitesStore = require('../sites-store');
const hosting = require('../core/hosting');
const domains = require('../lib/domains');
const { sendError, limiters, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const { resolveSiteDomain, initialSslStatus } = require('../services/sites');

const router = createRouter();
const adminOnly = [limiters.domain, auth.authenticate, auth.requireAdmin];

// 1) Saisie : valide le domaine, génère le jeton TXT à publier, passe en 'pending'.
router.post('/api/sites/:slug/custom-domain', ...adminOnly, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const domain = domains.normalizeDomain(req.body && req.body.domain);
    if (!domains.isValidDomain(domain, { rootDomain: process.env.CPANEL_ROOT_DOMAIN })) {
      return res.status(400).json({ error: "Nom de domaine invalide. Saisissez un domaine public (ex. mon-commerce.fr)." });
    }
    // Un domaine ne sert qu'un seul site (sinon activation ou détachement sur le mauvais site)
    const owner = (await sitesStore.listSites()).find((s) => s.slug !== site.slug && (s.customDomain === domain || s.domain === domain));
    if (owner) {
      return res.status(409).json({ error: "Ce domaine est déjà rattaché à un autre site." });
    }

    // Réutilise le jeton si on reconfigure le même domaine, sinon en génère un nouveau.
    const token = (site.customDomain === domain && site.domainVerifyToken)
      ? site.domainVerifyToken
      : domains.makeVerifyToken();
    await sitesStore.updateSite(site.slug, { customDomain: domain, domainVerifyToken: token, domainStatus: 'pending' });
    logAudit(req, 'site.domaine.saisie', site.slug, domain);

    res.json({
      customDomain: domain,
      domainStatus: 'pending',
      record: { type: 'TXT', host: domains.verifyRecordHost(domain), value: token },
      pointingHint: `Faites aussi pointer ${domain} vers o2switch (enregistrement A vers l'IP du serveur, ou les serveurs DNS o2switch) pour que le site soit servi et que le certificat SSL soit émis.`,
    });
  } catch (e) {
    sendError(res, "Impossible d'enregistrer le domaine personnalisé.", e);
  }
});

// 2) Vérification + activation : contrôle le TXT, crée le domaine additionnel, bascule le domaine servi.
router.post('/api/sites/:slug/custom-domain/verify', ...adminOnly, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    if (!site.customDomain || !site.domainVerifyToken) {
      return res.status(400).json({ error: "Aucun domaine personnalisé à vérifier. Enregistrez d'abord le domaine." });
    }

    // Résolution TXT — jamais de 500 si l'enregistrement est absent (NXDOMAIN, propagation…).
    let records = [];
    try {
      records = await dns.resolveTxt(domains.verifyRecordHost(site.customDomain));
    } catch {
      records = [];
    }
    if (!domains.verifyTxtRecords(records, site.domainVerifyToken)) {
      return res.json({
        verified: false,
        domainStatus: site.domainStatus,
        message: "Enregistrement TXT introuvable ou incorrect. La propagation DNS peut prendre quelques minutes.",
      });
    }

    // Propriété prouvée → création du domaine additionnel (idempotent).
    try {
      await hosting.ensureCustomDomain(site.customDomain, site.slug);
    } catch (e) {
      await sitesStore.updateSite(site.slug, { domainStatus: 'error' });
      return sendError(res, "Domaine vérifié, mais son rattachement à l'hébergement a échoué.", e, 502);
    }

    // Statut SSL courant (best-effort — AutoSSL peut ne pas avoir encore émis le certificat).
    let sslStatus = initialSslStatus();
    try { sslStatus = await hosting.getSslStatus(site.customDomain); } catch { /* AutoSSL pas encore émis */ }

    // Le domaine client devient le domaine servi.
    await sitesStore.updateSite(site.slug, { domain: site.customDomain, domainStatus: 'active', sslStatus });
    logAudit(req, 'site.domaine.active', site.slug, site.customDomain);

    res.json({ verified: true, domainStatus: 'active', domain: site.customDomain, sslStatus });
  } catch (e) {
    sendError(res, "Impossible de vérifier le domaine personnalisé.", e);
  }
});

// 3) Détachement : retire le domaine additionnel (best-effort) et rebascule sur le sous-domaine.
router.delete('/api/sites/:slug/custom-domain', ...adminOnly, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    // Rien à détacher : le domaine servi actuel est conservé tel quel
    if (!site.customDomain) {
      return res.json({ success: true, domain: site.domain, domainStatus: site.domainStatus || 'none' });
    }

    try {
      await hosting.removeCustomDomain(site.customDomain);
    } catch (e) {
      console.error('⚠️ [Domaine] Retrait cPanel best-effort échoué —', (e && e.message) || e);
    }
    // Rebascule le domaine servi sur le sous-domaine généré.
    const subdomain = await resolveSiteDomain(site.slug);
    await sitesStore.updateSite(site.slug, {
      customDomain: '', domainVerifyToken: '', domainStatus: 'none', domain: subdomain,
    });
    logAudit(req, 'site.domaine.detache', site.slug, site.customDomain);

    res.json({ success: true, domain: subdomain, domainStatus: 'none' });
  } catch (e) {
    sendError(res, "Impossible de détacher le domaine personnalisé.", e);
  }
});

module.exports = router;
