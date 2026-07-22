// Helpers purs pour la configuration de mesure d'audience (analytics) d'un site.
// Deux fournisseurs supportés : GA4 (Google Analytics) et Matomo (auto-hébergé ou cloud).
// La validation stricte est essentielle : ces valeurs sont injectées dans les pages
// publiées (chargement de script) — aucune valeur non conforme ne doit passer.

const PROVIDERS = ['', 'ga4', 'matomo'];

// Valide et normalise { provider, id, host }. Renvoie { ok: true, value } avec les
// champs normalisés, ou { ok: false, error } avec un message explicite.
// provider '' (aucun) réinitialise la configuration (id/host vidés).
function validateAnalytics({ provider, id, host } = {}) {
  const p = provider == null ? '' : (typeof provider === 'string' ? provider.trim().toLowerCase() : null);
  if (p === null || !PROVIDERS.includes(p)) {
    return { ok: false, error: "Fournisseur de mesure d'audience inconnu (ga4, matomo ou vide)." };
  }
  if (p === '') {
    return { ok: true, value: { analyticsProvider: '', analyticsId: '', analyticsHost: '' } };
  }

  const rawId = typeof id === 'string' ? id.trim() : '';
  if (p === 'ga4') {
    // Identifiant de mesure GA4 : G-XXXXXXXXXX (lettres/chiffres)
    if (!/^G-[A-Z0-9]{4,16}$/i.test(rawId)) {
      return { ok: false, error: 'Identifiant GA4 invalide (attendu : G-XXXXXXXXXX).' };
    }
    return { ok: true, value: { analyticsProvider: 'ga4', analyticsId: rawId.toUpperCase(), analyticsHost: '' } };
  }

  // Matomo : idSite numérique + hôte (domaine, sans protocole ni chemin)
  if (!/^[0-9]{1,6}$/.test(rawId)) {
    return { ok: false, error: 'Identifiant Matomo invalide (idSite numérique attendu).' };
  }
  let h = typeof host === 'string' ? host.trim().toLowerCase() : '';
  h = h.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  // Domaine simple : labels alphanumériques/tirets + TLD alphabétique (pas d'IP, pas de chemin)
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h)) {
    return { ok: false, error: 'Hôte Matomo invalide (attendu : stats.mondomaine.fr).' };
  }
  return { ok: true, value: { analyticsProvider: 'matomo', analyticsId: rawId, analyticsHost: h } };
}

module.exports = { validateAnalytics, PROVIDERS };
