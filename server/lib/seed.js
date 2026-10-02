// Compte administrateur initial (seed). Hors production : admin@admin.com par défaut,
// surchargeable. En production : SEED_ADMIN_EMAIL obligatoire — un email devinable
// (admin@admin.com) facilite le verrouillage du compte par des échecs de login répétés.
const DEFAULT_DEV_ADMIN_EMAIL = 'admin@admin.com';

// Email du compte admin à créer, ou null (production sans SEED_ADMIN_EMAIL : seed refusé).
function resolveSeedAdmin(env = process.env) {
  const email = String(env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  if (email) return email;
  return env.NODE_ENV === 'production' ? null : DEFAULT_DEV_ADMIN_EMAIL;
}

// Démarrage en production sans aucun compte admin : message d'arrêt, sinon null. Un
// serveur sans admin est inexploitable (aucune création de compte possible par HTTP sans
// être connecté) : on refuse de démarrer plutôt que de tourner sans administrateur.
// Hors production (dev, CI), jamais bloquant.
async function missingAdminMessage(payload, env = process.env) {
  if (env.NODE_ENV !== 'production') return null;
  const admins = await payload.find({ collection: 'users', where: { roles: { in: ['admin'] } }, limit: 1, depth: 0, overrideAccess: true });
  if (admins.docs.length > 0) return null;
  if (!resolveSeedAdmin(env)) {
    return "❌ [Démarrage] Aucun compte administrateur et SEED_ADMIN_EMAIL manquant : définissez SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD (12 caractères minimum) dans le .env puis redémarrez.";
  }
  return `❌ [Démarrage] Aucun compte administrateur : l'admin ${resolveSeedAdmin(env)} n'a pas pu être créé. Définissez un SEED_ADMIN_PASSWORD robuste (12 caractères minimum) dans le .env puis redémarrez.`;
}

module.exports = { resolveSeedAdmin, missingAdminMessage, DEFAULT_DEV_ADMIN_EMAIL };
