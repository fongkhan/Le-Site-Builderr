// Démarrage de production : le build Next (admin Payload, API REST) doit exister.
const fs = require('fs');
const path = require('path');

// null si server/.next/BUILD_ID existe, sinon le message d'arrêt.
function missingBuildMessage(serverDir, exists = fs.existsSync) {
  if (exists(path.join(serverDir, '.next', 'BUILD_ID'))) return null;
  return '❌ [Démarrage] Build de production absent (server/.next) : lancez « npm run build » dans server/ puis redémarrez.';
}

module.exports = { missingBuildMessage };
