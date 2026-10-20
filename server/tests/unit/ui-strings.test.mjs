import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI_STRINGS, t } from '../../../client-template/src/lib/ui-strings.mjs';
import { LOCALES } from '../../../client-template/src/lib/i18n.mjs';
import { errorMessageFor, invalidFieldsOf, CONTACT_FIELDS } from '../../../client-template/src/components/forms/lead-status.mjs';

test('UI_STRINGS — une table par langue du site, mêmes clés partout', () => {
  assert.deepEqual(Object.keys(UI_STRINGS).sort(), [...LOCALES].sort());
  const reference = Object.keys(UI_STRINGS.fr).sort();
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(UI_STRINGS[locale]).sort(), reference, `clés différentes en « ${locale} »`);
  }
});

test('UI_STRINGS — aucune valeur vide', () => {
  for (const [locale, dict] of Object.entries(UI_STRINGS)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.ok(value.trim() !== '', `${locale}.${key} vide`);
    }
  }
});

test('t — libellé de la langue demandée', () => {
  assert.equal(t('fr', 'formName'), 'Votre nom');
  assert.equal(t('en', 'formName'), 'Your name');
});

test('t — repli sur le français (langue inconnue ou absente), puis sur la clé', () => {
  assert.equal(t('de', 'formName'), 'Votre nom');
  assert.equal(t(undefined, 'formName'), 'Votre nom');
  assert.equal(t('__proto__', 'formName'), 'Votre nom');
  assert.equal(t('en', 'cle-inconnue'), 'cle-inconnue');
  assert.equal(t('en', 'toString'), 'toString');
});

test('t — remplacement des marqueurs {nom}', () => {
  assert.equal(t('fr', 'orderProduct', { name: 'Bol' }), 'Commander « Bol »');
  assert.equal(t('en', 'orderProduct', { name: 'Bowl' }), 'Order “Bowl”');
  assert.equal(t('fr', 'orderProduct'), 'Commander « {name} »');
});

test('formulaire — erreur d’envoi dans la langue de la page, jamais le texte du serveur', () => {
  const texts = (locale) => ({ failed: t(locale, 'contactError'), invalid: t(locale, 'formInvalid'), rateLimited: t(locale, 'formRateLimited') });
  const en = texts('en');
  assert.equal(errorMessageFor(429, en), 'Too many submissions in a short time: please try again in a few minutes.');
  assert.equal(errorMessageFor(400, en), 'Please check your name, email address and message.');
  assert.equal(errorMessageFor(500, en), 'Unable to send the message right now.');
  assert.equal(errorMessageFor(0, en), 'Unable to send the message right now.');
  assert.match(errorMessageFor(429, texts('fr')), /Trop d'envois/);
});

// ---- Erreurs du formulaire de contact : code stable, message trop long, champs refusés ----

test('formTooLong — message « trop long » traduit', () => {
  assert.equal(t('fr', 'formTooLong'), 'Votre message est trop long.');
  assert.equal(t('en', 'formTooLong'), 'Your message is too long.');
});

test('errorMessageFor — le code de la réponse l’emporte sur le statut', () => {
  const en = { failed: t('en', 'contactError'), invalid: t('en', 'formInvalid'), rateLimited: t('en', 'formRateLimited'), tooLong: t('en', 'formTooLong') };
  assert.equal(errorMessageFor(400, en, 'rate_limited'), en.rateLimited);
  assert.equal(errorMessageFor(500, en, 'invalid_fields'), en.invalid);
  assert.equal(errorMessageFor(500, en, 'invalid_body'), en.invalid);
  assert.equal(errorMessageFor(400, en, 'too_large'), en.tooLong);
  // Code inconnu ou absent : message selon le statut
  assert.equal(errorMessageFor(429, en, 'inconnu'), en.rateLimited);
  assert.equal(errorMessageFor(400, en, 'toString'), en.invalid);
  assert.equal(errorMessageFor(413, en), en.tooLong);
  assert.equal(errorMessageFor(500, en, 'send_failed'), en.failed);
});

test('errorMessageFor — compatible avec l’ancien appel à 2 arguments et sans texte « trop long »', () => {
  const old = { failed: 'échec', invalid: 'invalide', rateLimited: 'trop' };
  assert.equal(errorMessageFor(413, old), 'échec');
  assert.equal(errorMessageFor(413, old, 'too_large'), 'échec');
  assert.equal(errorMessageFor(400, old), 'invalide');
  assert.equal(errorMessageFor(429, old), 'trop');
});

test('invalidFieldsOf — champs connus de la réponse, dans l’ordre du formulaire', () => {
  assert.deepEqual(CONTACT_FIELDS, ['name', 'email', 'message']);
  assert.deepEqual(invalidFieldsOf({ fields: ['message', 'email', 'email', 'autre'] }), ['email', 'message']);
  assert.deepEqual(invalidFieldsOf({ fields: 'email' }), []);
  assert.deepEqual(invalidFieldsOf(null), []);
  assert.deepEqual(invalidFieldsOf(undefined), []);
});
