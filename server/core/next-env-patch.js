// Interop ESM/CJS de Next : certains modules attendent `require('@next/env').default`.
// À charger AVANT next et payload. Sans effet si le module est absent ou déjà compatible.
// Plusieurs copies coexistent : celle de Next (racine) et celle que Payload embarque
// (node_modules/payload/node_modules/@next/env, version 15.5.x) : chacune est corrigée.
const path = require('path');

const PAYLOAD_DIR = path.join(__dirname, '..', 'node_modules', 'payload');

function patchCopy(resolvePaths) {
  try {
    const resolved = require.resolve('@next/env', resolvePaths ? { paths: resolvePaths } : undefined);
    const env = require(resolved);
    if (env && !env.default) {
      require.cache[resolved] = { exports: { ...env, default: env } };
    }
    return resolved;
  } catch {
    // copie introuvable : rien à corriger
    return null;
  }
}

patchCopy();
patchCopy([PAYLOAD_DIR]);
