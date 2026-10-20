// Agrégation des contrôles de santé (fonction pure, testable sans serveur).
// Un contrôle vaut 'ok' en cas de succès ; toute autre valeur est un échec. Les contrôles
// purement informatifs (objet, ex. état du build) ne comptent pas.

// Contrôles sans lesquels le serveur ne peut pas servir : base de données et disque.
const CRITICAL_CHECKS = ['database', 'storage'];

// Renvoie { status: 'ok'|'degraded'|'down', httpStatus: 200|503 }.
// Un contrôle critique en échec → down/503 ; un contrôle non critique → degraded/200.
function summarizeChecks(checks = {}, critical = CRITICAL_CHECKS) {
  // Un contrôle critique absent ou inattendu est un échec (jamais « ok » par omission)
  if (critical.some((name) => checks[name] !== 'ok')) return { status: 'down', httpStatus: 503 };
  const degraded = Object.entries(checks).some(([name, value]) =>
    !critical.includes(name) && !(value !== null && typeof value === 'object') && value !== 'ok'
  );
  return degraded ? { status: 'degraded', httpStatus: 200 } : { status: 'ok', httpStatus: 200 };
}

// Sonde mise en cache : au plus un calcul (requête SQL, accès disque) par période
// ttlMs, et les appels simultanés partagent le calcul en cours. Protège le serveur d'une
// sonde trop fréquente (ou d'un flood anonyme) SANS jamais répondre 429 : une sonde de
// disponibilité toutes les secondes reste servie. Un calcul en échec n'est pas mis en cache.
function createCachedProbe(compute, ttlMs = 2000, now = Date.now) {
  let cached = null;
  let pending = null;
  return function probe() {
    if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.value);
    if (!pending) {
      pending = Promise.resolve()
        .then(compute)
        .then((value) => {
          cached = { at: now(), value };
          return value;
        })
        .finally(() => { pending = null; });
    }
    return pending;
  };
}

module.exports = { summarizeChecks, createCachedProbe, CRITICAL_CHECKS };
