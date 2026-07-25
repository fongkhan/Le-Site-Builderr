// Quota journalier de générations IA par compte. Les admins (et le mode DEV_NO_AUTH)
// sont illimités. La limite vient du champ users.aiDailyQuota (si défini par un admin)
// sinon de AI_DAILY_QUOTA (.env, défaut 10). Compteur persisté dans data/ai-usage.json.

const fs = require('fs');
const path = require('path');
const auth = require('./auth');
const plans = require('./lib/plans');

const USAGE_FILE = path.join(__dirname, 'data', 'ai-usage.json');

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readUsage() {
  try {
    return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function writeUsage(usage) {
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2), 'utf-8');
}

function usedToday(usage, userId) {
  const entry = usage[String(userId)];
  if (!entry || entry.date !== today()) return 0;
  return entry.count;
}

// Pur et testable : limite effective d'un utilisateur. null = illimité (admin / dev).
// `??` (et non `||`) : une limite de 0 est légitime (compte suspendu).
// Priorité : quota personnel (fixé par un admin) → quota de l'offre du compte →
// valeur d'environnement → 10. Une variable d'environnement explicite reste
// prioritaire sur l'offre en développement/CI (ex. AI_DAILY_QUOTA=0).
function computeLimit(user, envValue, isAdmin = auth.isAdmin) {
  if (!user || isAdmin(user) || user.devMode) return null;
  const personal = Number.isFinite(user.aiDailyQuota) ? user.aiDailyQuota : null;
  if (personal !== null) return personal;
  const envDefault = Number.parseInt(envValue ?? '', 10);
  if (Number.isFinite(envDefault)) return envDefault;
  const limits = plans.limitsFor(user);
  return limits ? limits.aiDailyQuota : 10;
}

// Lecture seule (affichage). null = illimité. Sinon { limit, used, remaining }.
function getQuota(user) {
  const limit = computeLimit(user, process.env.AI_DAILY_QUOTA);
  if (limit === null) return null;
  const used = usedToday(readUsage(), user.id);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

// --- Section critique sérialisée ---
// Node est mono-thread mais les sections check→write franchissent des `await` :
// deux requêtes concurrentes pouvaient lire le même compteur, passer la vérif, puis
// s'incrémenter en s'écrasant (read-modify-write perdu). On sérialise chaque accès
// via une chaîne de promesses : un seul reserve/release s'exécute à la fois.
let chain = Promise.resolve();
function serialize(fn) {
  const run = chain.then(fn, fn); // s'exécute même si la précédente a rejeté
  chain = run.then(() => {}, () => {}); // ne jamais casser la chaîne
  return run;
}

// Réserve un créneau AVANT l'appel IA (ferme la fenêtre TOCTOU check→appel→incrément) :
// incrémente le compteur si la limite le permet, atomiquement.
//  - illimité (admin/dev) → { ok: true, quota: null } sans aucune écriture
//  - quota atteint        → { ok: false, quota: { limit, used, remaining: 0 } }
//  - réservé              → { ok: true, quota: { limit, used, remaining } }
function reserveSlot(user) {
  const limit = computeLimit(user, process.env.AI_DAILY_QUOTA);
  if (limit === null) return Promise.resolve({ ok: true, quota: null });
  return serialize(() => {
    const usage = readUsage();
    const used = usedToday(usage, user.id);
    if (used >= limit) {
      return { ok: false, quota: { limit, used, remaining: 0 } };
    }
    const key = String(user.id);
    const entry = usage[key];
    if (entry && entry.date === today()) entry.count += 1;
    else usage[key] = { date: today(), count: 1 };
    writeUsage(usage);
    return { ok: true, quota: { limit, used: used + 1, remaining: Math.max(0, limit - used - 1) } };
  });
}

// Libère un créneau réservé quand l'appel IA échoue : « jamais décompté sur échec ».
function releaseSlot(userId) {
  return serialize(() => {
    const usage = readUsage();
    const key = String(userId);
    const entry = usage[key];
    if (entry && entry.date === today() && entry.count > 0) {
      entry.count -= 1;
      writeUsage(usage);
    }
  });
}

module.exports = { getQuota, reserveSlot, releaseSlot, computeLimit };
