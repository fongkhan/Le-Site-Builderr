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

module.exports = { resolveSeedAdmin, DEFAULT_DEV_ADMIN_EMAIL };
