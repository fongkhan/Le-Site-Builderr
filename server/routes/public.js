// Endpoints appelés par les sites PUBLIÉS (autre origine en production) : formulaire de
// contact et beacon de statistiques. Publics, rate-limités, CORS ouvert route par route
// (aucun cookie/credential impliqué). Lecture des stats : propriétaire ou admin.
const fs = require('fs');
const cors = require('cors');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const stats = require('../lib/stats');
const { sendError, createRouter } = require('../core/http');
const { logAudit } = require('../core/audit');
const { sendMail } = require('../core/mail');
const { getSiteStatsFile } = require('../core/config');
const { readJsonFile } = require('../services/content');
const { getSiteOwners } = require('../services/sites');

const router = createRouter();

// --- Formulaire de contact (validation stricte + honeypot) ---
router.post('/api/contact/:slug', cors(), async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site inconnu." });

    const { name, email, message, company } = req.body || {};

    // Honeypot : un humain ne remplit jamais ce champ caché. On répond 200 sans
    // rien envoyer pour ne pas donner d'indice aux robots.
    if (typeof company === 'string' && company.trim() !== '') {
      return res.json({ success: true });
    }

    const isNonEmpty = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (!isNonEmpty(name, 120) || !isNonEmpty(message, 5000) || !isNonEmpty(email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Nom, email valide et message sont requis." });
    }

    const recipients = await getSiteOwners(site.slug);
    const subject = `📬 Nouveau message via ${site.name}`;
    const text =
      `Nouveau message reçu depuis le site « ${site.name} » (${site.domain}) :\n\n` +
      `Nom : ${name.trim()}\nEmail : ${email.trim()}\n\n${message.trim()}\n\n` +
      `— Envoyé par le formulaire de contact Meta-Builder`;

    if (recipients.length > 0) {
      try {
        // Répondre au mail répond directement au visiteur
        await sendMail(recipients, subject, text, { replyTo: email.trim() });
      } catch (mailErr) {
        // Le message n'est jamais perdu : il reste dans les logs du serveur
        console.log(`📬 [Contact] Message pour « ${site.slug} » non distribué par email :\n${text}`);
        throw mailErr;
      }
    } else {
      // Aucun compte rattaché : ne pas perdre le message pour autant
      console.log(`📬 [Contact] Message pour « ${site.slug} » (aucun propriétaire rattaché) :\n${text}`);
    }
    logAudit(req, 'contact.recu', site.slug, `de=${email.trim()}`);
    res.json({ success: true });
  } catch (e) {
    sendError(res, "Impossible d'envoyer le message pour le moment.", e);
  }
});

// --- Statistiques de visites (anonymes, sans cookie ni IP stockée) ---

// Beacon : appelé par le site publié à chaque page vue. Volontairement silencieux : on
// ne renvoie jamais d'erreur qui pourrait casser la page, et on ne stocke qu'un compteur
// agrégé par jour.
router.post('/api/stats/hit/:slug', cors(), async (req, res) => {
  // Répond 204 quoi qu'il arrive : le beacon ne doit jamais perturber le site.
  res.status(204).end();
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return; // slug inconnu → on ignore silencieusement
    // On construit le chemin depuis le slug canonique stocké, jamais depuis l'entrée brute.
    const file = getSiteStatsFile(site.slug);
    // Lecture + écriture synchrones, sans await entre les deux : atomique vis-à-vis des
    // autres requêtes (boucle d'évènements mono-thread) → pas de compteur perdu.
    const data = readJsonFile(file, {}) || {};
    fs.writeFileSync(file, JSON.stringify(stats.recordHit(data)), 'utf-8');
  } catch (e) {
    // Jamais d'exception remontée : le status a déjà été envoyé.
    console.error('⚠️ [Stats] hit ignoré —', (e && e.message) || e);
  }
});

// Lecture des stats d'un site : réservée au propriétaire du site (ou admin).
router.get('/api/sites/:slug/stats', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.params.slug), async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    const data = readJsonFile(getSiteStatsFile(site.slug), {}) || {};
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 90);
    res.json({
      total: stats.total(data),
      days: stats.lastNDays(data, days),
    });
  } catch (e) {
    sendError(res, "Impossible de lire les statistiques du site.", e);
  }
});

module.exports = router;
