// Statistiques de visites légères et anonymes : agrégation par jour, par site.
// Aucune donnée personnelle (ni IP, ni cookie) — juste un compteur de pages vues.
// Fonctions pures (données en entrée/sortie) : testables sans I/O ni serveur.

const RETENTION_DAYS = 90;

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Incrémente le compteur du jour et purge au-delà de la rétention.
// `data` = { 'YYYY-MM-DD': count }. Retourne un NOUVEL objet (jamais muté en place).
function recordHit(data, day = today(), retentionDays = RETENTION_DAYS) {
  const next = { ...(data || {}) };
  next[day] = (Number(next[day]) || 0) + 1;
  return pruneOldDays(next, day, retentionDays);
}

// Supprime les jours antérieurs à la fenêtre de rétention (relative à `ref`).
function pruneOldDays(data, ref = today(), retentionDays = RETENTION_DAYS) {
  const cutoff = new Date(ref);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const out = {};
  for (const [d, c] of Object.entries(data || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= cutoffStr) out[d] = Number(c) || 0;
  }
  return out;
}

// Série des N derniers jours (du plus ancien au plus récent), zéros compris —
// prête pour un graphique. Retourne [{ date, count }].
function lastNDays(data, n = 30, ref = today()) {
  const series = [];
  const base = new Date(ref);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: Number((data || {})[key]) || 0 });
  }
  return series;
}

function total(data) {
  return Object.values(data || {}).reduce((sum, c) => sum + (Number(c) || 0), 0);
}

module.exports = { recordHit, pruneOldDays, lastNDays, total, RETENTION_DAYS };
