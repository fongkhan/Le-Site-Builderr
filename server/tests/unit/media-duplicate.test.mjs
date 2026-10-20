import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

// Duplication d'un site : chaque image copiée garde son texte alternatif. Médiathèque
// temporaire et Payload simulé, installés AVANT le chargement de services/sites.js
// (déstructuration de UPLOADS_DIR et de getPayloadInstance).
const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'media-duplicate-'));
fs.writeFileSync(path.join(uploads, 'four.jpg'), 'F');
fs.writeFileSync(path.join(uploads, 'tasse.jpg'), 'T');
require('../../core/config.js').UPLOADS_DIR = uploads;

const creates = [];
const fakePayload = {
  async find({ collection }) {
    if (collection === 'payload_sites') return { docs: [{ id: 1 }] };
    if (collection === 'media') return { docs: [{ id: 10, filename: 'four.jpg', alt: 'Four à céramique' }, { id: 11, filename: 'tasse.jpg', alt: '' }] };
    return { docs: [] };
  },
  async create(args) {
    creates.push(args);
    return { filename: `copie-${path.basename(args.filePath)}` };
  },
};
require('../../core/payload.js').getPayloadInstance = () => fakePayload;
const { copySiteMedia } = require('../../services/sites.js');

test('copySiteMedia — le texte alternatif suit la copie de l’image', async (t) => {
  t.after(() => fs.rmSync(uploads, { recursive: true, force: true }));
  const content = { pages: [{ layout: [{ blockType: 'gallery', images: ['/api/media/file/four.jpg', '/api/media/file/tasse.jpg'] }] }] };
  const map = await copySiteMedia('source', 9, content);
  assert.deepEqual(map, { 'four.jpg': 'copie-four.jpg', 'tasse.jpg': 'copie-tasse.jpg' });
  assert.deepEqual(creates.map((c) => c.data), [{ site: 9, alt: 'Four à céramique' }, { site: 9 }]);
});
