#!/usr/bin/env node
// Garde d'audit des dépendances de production (server, orchestrator, client-template).
// Échoue sur toute vulnérabilité élevée ou critique non couverte par une exception datée
// de security/audit-allowlist.json (paquet + identifiant GHSA + emplacements exacts).
//
//   node scripts/audit-gate.mjs                   lance « npm audit --omit=dev --json » (lockfile seul)
//   node scripts/audit-gate.mjs --depuis <dossier> relit <dossier>/<projet>.json (rapports enregistrés)
//   node scripts/audit-gate.mjs --exceptions <fichier>  autre liste d'exceptions (contrôle)
//
// Codes de sortie : 0 conforme ; 1 vulnérabilité bloquante ou liste d'exceptions invalide ;
// 2 audit impossible (réseau ou registre injoignable).
// Sans dépendance : logique pure exportée (tests : server/tests/unit/audit-gate.test.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PROJECTS = ['server', 'orchestrator', 'client-template'];
export const BLOCKING_SEVERITIES = ['high', 'critical'];
// Durée de vie maximale d'une exception : environ six mois
export const MAX_EXCEPTION_DAYS = 183;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Date du jour au format AAAA-MM-JJ (UTC)
export function isoDay(date = new Date()) {
  return (typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date).toISOString().slice(0, 10);
}

function addDays(day, n) {
  const d = new Date(`${isoDay(day)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

const isValidDay = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && isoDay(s) === s;

// Avis distincts d'un rapport « npm audit --json » : les objets de vulnerabilities[*].via
// (les chaînes ne sont que des renvois vers un autre paquet), dédoublonnés par paquet + id.
export function collectAdvisories(auditJson) {
  const vulnerabilities = (auditJson && auditJson.vulnerabilities) || {};
  const seen = new Map();
  for (const vuln of Object.values(vulnerabilities)) {
    for (const via of vuln.via || []) {
      if (!via || typeof via !== 'object') continue;
      const id = String(via.url || via.source || '').split('/').filter(Boolean).pop() || String(via.source);
      const key = `${via.name}|${id}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        package: via.name,
        id,
        severity: via.severity,
        title: via.title || '',
        nodes: vulnerabilities[via.name]?.nodes ?? [],
      });
    }
  }
  return [...seen.values()];
}

// Exception couvrant l'avis : même paquet, identifiant listé et, si l'exception précise des
// emplacements (nodes), TOUS les emplacements de l'avis en font partie (une nouvelle copie
// vulnérable ailleurs dans l'arbre n'est jamais couverte en silence).
function covers(entry, advisory) {
  if (entry.package !== advisory.package) return false;
  if (!Array.isArray(entry.ids) || !entry.ids.includes(advisory.id)) return false;
  if (Array.isArray(entry.nodes)) return advisory.nodes.every((n) => entry.nodes.includes(n));
  return true;
}

// Seules les sévérités élevée et critique comptent. Résultat :
//  - blocking : avis sans exception valide (raison « non listé » ou « exception expirée le … ») ;
//  - allowed : avis couverts par une exception en cours ;
//  - unused : exceptions (ou identifiants) sans aucun avis correspondant, à retirer.
export function evaluateAudit(advisories, entries = [], today = new Date()) {
  const day = isoDay(today);
  const blocking = [];
  const allowed = [];
  const used = new Map(); // entrée → identifiants utilisés
  for (const advisory of advisories) {
    if (!BLOCKING_SEVERITIES.includes(advisory.severity)) continue;
    const entry = entries.find((e) => covers(e, advisory));
    if (!entry) {
      blocking.push({ ...advisory, raison: 'non listé' });
      continue;
    }
    if (!used.has(entry)) used.set(entry, new Set());
    used.get(entry).add(advisory.id);
    if (entry.expires < day) blocking.push({ ...advisory, raison: `exception expirée le ${entry.expires}` });
    else allowed.push({ ...advisory, expires: entry.expires, reason: entry.reason });
  }
  const unused = [];
  for (const entry of entries) {
    const ids = (entry.ids || []).filter((id) => !used.get(entry)?.has(id));
    if (ids.length) unused.push({ package: entry.package, ids, ...(entry.nodes ? { nodes: entry.nodes } : {}) });
  }
  return { blocking, allowed, unused };
}

// Erreurs de la liste d'exceptions (tableau vide si elle est valide).
export function validateAllowlist(json, today = new Date()) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return ['Liste d\'exceptions illisible : objet { "<projet>": [ … ] } attendu.'];
  const limit = addDays(today, MAX_EXCEPTION_DAYS);
  for (const key of Object.keys(json)) {
    if (!PROJECTS.includes(key)) errors.push(`Projet inconnu « ${key} » (attendus : ${PROJECTS.join(', ')}).`);
  }
  for (const project of PROJECTS) {
    const entries = json[project] ?? [];
    if (!Array.isArray(entries)) {
      errors.push(`${project} : tableau d'exceptions attendu.`);
      continue;
    }
    entries.forEach((entry, i) => {
      const where = `${project} [${i}]${entry && entry.package ? ` (${entry.package})` : ''}`;
      if (!entry || typeof entry !== 'object') {
        errors.push(`${where} : exception illisible.`);
        return;
      }
      if (typeof entry.package !== 'string' || !entry.package.trim()) errors.push(`${where} : paquet (package) manquant.`);
      if (!Array.isArray(entry.ids) || !entry.ids.length || entry.ids.some((id) => typeof id !== 'string' || !id.trim())) errors.push(`${where} : identifiants des avis (ids) manquants.`);
      if (entry.nodes !== undefined && (!Array.isArray(entry.nodes) || !entry.nodes.length || entry.nodes.some((n) => typeof n !== 'string' || !n.trim()))) errors.push(`${where} : emplacements (nodes) invalides.`);
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) errors.push(`${where} : justification (reason) manquante.`);
      if (!isValidDay(entry.expires)) errors.push(`${where} : date d'expiration (expires, AAAA-MM-JJ) manquante ou invalide.`);
      else if (entry.expires > limit) errors.push(`${where} : expiration ${entry.expires} trop lointaine (${MAX_EXCEPTION_DAYS} jours maximum, soit le ${limit}).`);
    });
  }
  return errors;
}

function readAudit(project, fromDir) {
  let text;
  if (fromDir) {
    try {
      text = fs.readFileSync(path.join(fromDir, `${project}.json`), 'utf8');
    } catch {
      return null;
    }
  } else {
    const run = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: path.join(ROOT, project),
      encoding: 'utf8',
      shell: process.platform === 'win32',
      maxBuffer: 64e6,
    });
    text = run.stdout;
  }
  try {
    const json = JSON.parse(text);
    return json && typeof json === 'object' && !json.error ? json : null;
  } catch {
    return null;
  }
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(args) {
  const fromDir = argValue(args, '--depuis');
  const listFile = argValue(args, '--exceptions') || path.join(ROOT, 'security', 'audit-allowlist.json');
  const today = isoDay();
  let allowlist = null;
  try {
    allowlist = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  } catch (err) {
    console.error(`✖ Liste d'exceptions illisible (${path.relative(ROOT, listFile) || listFile}) : ${err.message}`);
    return 1;
  }
  const listErrors = validateAllowlist(allowlist, today);
  for (const e of listErrors) console.error(`✖ Liste d'exceptions : ${e}`);

  let blockingCount = 0;
  let impossible = false;
  for (const project of PROJECTS) {
    const audit = readAudit(project, fromDir);
    if (!audit) {
      console.error(`✖ Audit impossible pour ${project} (réseau ou registre injoignable)`);
      impossible = true;
      continue;
    }
    const { blocking, allowed, unused } = evaluateAudit(collectAdvisories(audit), allowlist[project] || [], today);
    blockingCount += blocking.length;
    console.log(`\n== ${project} : ${blocking.length} bloquant(s), ${allowed.length} couvert(s), ${unused.length} exception(s) à retirer`);
    for (const a of blocking) console.log(`  ✖ bloquant : ${a.package} ${a.id} (${a.severity}) — ${a.raison} — ${a.title} [${a.nodes.join(', ')}]`);
    for (const a of allowed) console.log(`  ✔ couvert : ${a.package} ${a.id} (${a.severity}) jusqu'au ${a.expires} — ${a.reason}`);
    for (const u of unused) console.log(`  ⚠ exception à retirer : ${u.package} ${u.ids.join(', ')} (aucun avis élevé ou critique correspondant)`);
  }
  console.log('');
  if (blockingCount || listErrors.length) {
    console.error(`✖ Audit refusé : ${blockingCount} vulnérabilité(s) bloquante(s)${listErrors.length ? `, liste d'exceptions invalide (${listErrors.length} erreur(s))` : ''}. Mettez à jour la dépendance, ou ajoutez une exception datée et justifiée dans security/audit-allowlist.json.`);
    return 1;
  }
  if (impossible) return 2;
  console.log('✔ Audit conforme : aucune vulnérabilité élevée ou critique hors exceptions datées.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
