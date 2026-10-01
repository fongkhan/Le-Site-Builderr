// Driver d'hébergement actif (simulation par défaut ; cpanel = publication réelle o2switch).
// Config invalide → échec immédiat et explicite au boot plutôt qu'en plein déploiement.
const { getHosting } = require('../lib/hosting');

let hosting;
try {
  hosting = getHosting();
} catch (hostingErr) {
  console.error(`❌ [Hébergement] ${hostingErr.message}`);
  process.exit(1);
}
console.log(`✔ [Hébergement] Driver actif : ${hosting.name}`);

module.exports = hosting;
