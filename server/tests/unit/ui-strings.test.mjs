import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI_STRINGS, t } from '../../../client-template/src/lib/ui-strings.mjs';
import { LOCALES } from '../../../client-template/src/lib/i18n.mjs';
import { errorMessageFor } from '../../../client-template/src/components/forms/lead-status.mjs';

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
