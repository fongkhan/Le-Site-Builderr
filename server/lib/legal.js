// Informations légales d'un site publié (mentions légales, politique de confidentialité) :
// champs, validation de la saisie, hébergeur par défaut (LEGAL_HOST_*) et données
// transmises au build (PUBLIC_LEGAL_JSON). Fonctions pures, sans dépendance au serveur.
// Mêmes clés, longueurs et champs obligatoires que client-template/src/lib/legal.mjs
// (test de parité).
const { isValidEmail } = require('./contact');

const LEGAL_FIELDS = [
  { key: 'companyName', label: "Raison sociale ou nom de l'éditeur", max: 200, required: true },
  { key: 'legalForm', label: 'Forme juridique et capital', max: 200 },
  { key: 'address', label: 'Adresse du siège', max: 400, required: true, multiline: true },
  { key: 'registration', label: 'Immatriculation (SIREN, RCS ou RM)', max: 200 },
  { key: 'vatNumber', label: 'N° de TVA intracommunautaire', max: 40 },
  { key: 'phone', label: 'Téléphone', max: 40, required: true, phone: true },
  { key: 'email', label: 'Email de contact', max: 200, required: true, email: true },
  { key: 'publisherName', label: 'Directeur ou directrice de la publication', max: 200, required: true },
  { key: 'hostName', label: 'Hébergeur', max: 200, required: true },
  { key: 'hostAddress', label: "Adresse de l'hébergeur", max: 400, required: true, multiline: true },
  { key: 'hostPhone', label: "Téléphone de l'hébergeur", max: 40, required: true, phone: true },
];
const LEGAL_KEYS = LEGAL_FIELDS.map((f) => f.key);
const REQUIRED_LEGAL_FIELDS = LEGAL_FIELDS.filter((f) => f.required).map((f) => f.key);
const HOST_FIELDS = ['hostName', 'hostAddress', 'hostPhone'];
const FIELD_BY_KEY = new Map(LEGAL_FIELDS.map((f) => [f.key, f]));

const ANALYTICS_PROVIDERS = ['ga4', 'matomo'];

// Texte nettoyé SANS troncature : retours chariot unifiés, tabulations en espaces,
// caractères de contrôle retirés ; un retour à la ligne n'est gardé que pour un champ
// multiligne (sinon espace).
function cleanUntruncated(value, multiline) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex -- caractères de contrôle retirés volontairement
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  return (multiline ? text : text.replace(/\n/g, ' ')).trim();
}

function cleanField(field, value) {
  return cleanUntruncated(value, field.multiline).slice(0, field.max).trim();
}

// Forme stockée : toujours les 11 clés, en texte borné (valeur absente ou non textuelle → '').
function normalizeLegal(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const field of LEGAL_FIELDS) out[field.key] = cleanField(field, src[field.key]);
  return out;
}

// Téléphone plausible : chiffres, « + », parenthèses, points, espaces et tirets ; au
// moins 6 chiffres.
function isValidPhone(value) {
  return /^[0-9+().\s-]+$/.test(value) && (value.match(/\d/g) || []).length >= 6;
}

const quoted = (label) => `« ${label} »`;

// Saisie de PUT /api/sites/:slug/legal (objet complet : clé absente = vide). Renvoie
// { ok: true, value } (11 clés nettoyées) ou { ok: false, error, field }.
function validateLegal(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    return { ok: false, error: 'Corps de requête invalide : objet attendu.' };
  }
  for (const key of Object.keys(body)) {
    if (!FIELD_BY_KEY.has(key)) {
      const shown = key.length > 60 ? `${key.slice(0, 60)}…` : key;
      return { ok: false, error: `Champ inconnu : ${quoted(shown)}.`, field: key };
    }
  }
  const value = {};
  for (const field of LEGAL_FIELDS) {
    const raw = body[field.key];
    if (raw === undefined || raw === null) {
      value[field.key] = '';
      continue;
    }
    if (typeof raw !== 'string') {
      return { ok: false, error: `${quoted(field.label)} : texte attendu.`, field: field.key };
    }
    const cleaned = cleanUntruncated(raw, field.multiline);
    if (cleaned.length > field.max) {
      return { ok: false, error: `${quoted(field.label)} : ${field.max} caractères maximum.`, field: field.key };
    }
    if (field.email && cleaned && !isValidEmail(cleaned)) {
      return { ok: false, error: 'Email de contact invalide.', field: field.key };
    }
    if (field.phone && cleaned && !isValidPhone(cleaned)) {
      return { ok: false, error: `${quoted(field.label)} : numéro de téléphone invalide.`, field: field.key };
    }
    value[field.key] = cleaned;
  }
  return { ok: true, value };
}

// Hébergeur par défaut du serveur (LEGAL_HOST_NAME, LEGAL_HOST_ADDRESS, LEGAL_HOST_PHONE).
function hostDefaultsFromEnv(env = process.env) {
  const source = env || {};
  return {
    hostName: cleanField(FIELD_BY_KEY.get('hostName'), source.LEGAL_HOST_NAME),
    hostAddress: cleanField(FIELD_BY_KEY.get('hostAddress'), source.LEGAL_HOST_ADDRESS),
    hostPhone: cleanField(FIELD_BY_KEY.get('hostPhone'), source.LEGAL_HOST_PHONE),
  };
}

// Valeurs publiées : un champ hébergeur laissé vide prend la valeur par défaut du serveur.
function effectiveLegal(legal, hostDefaults = {}) {
  const out = normalizeLegal(legal);
  for (const key of HOST_FIELDS) {
    if (!out[key] && typeof hostDefaults[key] === 'string') out[key] = hostDefaults[key];
  }
  return out;
}

// Champs obligatoires vides, dans l'ordre de LEGAL_FIELDS.
function missingLegalFields(legal) {
  const src = legal && typeof legal === 'object' ? legal : {};
  return REQUIRED_LEGAL_FIELDS.filter((key) => !(typeof src[key] === 'string' && src[key].trim()));
}

// Durée de conservation des messages en mois (365 jours → 12 mois).
function retentionMonthsFrom(days) {
  return Math.max(1, Math.round(Number(days) / 30.4375) || 1);
}

// Réponse de GET/PUT /api/sites/:slug/legal : saisie stockée, hébergeur par défaut,
// champs obligatoires encore manquants (après repli sur l'hébergeur par défaut).
function legalView(stored, { env = process.env, retentionDays } = {}) {
  const legal = normalizeLegal(stored);
  const hostDefaults = hostDefaultsFromEnv(env);
  return {
    legal,
    hostDefaults,
    missing: missingLegalFields(effectiveLegal(legal, hostDefaults)),
    retentionMonths: retentionMonthsFrom(retentionDays),
  };
}

// Données transmises au build (PUBLIC_LEGAL_JSON), brouillons compris : la politique de
// confidentialité décrit le site PUBLIÉ (mesure d'audience comprise).
function legalBuildData(site, { env = process.env, retentionDays } = {}) {
  const src = site && typeof site === 'object' ? site : {};
  const provider = ANALYTICS_PROVIDERS.includes(src.analyticsProvider) ? src.analyticsProvider : '';
  return {
    ...effectiveLegal(src.legal, hostDefaultsFromEnv(env)),
    retentionMonths: retentionMonthsFrom(retentionDays),
    visitStats: true,
    analyticsProvider: provider,
    analyticsHost: provider === 'matomo' && typeof src.analyticsHost === 'string' ? src.analyticsHost.trim().slice(0, 253) : '',
  };
}

module.exports = {
  LEGAL_FIELDS,
  LEGAL_KEYS,
  REQUIRED_LEGAL_FIELDS,
  HOST_FIELDS,
  normalizeLegal,
  validateLegal,
  hostDefaultsFromEnv,
  effectiveLegal,
  missingLegalFields,
  retentionMonthsFrom,
  legalView,
  legalBuildData,
};
