// Helpers purs pour le rattachement d'un domaine personnalisé (sans I/O ni serveur).
// La vérification de propriété passe par un enregistrement TXT ; ces fonctions
// normalisent/valident le domaine et comparent les enregistrements TXT au jeton.
// Importables tels quels par les tests unitaires (node --test).

const crypto = require('crypto');

// Nettoie une saisie utilisateur en hostname : minuscules, sans protocole, sans
// « www. », sans chemin, port ni point final. Renvoie '' si rien d'exploitable.
function normalizeDomain(input) {
  if (typeof input !== 'string') return '';
  let d = input.trim().toLowerCase();
  if (!d) return '';
  d = d.replace(/^https?:\/\//, ''); // retire le protocole
  d = d.split('/')[0]; // retire le chemin éventuel
  d = d.split('?')[0].split('#')[0];
  d = d.split(':')[0]; // retire le port
  d = d.replace(/^www\./, ''); // « www. » est implicite
  d = d.replace(/\.+$/, ''); // point final FQDN
  return d;
}

// Valide un nom de domaine (FQDN public). Rejette : IP, localhost, labels invalides,
// longueur > 253, et — si `rootDomain` est fourni — tout sous-domaine du root interne
// (on ne « rattache » pas un sous-domaine o2switch déjà géré automatiquement).
function isValidDomain(fqdn, { rootDomain } = {}) {
  if (typeof fqdn !== 'string') return false;
  const d = fqdn.trim().toLowerCase();
  if (d.length < 4 || d.length > 253) return false;
  // Labels : lettres/chiffres/tirets, ne commencent/finissent pas par un tiret ;
  // TLD alphabétique de 2 à 63 caractères → rejette les IP (TLD numérique).
  const re = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (!re.test(d)) return false;
  if (rootDomain) {
    const root = String(rootDomain).trim().toLowerCase().replace(/\.+$/, '');
    if (root && (d === root || d.endsWith('.' + root))) return false;
  }
  return true;
}

// Hôte de l'enregistrement TXT de vérification pour un domaine donné.
// Sous-domaine dédié : n'écrase jamais un TXT existant (SPF, DMARC…).
function verifyRecordHost(domain) {
  return `_lesite-verify.${domain}`;
}

// Génère un jeton de vérification unique à publier en TXT. Non secret (prouve
// seulement le contrôle DNS), mais imprévisible pour éviter toute collision.
function makeVerifyToken() {
  return `lesite-verify=${crypto.randomBytes(16).toString('hex')}`;
}

// Compare les enregistrements TXT renvoyés par dns.resolveTxt (Array<Array<string>>,
// chaque enregistrement pouvant être découpé en morceaux) au jeton attendu.
function verifyTxtRecords(records, token) {
  if (!Array.isArray(records) || typeof token !== 'string' || !token) return false;
  const expected = token.trim();
  for (const rec of records) {
    const value = Array.isArray(rec) ? rec.join('') : String(rec);
    if (value.trim() === expected) return true;
  }
  return false;
}

module.exports = {
  normalizeDomain,
  isValidDomain,
  verifyRecordHost,
  makeVerifyToken,
  verifyTxtRecords,
};
