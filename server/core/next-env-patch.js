// Interop ESM/CJS de Next 15 : certains modules attendent `require('@next/env').default`.
// À charger AVANT next et payload. Sans effet si le module est absent ou déjà compatible.
try {
  const env = require('@next/env');
  if (env && !env.default) {
    const wrapper = { ...env, default: env };
    require.cache[require.resolve('@next/env')] = { exports: wrapper };
  }
} catch (e) {
  // @next/env introuvable : rien à corriger
}
