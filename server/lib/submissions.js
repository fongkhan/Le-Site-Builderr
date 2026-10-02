// Messages reçus par les formulaires des sites publiés (contact, rendez-vous) : fonctions
// pures de normalisation et de rétention, partagées par Payload et le repli JSON.

const KINDS = ['contact', 'appointment'];
const LIMITS = { name: 120, email: 200, phone: 40, message: 5000 };
const RETENTION = { retentionDays: 365, max: 500 };

// Texte borné : caractères de contrôle retirés (sauf retours à la ligne et tabulations
// pour le message), espaces de bord supprimés, longueur plafonnée.
function cleanText(value, max, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  const pattern = multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return value.replace(/\r\n?/g, '\n').replace(pattern, multiline ? '' : ' ').trim().slice(0, max).trim();
}

// Forme stockée d'un message : uniquement les champs connus, bornés. Le honeypot et
// tout autre champ du formulaire sont ignorés.
function normalizeSubmission(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    kind: KINDS.includes(src.kind) ? src.kind : 'contact',
    name: cleanText(src.name, LIMITS.name),
    email: cleanText(src.email, LIMITS.email),
    phone: cleanText(src.phone, LIMITS.phone),
    message: cleanText(src.message, LIMITS.message, { multiline: true }),
  };
}

const timeOf = (entry) => (entry && typeof entry === 'object' ? Date.parse(entry.createdAt) : NaN);

// Rétention : supprime les messages plus vieux que retentionDays et ne garde que les
// `max` plus récents. Entrées invalides (non-objet, date illisible) écartées. Renvoie
// une nouvelle liste triée du plus récent au plus ancien.
function pruneSubmissions(list, now = new Date(), { retentionDays = RETENTION.retentionDays, max = RETENTION.max } = {}) {
  if (!Array.isArray(list)) return [];
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const cutoff = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  return list
    .filter((entry) => {
      const t = timeOf(entry);
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, Math.max(0, max));
}

module.exports = { normalizeSubmission, pruneSubmissions, SUBMISSION_LIMITS: LIMITS, SUBMISSION_RETENTION: RETENTION };
