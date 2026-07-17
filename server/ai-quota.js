// Quota journalier de générations IA par compte. Les admins (et le mode DEV_NO_AUTH)
// sont illimités. La limite vient du champ users.aiDailyQuota (si défini par un admin)
// sinon de AI_DAILY_QUOTA (.env, défaut 10). Compteur persisté dans data/ai-usage.json.

const fs = require('fs');
const path = require('path');
const auth = require('./auth');

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

function usedToday(userId) {
  const entry = readUsage()[String(userId)];
  if (!entry || entry.date !== today()) return 0;
  return entry.count;
}

// null = illimité (admin / mode dev). Sinon { limit, used, remaining }.
function getQuota(user) {
  if (!user || auth.isAdmin(user) || user.devMode) return null;

  // `??` et non `||` : une limite de 0 est une valeur légitime (compte suspendu)
  const personal = Number.isFinite(user.aiDailyQuota) ? user.aiDailyQuota : null;
  const envDefault = Number.parseInt(process.env.AI_DAILY_QUOTA ?? '', 10);
  const limit = personal ?? (Number.isFinite(envDefault) ? envDefault : 10);

  const used = usedToday(user.id);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

function increment(userId) {
  const usage = readUsage();
  const key = String(userId);
  const entry = usage[key];
  if (entry && entry.date === today()) {
    entry.count += 1;
  } else {
    usage[key] = { date: today(), count: 1 };
  }
  writeUsage(usage);
}

module.exports = { getQuota, increment };
