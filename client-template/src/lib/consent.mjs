// Consentement RGPD à la mesure d'audience : choix mémorisé et adresses des scripts de
// mesure. Module pur, partagé par la bannière (components/site/consent-banner.ts) et
// testé depuis le serveur (server/tests/unit/site-csp.test.mjs).
import { isValidAnalyticsHost } from './csp.mjs';

/** Clé du choix dans localStorage : { value: 'accepted' | 'refused', at: horodatage }. */
export const CONSENT_KEY = 'lesite-consent';
/** Durée de validité d'un choix : environ 6 mois (la bannière revient ensuite). */
export const CONSENT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 182;

/** Choix mémorisé encore valide ('accepted' ou 'refused'), sinon null (absent, illisible, expiré). */
export function readConsentChoice(raw, now = Date.now()) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || now - (parsed.at || 0) > CONSENT_MAX_AGE_MS) return null;
    return parsed.value === 'accepted' || parsed.value === 'refused' ? parsed.value : null;
  } catch {
    return null;
  }
}

/** Script de mesure à charger après « Accepter » ('' si la configuration est incomplète). */
export function analyticsScriptUrl({ provider = '', id = '', host = '' } = {}) {
  if (provider === 'ga4' && id) return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  if (provider === 'matomo' && id && isValidAnalyticsHost(host)) return `https://${host}/matomo.js`;
  return '';
}

/** Point de collecte Matomo de l'hôte. */
export function matomoTrackerUrl(host) {
  return `https://${host}/matomo.php`;
}
