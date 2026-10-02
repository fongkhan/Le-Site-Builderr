import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { redactPaths, createPathRedactor, displayPath } = require('../../lib/log-redact.js');

const ROOT = '/srv/app/Le-Site-Builderr';
const MASKS = [[ROOT, '.'], ['/srv/app', '~']];

test('redactPaths — racine du projet puis dossier personnel masqués', () => {
  assert.equal(
    redactPaths(`error in ${ROOT}/client-template/src/x.astro (see /srv/app/.npm/_logs/a.log)`, MASKS),
    'error in ./client-template/src/x.astro (see ~/.npm/_logs/a.log)'
  );
  assert.equal(redactPaths(`file://${ROOT}/a`, MASKS), 'file://./a');
});

test('redactPaths — racine vide ou « / » ignorée (séparateurs intacts)', () => {
  assert.equal(redactPaths('/usr/bin/node', [['/', '.'], ['', 'x']]), '/usr/bin/node');
});

test('createPathRedactor — chemin coupé entre deux paquets masqué quand même', () => {
  const r = createPathRedactor(MASKS);
  const full = `at ${ROOT}/client-template/src/pages/index.astro:3\nfin\n`;
  let out = '';
  // Découpage à chaque position possible
  for (let cut = 0; cut <= full.length; cut++) {
    const rr = createPathRedactor(MASKS);
    const got = rr.push(full.slice(0, cut)) + rr.push(full.slice(cut)) + rr.flush();
    assert.equal(got, 'at ./client-template/src/pages/index.astro:3\nfin\n', `coupure ${cut}`);
  }
  out = r.push('progression 42%') + r.flush();
  assert.equal(out, 'progression 42%');
});

test('createPathRedactor — un début de chemin est retenu puis rendu par flush', () => {
  const r = createPathRedactor(MASKS);
  assert.equal(r.push('dossier /srv/a'), 'dossier ');
  assert.equal(r.flush(), '/srv/a');
});

test('displayPath — relatif à la racine du projet, sinon dernier segment', () => {
  assert.equal(displayPath(`${ROOT}/client-template`, ROOT), 'client-template');
  assert.equal(displayPath(`${ROOT}/simulated_public_html/demo`, ROOT), 'simulated_public_html/demo');
  assert.equal(displayPath('/var/www/demo', ROOT), 'demo');
  assert.equal(displayPath(ROOT, ROOT), 'Le-Site-Builderr');
});
