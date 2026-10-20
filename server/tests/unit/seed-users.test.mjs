import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Seed des comptes (core/payload seedUsers) : en production, l'admin SEED_ADMIN_EMAIL n'est
// créé que si AUCUN administrateur n'existe ; un compte seed supprimé ou renommé par
// l'exploitant ne réapparaît pas au redémarrage. Hors production : recréé s'il manque.
delete process.env.DATABASE_URI;
process.env.SEED_ADMIN_EMAIL = 'ops@exemple.fr';
process.env.SEED_ADMIN_PASSWORD = 'Une-Phrase-De-Passe-Longue-42';
delete process.env.SEED_DEMO_CLIENT;
const { seedUsers } = require('../../core/payload.js');

// Faux Payload : comptes en mémoire, requêtes find limitées aux deux formes du seed.
function fakePayload(users) {
  return {
    users,
    async find({ where }) {
      if (where?.email?.equals) return { docs: users.filter((u) => u.email === where.email.equals) };
      if (where?.roles?.in) return { docs: users.filter((u) => (u.roles || []).some((r) => where.roles.in.includes(r))) };
      throw new Error(`requête inattendue : ${JSON.stringify(where)}`);
    },
    async create({ data }) {
      users.push(data);
      return data;
    },
  };
}

const quiet = async (fn) => {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.error = error; }
};

test('production, aucun administrateur : SEED_ADMIN_EMAIL créé', async () => {
  const payload = fakePayload([]);
  await quiet(() => seedUsers(payload, { production: true }));
  assert.deepEqual(payload.users.map((u) => [u.email, u.roles]), [['ops@exemple.fr', ['admin']]]);
});

test('production, compte seed supprimé mais un autre admin existe : jamais recréé', async () => {
  const payload = fakePayload([{ email: 'equipe@exemple.fr', roles: ['admin'] }]);
  await quiet(() => seedUsers(payload, { production: true }));
  assert.deepEqual(payload.users.map((u) => u.email), ['equipe@exemple.fr']);
});

test('production, compte seed déjà présent : aucune création', async () => {
  const payload = fakePayload([{ email: 'ops@exemple.fr', roles: ['admin'] }]);
  await quiet(() => seedUsers(payload, { production: true }));
  assert.equal(payload.users.length, 1);
});

test('hors production : admin recréé s’il manque (avec le client de démonstration)', async () => {
  const sitesStore = require('../../sites-store.js');
  const original = sitesStore.getOrCreatePayloadDoc;
  sitesStore.getOrCreatePayloadDoc = async () => ({ id: 7 });
  try {
    const payload = fakePayload([{ email: 'equipe@exemple.fr', roles: ['admin'] }]);
    await quiet(() => seedUsers(payload, { production: false }));
    assert.deepEqual(payload.users.map((u) => u.email).sort(), ['client@client.com', 'equipe@exemple.fr', 'ops@exemple.fr']);
  } finally {
    sitesStore.getOrCreatePayloadDoc = original;
  }
});
