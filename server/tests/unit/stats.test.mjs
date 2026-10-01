import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recordHit, pruneOldDays, lastNDays, total } = require('../../lib/stats.js');

test('recordHit — incrémente le jour et ne mute pas l’entrée', () => {
  const data = { '2026-01-10': 3 };
  const out = recordHit(data, '2026-01-10');
  assert.equal(out['2026-01-10'], 4);
  assert.equal(data['2026-01-10'], 3); // entrée d'origine intacte
  const fresh = recordHit({}, '2026-02-01');
  assert.equal(fresh['2026-02-01'], 1);
});

test('pruneOldDays — supprime au-delà de la rétention et les clés invalides', () => {
  const data = { '2026-01-01': 5, '2026-03-01': 2, 'pas-une-date': 9 };
  const out = pruneOldDays(data, '2026-03-10', 30);
  assert.equal(out['2026-03-01'], 2);
  assert.ok(!('2026-01-01' in out)); // trop ancien
  assert.ok(!('pas-une-date' in out)); // clé invalide ignorée
});

test('lastNDays — série continue avec zéros, du plus ancien au plus récent', () => {
  const series = lastNDays({ '2026-03-10': 4, '2026-03-08': 1 }, 3, '2026-03-10');
  assert.deepEqual(series, [
    { date: '2026-03-08', count: 1 },
    { date: '2026-03-09', count: 0 },
    { date: '2026-03-10', count: 4 },
  ]);
});

test('total — somme des visites', () => {
  assert.equal(total({ a: 2, b: 3, c: 0 }), 5);
  assert.equal(total({}), 0);
});

test('lastNDays — aucun jour sauté ni doublé au changement d’heure, quel que soit le fuseau', async () => {
  const { execFileSync } = await import('node:child_process');
  const statsPath = new URL('../../lib/stats.js', import.meta.url).pathname;
  for (const tz of ['Europe/Paris', 'Europe/London', 'America/New_York', 'UTC']) {
    const out = execFileSync(process.execPath, ['-e', `
      const { lastNDays } = require(${JSON.stringify(statsPath)});
      process.stdout.write(JSON.stringify(lastNDays({}, 120, '2026-11-15').map((d) => d.date)));
    `], { env: { ...process.env, TZ: tz } });
    const dates = JSON.parse(String(out));
    assert.equal(new Set(dates).size, 120, `${tz} : dates en double`);
    assert.equal(dates[119], '2026-11-15', tz);
    assert.equal(dates[0], '2026-07-19', tz);
  }
});
