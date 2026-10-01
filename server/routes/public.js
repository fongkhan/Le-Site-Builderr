// Endpoints appelés par les sites PUBLIÉS (autre origine en production) : formulaire de
// contact et beacon de statistiques. Publics, rate-limités, CORS ouvert route par route
// (aucun cookie/credential impliqué). Lecture des stats : propriétaire ou admin.
const cors = require('cors');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const stats = require('../lib/stats');
const { sendError, createRouter, isHtmlFormPost, sendFormPage } = require('../core/http');
const { logAudit } = require('../core/audit');
const { sendMail } = require('../core/mail');
const { getSiteStatsFile } = require('../core/config');
const { readJsonFile } = require('../services/content');
const { readJsonStrict, writeJsonAtomic } = require('../lib/json-file');
const { getSiteOwners } = require('../services/sites');

const router = createRouter();

// --- Formulaire de contact / prise de rendez-vous (validation stricte + honeypot) ---

// Message d'une demande de rendez-vous, composé ici pour les deux modes d'envoi (JSON
// depuis le script du site, formulaire HTML sans JavaScript).
function composeAppointmentMessage(body) {
  const field = (k) => (typeof body[k] === 'string' ? body[k].trim().slice(0, 200) : '');
  const lines = ['Demande de rendez-vous'];
  if (field('service')) lines.push(`Prestation : ${field('service')}`);
  if (field('slot')) lines.push(`Créneau souhaité : ${field('slot')}`);
  if (field('phone')) lines.push(`Téléphone : ${field('phone')}`);
  const extra = typeof body.message === 'string' ? body.message.trim() : '';
  if (extra) lines.push('', extra);
  return lines.join('\n');
}

router.post('/api/contact/:slug', cors(), async (req, res) => {
  const isHtmlForm = isHtmlFormPost(req);
  const fail = (status, error) => (isHtmlForm
    ? sendFormPage(req, res, status, "Message non envoyé", error)
    : res.status(status).json({ error }));
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return fail(404, "Site inconnu.");

    const body = req.body || {};
    const { name, email, company } = body;
    // Demande de RDV : marquée par le formulaire (champ kind), ou reconnue à ses champs
    const isAppointment = body.kind === 'appointment' || (isHtmlForm && ['service', 'slot', 'phone'].some((k) => typeof body[k] === 'string'));
    const message = isAppointment ? composeAppointmentMessage(body) : body.message;
    const done = () => (isHtmlForm
      ? sendFormPage(req, res, 200, 'Merci !', isAppointment ? 'Votre demande de rendez-vous a bien été envoyée.' : 'Votre message a bien été envoyé.')
      : res.json({ success: true }));

    // Honeypot : un humain ne remplit jamais ce champ caché. On répond un succès sans
    // rien envoyer pour ne pas donner d'indice aux robots.
    if (typeof company === 'string' && company.trim() !== '') return done();

    const isNonEmpty = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (!isNonEmpty(name, 120) || !isNonEmpty(message, 5000) || !isNonEmpty(email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, "Nom, email valide et message sont requis.");
    }

    const recipients = await getSiteOwners(site.slug);
    const subject = `${isAppointment ? '📅 Demande de rendez-vous' : '📬 Nouveau message'} via ${site.name}`;
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
    // Sans l'email du visiteur : le journal d'audit ne stocke pas de données personnelles
    logAudit(req, 'contact.recu', site.slug, isAppointment ? 'demande de rendez-vous' : 'formulaire de contact');
    done();
  } catch (e) {
    if (isHtmlForm) {
      console.error('❌ [Contact] envoi impossible —', (e && e.message) || e);
      return sendFormPage(req, res, 500, 'Message non envoyé', "Impossible d'envoyer le message pour le moment. Réessayez plus tard.");
    }
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
    // autres requêtes (boucle d'évènements mono-thread) → pas de compteur perdu. Un
    // fichier illisible lève une erreur : l'historique n'est jamais écrasé.
    const data = readJsonStrict(file, {}) || {};
    writeJsonAtomic(file, stats.recordHit(data), { pretty: false });
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
