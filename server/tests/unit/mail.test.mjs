import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Envoi sans SMTP dans un process séparé (IS_PRODUCTION est lu au chargement de config).
function sendWithoutSmtp(nodeEnv) {
  const script = `require('./core/mail').sendMail(['proprio@exemple.fr'], 'Nouveau message', 'Nom : Jean Secret\\nTéléphone : 0600000000').then(() => process.exit(0));`;
  const env = { ...process.env, NODE_ENV: nodeEnv, SMTP_HOST: '' };
  const r = spawnSync(process.execPath, ['-e', script], { cwd: serverDir, env, encoding: 'utf-8' });
  return `${r.stdout}${r.stderr}`;
}

test('sendMail sans SMTP — production : objet seul, jamais le corps ni les destinataires', () => {
  const out = sendWithoutSmtp('production');
  assert.match(out, /SMTP_HOST non configuré/);
  assert.match(out, /Nouveau message/);
  assert.doesNotMatch(out, /Jean Secret|0600000000|proprio@exemple\.fr/);
});

test('sendMail sans SMTP — développement : message complet dans la console', () => {
  const out = sendWithoutSmtp('development');
  assert.match(out, /\[Dev\] Nouveau message → proprio@exemple\.fr/);
  assert.match(out, /Jean Secret/);
});
