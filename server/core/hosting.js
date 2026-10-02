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
if (hosting.isRemote && !process.env.PUBLIC_API_URL) {
  console.warn("⚠️ [Hébergement] PUBLIC_API_URL n'est pas défini : sur les sites publiés, le formulaire de contact, la prise de RDV et les statistiques ne pourront pas joindre l'API.");
}

module.exports = hosting;
