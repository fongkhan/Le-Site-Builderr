// Endpoints appelés par les sites PUBLIÉS (autre origine en production) : formulaire de
// contact et beacon de statistiques. Publics, rate-limités, CORS ouvert route par route
// (aucun cookie/credential impliqué). Lecture des stats : propriétaire ou admin.
const cors = require('cors');
const auth = require('../auth');
const sitesStore = require('../sites-store');
const stats = require('../lib/stats');
const { sendError, createRouter, isHtmlFormPost, sendContactFormPage } = require('../core/http');
const { invalidContactFields, contactErrorBody } = require('../lib/contact');
const { logAudit } = require('../core/audit');
const { sendMail } = require('../core/mail');
const { getSiteStatsFile } = require('../core/config');
const { readJsonFile } = require('../services/content');
const { readJsonStrict, writeJsonAtomic } = require('../lib/json-file');
const { getSiteOwners } = require('../services/sites');
const { saveSubmission } = require('../services/submissions');

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

// Email aux propriétaires du site. Renvoie false sans propriétaire rattaché (rien
// d'envoyé) ; un échec d'envoi est remonté à l'appelant. Le contenu du message n'est
// jamais écrit dans les logs du serveur, qui échappent à la rétention de 12 mois annoncée
// par la politique de confidentialité des sites : seule la boîte de réception le garde.
async function notifySiteOwners(site, { name, email, message, isAppointment }) {
  const recipients = await getSiteOwners(site.slug);
  if (recipients.length === 0) return false;
  const subject = `${isAppointment ? '📅 Demande de rendez-vous' : '📬 Nouveau message'} via ${site.name}`;
  const text =
    `Nouveau message reçu depuis le site « ${site.name} » (${site.domain}) :\n\n` +
    `Nom : ${name.trim()}\nEmail : ${email.trim()}\n\n${message.trim()}\n\n` +
    `— Envoyé par le formulaire de contact Meta-Builder`;
  // Répondre au mail répond directement au visiteur
  await sendMail(recipients, subject, text, { replyTo: email.trim() });
  return true;
}

// Erreurs : code stable (lib/contact.js) dans le JSON, traduit par le script du site ;
// page HTML dans la langue du formulaire (?lang=) pour un envoi sans JavaScript.
router.post('/api/contact/:slug', cors(), async (req, res) => {
  const isHtmlForm = isHtmlFormPost(req);
  const fail = (status, code, fields) => (isHtmlForm
    ? sendContactFormPage(req, res, status, code)
    : res.status(status).json(contactErrorBody(code, fields)));
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return fail(404, 'unknown_site');

    const body = req.body || {};
    const { name, email, company } = body;
    // Demande de RDV : marquée par le formulaire (champ kind), ou reconnue à ses champs
    const isAppointment = body.kind === 'appointment' || (isHtmlForm && ['service', 'slot', 'phone'].some((k) => typeof body[k] === 'string'));
    const message = isAppointment ? composeAppointmentMessage(body) : body.message;
    const done = () => (isHtmlForm
      ? sendContactFormPage(req, res, 200, isAppointment ? 'sent_appointment' : 'sent')
      : res.json({ success: true }));

    // Honeypot : un humain ne remplit jamais ce champ caché. On répond un succès sans
    // rien envoyer pour ne pas donner d'indice aux robots.
    if (typeof company === 'string' && company.trim() !== '') return done();

    const invalid = invalidContactFields({ name, email, message });
    if (invalid.length > 0) return fail(400, 'invalid_fields', invalid);

    // Boîte de réception : enregistré avant l'email. Si l'un des deux aboutit, le
    // visiteur reçoit un succès ; seul l'échec des deux lui est signalé.
    let stored = false;
    try {
      await saveSubmission(site.slug, {
        kind: isAppointment ? 'appointment' : 'contact',
        name,
        email,
        phone: isAppointment ? body.phone : '',
        message,
      });
      stored = true;
    } catch (storeErr) {
      console.error(`❌ [Contact] Message pour « ${site.slug} » non enregistré —`, (storeErr && storeErr.message) || storeErr);
    }

    let noOwner = false;
    try {
      noOwner = !(await notifySiteOwners(site, { name, email, message, isAppointment }));
    } catch (mailErr) {
      if (!stored) throw mailErr;
      console.error(`❌ [Contact] Email pour « ${site.slug} » non envoyé (message conservé dans la boîte de réception) —`, (mailErr && mailErr.message) || mailErr);
    }
    if (noOwner) {
      // Aucun propriétaire rattaché : message conservé dans la seule boîte de réception
      // (journal : site et heure uniquement, jamais le contenu)
      if (!stored) throw new Error(`message pour « ${site.slug} » ni enregistré ni envoyé (aucun propriétaire rattaché)`);
      console.log(`📬 [Contact] Message pour « ${site.slug} » reçu le ${new Date().toISOString()} (aucun propriétaire rattaché) : conservé dans la boîte de réception.`);
    }
    // Sans l'email du visiteur : le journal d'audit ne stocke pas de données personnelles
    logAudit(req, 'contact.recu', site.slug, isAppointment ? 'demande de rendez-vous' : 'formulaire de contact');
    done();
  } catch (e) {
    // Détail dans les logs du serveur, jamais dans la réponse
    console.error('❌ [Contact] envoi impossible —', (e && (e.stack || e.message)) || e);
    if (!res.headersSent) fail(500, 'send_failed');
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
