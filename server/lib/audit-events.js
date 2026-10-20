// Journal d'audit (collection audit_logs) : écriture tolérante et fonctions pures de mise
// en forme. CommonJS SANS aucun require : importé par payload.config.ts (bundlé par Next)
// comme par les routes Express.
// Règle : jamais de mot de passe, de hash, de jeton ni d'adresse IP dans le journal.

// Durée de conservation par défaut (jours) du journal et de l'historique des builds.
const DEFAULT_RETENTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// Écritures en cours, attendues par l'arrêt propre (core/shutdown, même clé) : registre
// partagé sur globalThis, car la copie de ce module bundlée par Next (hooks Payload) est
// une autre instance que celle des routes Express. La promesse ne doit jamais rejeter.
const BACKGROUND_KEY = Symbol.for('meta-builder.background');
function trackWrite(promise) {
  const pending = globalThis[BACKGROUND_KEY] || (globalThis[BACKGROUND_KEY] = new Set());
  pending.add(promise);
  promise.finally(() => pending.delete(promise)).catch(() => { /* jamais : promesse sans rejet */ });
  return promise;
}

// Écrit une entrée. Ne rejette jamais : l'audit ne fait jamais échouer une opération.
// Sans `req` : connexion séparée, hors de la transaction de l'opération tracée.
function writeAudit(payload, entry) {
  return trackWrite(insertAudit(payload, entry));
}

async function insertAudit(payload, { action, actor, target, details } = {}) {
  if (!payload || typeof payload.create !== 'function') return false;
  try {
    await payload.create({
      collection: 'audit_logs',
      data: {
        action,
        actor: actor || 'système',
        target: String(target ?? '').slice(0, 254),
        details: String(details ?? '').slice(0, 1000),
      },
      overrideAccess: true,
    });
    return true;
  } catch (e) {
    console.error('Audit non enregistré :', e && e.message);
    return false;
  }
}

// Audit lancé depuis un hook Payload exécuté DANS la transaction de l'opération : celle-ci
// tient une connexion du pool jusqu'à son commit. Attendre là une seconde connexion
// (écriture du journal, libellés des sites) bloquerait tout le pool dès que toutes ses
// connexions sont ainsi tenues (constaté : 10 demandes de réinitialisation simultanées).
// La tâche part donc en arrière-plan, après le retour du hook ; elle ne rejette jamais.
// Inscrite dès l'appel (pendant la requête) auprès de l'arrêt propre.
function auditInBackground(task) {
  trackWrite(Promise.resolve()
    .then(task)
    .catch((e) => console.error('Audit non enregistré :', e && e.message)));
}

// Auteur d'une action : compte connecté ; sinon « anonyme » pour un appel HTTP Payload
// (REST, GraphQL) ; sinon « système » (API locale, route Express sans session).
function auditActor(req) {
  const email = req && req.user && req.user.email;
  if (email) return String(email);
  if (req && req.payloadAPI && req.payloadAPI !== 'local') return 'anonyme';
  return 'système';
}

// Email saisi lors d'un échec de connexion : jamais en clair (2 premiers caractères de la
// partie locale, domaine conservé). Longueur bornée avant l'expression régulière.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function maskEmail(value) {
  const v = value === null || value === undefined ? '' : String(value).trim().toLowerCase();
  if (!v) return '(vide)';
  if (v.length > 254 || !EMAIL_RE.test(v)) return '(identifiant non valide)';
  const at = v.indexOf('@');
  const local = v.slice(0, at);
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}***@${v.slice(at + 1)}`.slice(0, 120);
}

// Relation peuplée (objet) ou identifiant brut.
function siteIdOf(x) {
  return x && typeof x === 'object' ? x.id : x;
}

const showValue = (v) => (v === null || v === undefined || v === '' ? '∅' : String(v));
const sortedRoles = (roles) => (Array.isArray(roles) ? roles.map(String).sort() : []);
const listOf = (value) => (Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value]);
const siteIds = (list) => listOf(list).map(siteIdOf).filter((id) => id !== null && id !== undefined && id !== '').map(String);

// Libellé d'un site : table fournie, sinon slug d'une relation peuplée, sinon « #id ».
function siteLabeler(siteLabels, ...lists) {
  const known = {};
  for (const list of lists) {
    for (const item of listOf(list)) {
      if (item && typeof item === 'object' && item.id !== undefined && item.slug) known[String(item.id)] = String(item.slug);
    }
  }
  return (id) => (siteLabels && siteLabels[id]) || known[id] || `#${id}`;
}

// Résumé des changements d'un compte. Ne lit QUE email, roles, plan, aiDailyQuota et
// sites : jamais password, hash, salt, resetPasswordToken, sessions ni loginAttempts.
function userChangeSummary(prev, next, { passwordChanged = false, siteLabels = {} } = {}) {
  const a = prev || {};
  const b = next || {};
  const parts = [];
  if (showValue(a.email) !== showValue(b.email)) parts.push(`email=${showValue(a.email)}→${showValue(b.email)}`);
  const rolesA = sortedRoles(a.roles).join(',');
  const rolesB = sortedRoles(b.roles).join(',');
  if (rolesA !== rolesB) parts.push(`roles=${rolesA || '∅'}→${rolesB || '∅'}`);
  if (showValue(a.plan) !== showValue(b.plan)) parts.push(`plan=${showValue(a.plan)}→${showValue(b.plan)}`);
  if (showValue(a.aiDailyQuota) !== showValue(b.aiDailyQuota)) parts.push(`aiDailyQuota=${showValue(a.aiDailyQuota)}→${showValue(b.aiDailyQuota)}`);
  const before = new Set(siteIds(a.sites));
  const after = new Set(siteIds(b.sites));
  const label = siteLabeler(siteLabels, a.sites, b.sites);
  const added = [...after].filter((id) => !before.has(id)).map(label).sort();
  const removed = [...before].filter((id) => !after.has(id)).map(label).sort();
  const siteParts = [];
  if (added.length) siteParts.push(`+[${added.join(',')}]`);
  if (removed.length) siteParts.push(`-[${removed.join(',')}]`);
  if (siteParts.length) parts.push(`sites=${siteParts.join(' ')}`);
  if (passwordChanged) parts.push('motdepasse=modifié');
  return parts.join(' ; ');
}

// Résumé d'un compte créé (mêmes champs lus que userChangeSummary).
function userCreationSummary(doc, siteLabels = {}) {
  const d = doc || {};
  const parts = [`roles=${sortedRoles(d.roles).join(',') || '∅'}`, `plan=${showValue(d.plan)}`];
  const ids = siteIds(d.sites);
  if (ids.length) {
    const label = siteLabeler(siteLabels, d.sites);
    parts.push(`sites=[${ids.map(label).sort().join(',')}]`);
  }
  if (d.aiDailyQuota !== null && d.aiDailyQuota !== undefined) parts.push(`aiDailyQuota=${d.aiDailyQuota}`);
  return parts.join(' ; ');
}

// Table { id: slug } des sites cités : relations peuplées d'abord, puis les identifiants
// restants en UNE requête. Échec de la requête : ce qui est déjà connu.
async function siteLabelsFor(payload, ...lists) {
  const labels = {};
  const pending = [];
  for (const list of lists) {
    for (const item of listOf(list)) {
      if (item && typeof item === 'object') {
        if (item.id !== undefined && item.slug) labels[String(item.id)] = String(item.slug);
      } else if (item !== null && item !== undefined && item !== '') {
        pending.push(item);
      }
    }
  }
  const seen = new Set();
  const ids = pending.filter((id) => {
    const key = String(id);
    if (key in labels || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!ids.length || !payload || typeof payload.find !== 'function') return labels;
  try {
    const res = await payload.find({
      collection: 'payload_sites',
      where: { id: { in: ids } },
      depth: 0,
      limit: ids.length,
      pagination: false,
      overrideAccess: true,
    });
    for (const doc of (res && res.docs) || []) {
      if (doc && doc.id !== undefined && doc.slug) labels[String(doc.id)] = String(doc.slug);
    }
  } catch {
    // libellés partiels : « #id » pour les sites non résolus
  }
  return labels;
}

// Cible d'une entrée liée à un site (média) : slug, sinon « #id ».
async function siteTargetFor(payload, site) {
  const id = siteIdOf(site);
  if (id === null || id === undefined || id === '') return '';
  const labels = await siteLabelsFor(payload, [site]);
  return labels[String(id)] || `#${id}`;
}

// Résumé des changements de thème (valeurs déjà validées : couleurs hex, polices de la
// liste, rayon en px).
const THEME_KEYS = [
  ['colors', 'primary', 'couleur.primary'],
  ['colors', 'secondary', 'couleur.secondary'],
  ['colors', 'background', 'couleur.background'],
  ['colors', 'text', 'couleur.text'],
  ['fonts', 'heading', 'police.heading'],
  ['fonts', 'body', 'police.body'],
  [null, 'radius', 'rayon'],
  [null, 'logo', 'logo'],
];
function themeChangeSummary(prev, next) {
  const read = (theme, group, key) => {
    const source = group ? theme && theme[group] : theme;
    return showValue(source && typeof source === 'object' ? source[key] : undefined);
  };
  const parts = [];
  for (const [group, key, label] of THEME_KEYS) {
    const before = read(prev, group, key);
    const after = read(next, group, key);
    if (before !== after) parts.push(`${label}=${before}→${after}`);
  }
  return parts.join(' ; ');
}

// Paramètres de GET /api/audit → { page, limit, where } ou { error }.
const ACTION_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
function intParam(raw, fallback, min, max) {
  if (raw === undefined || raw === '') return fallback;
  if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}
function textFilter(raw, field) {
  if (raw === undefined) return { value: undefined };
  if (typeof raw !== 'string') return { error: `Filtre « ${field} » invalide.` };
  const value = raw.trim();
  if (!value) return { value: undefined };
  if (value.length > 254) return { error: `Filtre « ${field} » invalide.` };
  return { value };
}
function parseAuditQuery(query) {
  const q = query && typeof query === 'object' ? query : {};
  const page = intParam(q.page, 1, 1, 100000);
  if (page === null) return { error: 'Paramètre « page » invalide.' };
  const limit = intParam(q.limit, 50, 1, 200);
  if (limit === null) return { error: 'Paramètre « limit » invalide (1 à 200).' };

  const parts = [];
  if (q.action !== undefined) {
    if (typeof q.action !== 'string') return { error: 'Filtre « action » invalide.' };
    const actions = q.action.split(',').map((a) => a.trim()).filter(Boolean);
    if (actions.length > 10 || actions.some((a) => !ACTION_RE.test(a))) return { error: 'Filtre « action » invalide.' };
    if (actions.length === 1) parts.push({ action: { contains: actions[0] } });
    else if (actions.length > 1) parts.push({ or: actions.map((a) => ({ action: { contains: a } })) });
  }
  for (const field of ['target', 'actor']) {
    const { value, error } = textFilter(q[field], field);
    if (error) return { error };
    if (value !== undefined) parts.push({ [field]: { equals: value } });
  }
  return { page, limit, where: parts.length ? { and: parts } : undefined };
}

// Durée de conservation (jours) lue dans l'environnement : entier décimal (0 = purge
// désactivée) ; vide, absent ou invalide → fallback. (envInt traiterait 0 comme absent.)
function parseRetentionDays(raw, fallback = DEFAULT_RETENTION_DAYS) {
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim();
  return /^\d+$/.test(value) ? Number(value) : fallback;
}

// Date limite (ISO) : entrées antérieures à purger. null : purge désactivée (0) ou
// durée telle que rien ne peut être plus ancien.
function retentionCutoff(days, now = Date.now()) {
  if (!Number.isFinite(days) || days <= 0) return null;
  const t = now - days * DAY_MS;
  if (!Number.isFinite(t) || t < 0) return null;
  return new Date(t).toISOString();
}

// Connexions réussies tracées : comptes admin toujours, tous les comptes avec AUDIT_LOGINS=true.
function shouldAuditLogin(user, env = process.env) {
  const roles = (user && Array.isArray(user.roles)) ? user.roles : [];
  return roles.includes('admin') || Boolean(env && env.AUDIT_LOGINS === 'true');
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  writeAudit,
  auditInBackground,
  auditActor,
  maskEmail,
  siteIdOf,
  userChangeSummary,
  userCreationSummary,
  siteLabelsFor,
  siteTargetFor,
  themeChangeSummary,
  parseAuditQuery,
  parseRetentionDays,
  retentionCutoff,
  shouldAuditLogin,
};
