// Icône favicon.ico générée au build (sans dépendance) : carré aux coins arrondis de la
// couleur du thème, encodé en PNG (RGBA) puis placé dans un conteneur ICO. Module pur,
// testé depuis le serveur (server/tests/unit/monogram.test.mjs).
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function rgb(hex) {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(String(hex || '').trim());
  if (!m) return [0x3b, 0x82, 0xf6];
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1].slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** PNG carré (size × size) de la couleur donnée, coins arrondis (rayon en pixels) transparents. */
export function solidIconPng(hex, size = 32, radius = 7) {
  const [r, g, b] = rgb(hex);
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filtre « None »
    for (let x = 0; x < size; x++) {
      // Distance du centre du pixel au centre de l'arrondi le plus proche (hors coins : 0)
      const dx = Math.max(radius - (x + 0.5), x + 0.5 - (size - radius), 0);
      const dy = Math.max(radius - (y + 0.5), y + 0.5 - (size - radius), 0);
      const inside = dx * dx + dy * dy <= radius * radius;
      const i = y * stride + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits par canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Conteneur ICO (une image) autour d'un PNG : en-tête de 6 octets + entrée de 16 octets. */
export function icoFromPng(png, size = 32) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type : icône
  header.writeUInt16LE(1, 4); // nombre d'images
  header[6] = size >= 256 ? 0 : size; // largeur (0 = 256)
  header[7] = size >= 256 ? 0 : size; // hauteur
  header[8] = 0; // palette
  header[9] = 0; // réservé
  header.writeUInt16LE(1, 10); // plans
  header.writeUInt16LE(32, 12); // bits par pixel
  header.writeUInt32LE(png.length, 14); // taille de l'image
  header.writeUInt32LE(22, 18); // position de l'image
  return Buffer.concat([header, png]);
}
