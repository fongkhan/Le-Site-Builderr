import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DANGEROUS_URL, isDangerousUrl, validateSafeUrl, UNSAFE_LINK_MESSAGE } = require('../../lib/url-safety.js');
const { validatePagesBody, findDangerousUrl } = require('../../services/content.js');

const page = (layout) => ({ title: 'Accueil', slug: 'home', layout });

test('isDangerousUrl — schémas exécutables, casse et caractères de contrôle compris', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:x', ' \u0001java\tscript:x', 'vbscript:x', 'data:text/html;base64,PHM+', 'data : text/html,x']) {
    assert.equal(isDangerousUrl(url), true, url);
  }
});

test('isDangerousUrl — liens ordinaires et valeurs non textuelles acceptés', () => {
  for (const value of ['https://exemple.fr/javascript:x', 'data:image/png;base64,AA==', 'javascript-logo.png', null, undefined, 42]) {
    assert.equal(isDangerousUrl(value), false, String(value));
  }
  assert.ok(DANGEROUS_URL instanceof RegExp);
});

test('validateSafeUrl — format Payload : true ou message d’erreur', () => {
  for (const value of [null, undefined, '', '/cours/', 'tel:+33']) assert.equal(validateSafeUrl(value), true, String(value));
  assert.equal(validateSafeUrl('javascript:x'), UNSAFE_LINK_MESSAGE);
  assert.match(UNSAFE_LINK_MESSAGE, /Lien non autorisé/);
});

test('findDangerousUrl — le lien des boutons (ctaLink) est un champ d’URL', () => {
  assert.ok(findDangerousUrl({ ctaLink: 'javascript:alert(1)' }));
  assert.ok(findDangerousUrl({ blockType: 'pricing', plans: [{ name: 'Base', ctaText: 'Réserver', ctaLink: ' java\tscript:x' }] }));
  assert.ok(findDangerousUrl({ blockType: 'product-grid', products: [{ name: 'Bol', ctaLink: 'data:text/html,<b>' }] }));
  assert.equal(findDangerousUrl({ ctaLink: '/cours/' }), null);
});

test('validatePagesBody — ctaLink : seuls les schémas exécutables sont refusés', () => {
  // Le texte du bouton reste libre ; une saisie partielle (autosave) passe.
  assert.equal(validatePagesBody({ docs: [page([{ blockType: 'hero', ctaText: 'javascript: le guide', ctaLink: '/cours/' }])] }), null);
  assert.equal(validatePagesBody({ docs: [page([{ blockType: 'hero', ctaText: 'Réserver', ctaLink: 'https:/' }])] }), null);
  assert.match(validatePagesBody({ docs: [page([{ blockType: 'hero', ctaText: 'Réserver', ctaLink: 'javascript:alert(1)' }])] }), /Lien non autorisé/);
});

test('payload.config.ts — ctaLink validé sur la bannière, les formules et les produits', () => {
  const source = fs.readFileSync(new URL('../../payload.config.ts', import.meta.url), 'utf-8');
  const helper = source.match(/const ctaLinkField = [\s\S]*?\n\}\)/);
  assert.ok(helper, 'helper ctaLinkField introuvable');
  assert.match(helper[0], /name: 'ctaLink'/);
  // Schémas exécutables refusés, puis contrôles par défaut du type text (longueur…)
  assert.match(helper[0], /validate: \(value: unknown, options: any\) => \{\s*const safe = urlSafety\.validateSafeUrl\(value\)\s*return safe === true \? validations\.text\(value as any, options\) : safe/);
  assert.match(source, /^import urlSafety from '\.\/lib\/url-safety\.js'$/m);
  assert.match(source, /^import \{ validations \} from 'payload'$/m);
  const pages = source.slice(source.indexOf("slug: 'pages'"), source.indexOf("slug: 'posts'"));
  assert.equal(pages.match(/ctaLinkField\(\)/g)?.length, 3);
  for (const block of ['hero', 'product-grid', 'pricing']) {
    const start = pages.indexOf(`slug: '${block}'`);
    const next = pages.indexOf('slug:', start + 1);
    assert.match(pages.slice(start, next === -1 ? undefined : next), /ctaLinkField\(\)/, block);
  }
  assert.equal(source.match(/ctaLinkField\(\)/g)?.length, 3, 'aucune autre collection');
});
