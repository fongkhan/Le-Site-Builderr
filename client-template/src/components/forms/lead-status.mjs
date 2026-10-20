// Message affiché après un envoi refusé par l'API de contact, dans la langue de la page.
// Les messages d'erreur du serveur sont en français : ils ne sont jamais affichés tels
// quels (une page anglaise montrerait du français). Le code stable de la réponse
// (server/lib/contact.js) l'emporte ; à défaut (serveur plus ancien), le statut HTTP.
// Testé par server/tests/unit.

/** Champs du formulaire que le serveur peut signaler comme invalides (réponse `fields`). */
export const CONTACT_FIELDS = ['name', 'email', 'message'];

const CODE_TEXTS = {
  rate_limited: 'rateLimited',
  invalid_fields: 'invalid',
  invalid_body: 'invalid',
  too_large: 'tooLong',
};

/**
 * @param {number} status code HTTP de la réponse (0 : échec réseau)
 * @param {{ failed: string, invalid: string, rateLimited: string, tooLong?: string }} texts libellés traduits
 * @param {string} [code] code d'erreur de la réponse JSON
 * @returns {string}
 */
export function errorMessageFor(status, texts, code) {
  const byCode = typeof code === 'string' && Object.hasOwn(CODE_TEXTS, code) ? texts[CODE_TEXTS[code]] : '';
  if (byCode) return byCode;
  if (status === 429) return texts.rateLimited;
  if (status === 413) return texts.tooLong || texts.failed;
  if (status === 400) return texts.invalid;
  return texts.failed;
}

/**
 * Champs refusés d'une réponse d'erreur (`fields`), limités aux champs connus, sans doublon.
 * @param {unknown} body corps JSON de la réponse (ou null)
 * @returns {string[]}
 */
export function invalidFieldsOf(body) {
  const fields = body && typeof body === 'object' && Array.isArray(body.fields) ? body.fields : [];
  return CONTACT_FIELDS.filter((name) => fields.includes(name));
}
