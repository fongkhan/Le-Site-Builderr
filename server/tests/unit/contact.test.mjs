import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const contact = require('../../lib/contact.js');

const VALID = { name: 'Jean', email: 'jean@exemple.fr', message: 'Bonjour' };

test('invalidContactFields — champs refusés dans l’ordre name, email, message', () => {
  assert.deepEqual(contact.invalidContactFields(VALID), []);
  assert.deepEqual(contact.invalidContactFields({}), ['name', 'email', 'message']);
  assert.deepEqual(contact.invalidContactFields(), ['name', 'email', 'message']);
  assert.deepEqual(contact.invalidContactFields({ ...VALID, name: '   ', message: 42 }), ['name', 'message']);
  assert.deepEqual(contact.invalidContactFields({ ...VALID, email: 'a@b' }), ['email']);
  assert.deepEqual(contact.invalidContactFields({ ...VALID, email: ['a@b.fr'] }), ['email']);
});

test('invalidContactFields — limites 120 / 200 / 5000 caractères', () => {
  assert.deepEqual(contact.invalidContactFields({ ...VALID, name: 'x'.repeat(120) }), []);
  assert.deepEqual(contact.invalidContactFields({ ...VALID, name: 'x'.repeat(121) }), ['name']);
  const local = 'x'.repeat(200 - '@exemple.fr'.length);
  assert.deepEqual(contact.invalidContactFields({ ...VALID, email: `${local}@exemple.fr` }), []);
  assert.deepEqual(contact.invalidContactFields({ ...VALID, email: `x${local}@exemple.fr` }), ['email']);
  assert.deepEqual(contact.invalidContactFields({ ...VALID, message: 'x'.repeat(5000) }), []);
  assert.deepEqual(contact.invalidContactFields({ ...VALID, message: 'x'.repeat(5001) }), ['message']);
});

test('contactLang — langue connue, sinon français', () => {
  assert.equal(contact.contactLang('en'), 'en');
  assert.equal(contact.contactLang('fr'), 'fr');
  for (const raw of ['de', ['en'], undefined, null, '', 'EN', '__proto__']) assert.equal(contact.contactLang(raw), 'fr', String(raw));
});

test('CONTACT_PAGES — mêmes clés en fr et en : chaque code, sent, sent_appointment, back', () => {
  const expected = [...contact.CONTACT_ERROR_CODES, 'sent', 'sent_appointment', 'back'].sort();
  for (const lang of ['fr', 'en']) {
    assert.deepEqual(Object.keys(contact.CONTACT_PAGES[lang]).sort(), expected, lang);
    for (const key of expected) {
      const entry = contact.CONTACT_PAGES[lang][key];
      if (key === 'back') assert.ok(typeof entry === 'string' && entry.trim());
      else assert.ok(entry.title.trim() && entry.text.trim(), `${lang}.${key}`);
    }
  }
});

test('contactPage — titre, texte et lien de retour traduits ; clé inconnue : erreur générique', () => {
  assert.deepEqual(contact.contactPage('sent', 'en'), { title: 'Thank you!', text: 'Your message has been sent.', back: '← Back to the site' });
  assert.deepEqual(contact.contactPage('sent_appointment', 'fr'), { title: 'Merci !', text: 'Votre demande de rendez-vous a bien été envoyée.', back: '← Revenir au site' });
  assert.equal(contact.contactPage('rate_limited', 'de').title, 'Message non envoyé');
  assert.equal(contact.contactPage('inconnu', 'en').text, contact.CONTACT_PAGES.en.send_failed.text);
  assert.equal(contact.contactPage('back', 'en').text, contact.CONTACT_PAGES.en.send_failed.text);
  assert.equal(contact.contactPage('toString', 'fr').text, contact.CONTACT_PAGES.fr.send_failed.text);
});

test('contactErrorBody — texte français, code stable, champs seulement s’ils existent', () => {
  assert.deepEqual(contact.contactErrorBody('unknown_site'), { error: 'Site inconnu.', code: 'unknown_site' });
  assert.deepEqual(contact.contactErrorBody('invalid_fields', ['email']), { error: 'Nom, email valide et message sont requis.', code: 'invalid_fields', fields: ['email'] });
  assert.deepEqual(contact.contactErrorBody('invalid_fields', []), { error: 'Nom, email valide et message sont requis.', code: 'invalid_fields' });
  assert.equal(contact.contactErrorBody('rate_limited').error, 'Trop de messages envoyés. Réessayez dans quelques minutes.');
  assert.equal(contact.contactErrorBody('nimporte').code, 'send_failed');
});
