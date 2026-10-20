import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hasDevPushedSchema, isBenignSchemaStatement, DEV_SCHEMA_MESSAGE } = require('../../lib/db-migrations.js');

// Faux adaptateur : execute renvoie des lignes selon la requête et note les requêtes
function fakeDb({ table, devRows }) {
  const queries = [];
  return {
    queries,
    drizzle: { marker: true },
    execute: async ({ drizzle, raw }) => {
      assert.deepEqual(drizzle, { marker: true });
      queries.push(raw);
      if (raw.includes('to_regclass')) return { rows: [{ rel: table ? 'payload_migrations' : null }] };
      return { rows: devRows ? [{ '?column?': 1 }] : [] };
    },
  };
}

test('hasDevPushedSchema — table payload_migrations absente (base neuve) : faux, sans autre requête', async () => {
  const db = fakeDb({ table: false });
  assert.equal(await hasDevPushedSchema(db), false);
  assert.equal(db.queries.length, 1);
});

test('hasDevPushedSchema — base migrée (aucune ligne batch -1) : faux', async () => {
  const db = fakeDb({ table: true, devRows: false });
  assert.equal(await hasDevPushedSchema(db), false);
  assert.match(db.queries[1], /WHERE batch = -1/);
});

test('hasDevPushedSchema — base de développement (ligne batch -1) : vrai', async () => {
  assert.equal(await hasDevPushedSchema(fakeDb({ table: true, devRows: true })), true);
});

test('isBenignSchemaStatement — seule la (re)pose d\'une valeur par défaut est tolérée', () => {
  assert.equal(isBenignSchemaStatement('ALTER TABLE "users" ALTER COLUMN "login_attempts" SET DEFAULT 0;'), true);
  assert.equal(isBenignSchemaStatement('  ALTER TABLE "pages" ALTER COLUMN "locale" SET DEFAULT \'fr\'  '), true);
  assert.equal(isBenignSchemaStatement('ALTER TABLE "users" ADD COLUMN "x" varchar;'), false);
  assert.equal(isBenignSchemaStatement('ALTER TABLE "users" DROP COLUMN "login_attempts";'), false);
  assert.equal(isBenignSchemaStatement('ALTER TABLE "users" ALTER COLUMN "x" DROP DEFAULT;'), false);
  assert.equal(isBenignSchemaStatement('ALTER TABLE "users" ALTER COLUMN "a" SET DEFAULT 0; DROP TABLE "users";'), false);
  assert.equal(isBenignSchemaStatement('ALTER TABLE "users" ALTER COLUMN "a" SET DEFAULT 0\nDROP TABLE "users"'), false);
  assert.equal(isBenignSchemaStatement(undefined), false);
});

test('DEV_SCHEMA_MESSAGE — indique la marche à suivre', () => {
  assert.match(DEV_SCHEMA_MESSAGE, /npm run migrate:baseline/);
  assert.match(DEV_SCHEMA_MESSAGE, /base neuve/);
});
