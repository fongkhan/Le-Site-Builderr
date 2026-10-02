import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Payload simulé : le service lit getPayloadInstance à son chargement (déstructuration),
// il est donc remplacé AVANT de charger services/submissions.js.
const deletes = [];
let submissionDocs = [];
const fakePayload = {
  async find({ collection }) {
    if (collection === 'payload_sites') return { docs: [{ id: 7 }] };
    if (collection === 'submissions') return { docs: submissionDocs };
    return { docs: [] };
  },
  async delete(args) {
    deletes.push(args);
    return { docs: [] };
  },
};
require('../../core/payload.js').getPayloadInstance = () => fakePayload;
const { listSubmissions } = require('../../services/submissions.js');

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
const doc = (id, days) => ({ id, kind: 'contact', name: 'N', email: 'n@exemple.fr', message: 'M', read: false, createdAt: daysAgo(days) });

test('listSubmissions (base) — rétention de 12 mois appliquée à la lecture', async () => {
  submissionDocs = [doc(3, 1), doc(2, 200), doc(1, 400)];
  deletes.length = 0;
  const items = await listSubmissions('mon-site');
  assert.deepEqual(items.map((s) => s.id), ['3', '2']);
  // Message périmé supprimé en base, uniquement parmi ceux du site
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].where.and[0], { id: { in: [1] } });
  assert.deepEqual(deletes[0].where.and[1], { site: { equals: 7 } });
});

test('listSubmissions (base) — rien de périmé : aucune suppression', async () => {
  submissionDocs = [doc(5, 2), doc(4, 3)];
  deletes.length = 0;
  assert.equal((await listSubmissions('mon-site')).length, 2);
  assert.equal(deletes.length, 0);
});
