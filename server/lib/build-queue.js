// File d'attente des builds conservée sur disque (data/build-queue.json) : format et
// relecture défensive. Fonctions pures : le fichier peut être ancien, tronqué ou modifié à
// la main, rien de ce qu'il contient n'est utilisé sans validation.
const { isValidSlug } = require('./paths');

const QUEUE_VERSION = 1;
const MAX_QUEUE = 200;
const MAX_TRIGGER_LENGTH = 254; // longueur maximale d'une adresse email

function serializeQueue(entries, now = new Date()) {
  return {
    version: QUEUE_VERSION,
    savedAt: now.toISOString(),
    queue: (entries || []).map(({ slug, triggeredBy }) => ({ slug, triggeredBy })),
  };
}

// Déclencheur affiché dans l'historique : chaîne non vide et bornée, sinon « système ».
function cleanTrigger(value) {
  if (typeof value !== 'string') return 'système';
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_TRIGGER_LENGTH ? trimmed : 'système';
}

// Chaîne JSON ou objet → [{ slug, triggeredBy }] : fichier illisible, version inconnue ou
// file absente → [] ; slugs non canoniques et doublons écartés ; MAX_QUEUE entrées au plus.
function parseQueue(raw) {
  let data = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try {
      data = JSON.parse(String(raw));
    } catch {
      return [];
    }
  }
  if (!data || typeof data !== 'object' || data.version !== QUEUE_VERSION || !Array.isArray(data.queue)) return [];
  const seen = new Set();
  const out = [];
  for (const item of data.queue) {
    if (out.length >= MAX_QUEUE) break;
    const slug = item && typeof item === 'object' ? item.slug : null;
    if (!isValidSlug(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, triggeredBy: cleanTrigger(item.triggeredBy) });
  }
  return out;
}

module.exports = { MAX_QUEUE, serializeQueue, parseQueue };
