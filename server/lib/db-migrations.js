// Migrations Payload versionnées (server/migrations) : détection d'une base créée en mode
// développement et tolérance de la synchronisation (scripts/migrate.js, core/payload.js).

const DEV_SCHEMA_MESSAGE = '❌ [Base] Base créée en mode développement (schéma poussé automatiquement) : les migrations de production ne s\'y appliquent pas. Utilisez une base neuve, ou adoptez celle-ci avec « npm run migrate:baseline » (README, « Déployer le serveur en production »).';

const rowsOf = (result) => (result && Array.isArray(result.rows) ? result.rows : []);

// Vrai si la base porte la marque du mode développement : une ligne batch = -1 dans
// payload_migrations (écrite par Payload à chaque synchronisation automatique du schéma).
// Base neuve (table absente) ou migrée : faux.
async function hasDevPushedSchema(db) {
  const table = rowsOf(await db.execute({ drizzle: db.drizzle, raw: "SELECT to_regclass('\"payload_migrations\"') AS rel" }));
  if (!table.length || !table[0].rel) return false;
  const dev = rowsOf(await db.execute({ drizzle: db.drizzle, raw: 'SELECT 1 FROM "payload_migrations" WHERE batch = -1 LIMIT 1' }));
  return dev.length > 0;
}

// Faux positif connu de drizzle-kit sur une base déjà synchronisée : une seule
// instruction qui (re)pose la valeur par défaut d'une colonne existante, sans effet sur les
// données (ex. ALTER TABLE "users" ALTER COLUMN "login_attempts" SET DEFAULT 0;).
const BENIGN_SET_DEFAULT = /^ALTER TABLE "[^"]+" ALTER COLUMN "[^"]+" SET DEFAULT [^;\r\n]+;?$/;

function isBenignSchemaStatement(sql) {
  return typeof sql === 'string' && BENIGN_SET_DEFAULT.test(sql.trim());
}

module.exports = { DEV_SCHEMA_MESSAGE, hasDevPushedSchema, isBenignSchemaStatement };
