// Message affiché après un envoi refusé par l'API de contact, dans la langue de la page.
// Les messages d'erreur du serveur sont en français : ils ne sont jamais affichés tels
// quels (une page anglaise montrerait du français). Testé par server/tests/unit.

/**
 * @param {number} status code HTTP de la réponse (0 : échec réseau)
 * @param {{ failed: string, invalid: string, rateLimited: string }} texts libellés traduits
 * @returns {string}
 */
export function errorMessageFor(status, texts) {
  if (status === 429) return texts.rateLimited;
  if (status === 400) return texts.invalid;
  return texts.failed;
}
