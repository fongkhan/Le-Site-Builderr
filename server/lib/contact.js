// Formulaire de contact des sites publiés : validation des champs, codes d'erreur stables
// et textes des pages de réponse (envoi sans JavaScript) par langue. Fonctions pures.
const { normalizeLocale } = require('./i18n');

// Codes renvoyés dans le JSON d'erreur (`code`) : le script du site traduit selon le
// code, jamais selon le texte (toujours en français).
const CONTACT_ERROR_CODES = ['unknown_site', 'invalid_fields', 'invalid_body', 'too_large', 'rate_limited', 'send_failed'];
const CONTACT_FIELDS = ['name', 'email', 'message'];
const CONTACT_LIMITS = { name: 120, email: 200, message: 5000 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value) => typeof value === 'string' && EMAIL_RE.test(value);

// Champs refusés, dans l'ordre de CONTACT_FIELDS : texte non vide (après trim), borné,
// email plausible.
function invalidContactFields({ name, email, message } = {}) {
  const isNonEmpty = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const invalid = [];
  if (!isNonEmpty(name, CONTACT_LIMITS.name)) invalid.push('name');
  if (!isNonEmpty(email, CONTACT_LIMITS.email) || !isValidEmail(email)) invalid.push('email');
  if (!isNonEmpty(message, CONTACT_LIMITS.message)) invalid.push('message');
  return invalid;
}

// Langue de la page de réponse (?lang= posé par le formulaire) : langue connue, sinon fr.
function contactLang(raw) {
  return typeof raw === 'string' ? normalizeLocale(raw) : normalizeLocale(undefined);
}

const CONTACT_PAGES = {
  fr: {
    unknown_site: { title: 'Message non envoyé', text: 'Site inconnu.' },
    invalid_fields: { title: 'Message non envoyé', text: 'Nom, email valide et message sont requis.' },
    invalid_body: { title: 'Message non envoyé', text: 'Formulaire invalide.' },
    too_large: { title: 'Message non envoyé', text: 'Votre message est trop long.' },
    rate_limited: { title: 'Message non envoyé', text: 'Trop de messages envoyés. Réessayez dans quelques minutes.' },
    send_failed: { title: 'Message non envoyé', text: "Impossible d'envoyer le message pour le moment. Réessayez plus tard." },
    sent: { title: 'Merci !', text: 'Votre message a bien été envoyé.' },
    sent_appointment: { title: 'Merci !', text: 'Votre demande de rendez-vous a bien été envoyée.' },
    back: '← Revenir au site',
  },
  en: {
    unknown_site: { title: 'Message not sent', text: 'Unknown site.' },
    invalid_fields: { title: 'Message not sent', text: 'Name, a valid email address and a message are required.' },
    invalid_body: { title: 'Message not sent', text: 'Invalid form.' },
    too_large: { title: 'Message not sent', text: 'Your message is too long.' },
    rate_limited: { title: 'Message not sent', text: 'Too many messages sent. Please try again in a few minutes.' },
    send_failed: { title: 'Message not sent', text: 'Unable to send the message right now. Please try again later.' },
    sent: { title: 'Thank you!', text: 'Your message has been sent.' },
    sent_appointment: { title: 'Thank you!', text: 'Your appointment request has been sent.' },
    back: '← Back to the site',
  },
};

// Page de réponse `key` (code d'erreur, sent, sent_appointment) dans la langue demandée.
// Clé inconnue : erreur générique d'envoi.
function contactPage(key, lang) {
  const dict = CONTACT_PAGES[contactLang(lang)];
  const entry = key !== 'back' && Object.hasOwn(dict, key) ? dict[key] : dict.send_failed;
  return { title: entry.title, text: entry.text, back: dict.back };
}

// Corps JSON d'une erreur : texte français (compatibilité), code stable et, pour une
// saisie refusée, la liste des champs en cause.
function contactErrorBody(code, fields) {
  const known = CONTACT_ERROR_CODES.includes(code) ? code : 'send_failed';
  return {
    error: CONTACT_PAGES.fr[known].text,
    code: known,
    ...(Array.isArray(fields) && fields.length ? { fields } : {}),
  };
}

module.exports = {
  CONTACT_ERROR_CODES,
  CONTACT_FIELDS,
  CONTACT_LIMITS,
  CONTACT_PAGES,
  isValidEmail,
  invalidContactFields,
  contactLang,
  contactPage,
  contactErrorBody,
};
