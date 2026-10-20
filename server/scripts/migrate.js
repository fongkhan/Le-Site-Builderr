// Migrations Payload versionnées (dossier server/migrations). Le CLI « npx payload
// migrate » ne démarre pas sur ce projet CommonJS (ERR_REQUIRE_ASYNC_MODULE) : ce script
// lancé par tsx le remplace (npm run migrate, migrate:status, migrate:create,
// migrate:check, migrate:baseline).
//
//   migrate (défaut)  applique les migrations en attente (refus sur une base de dev)
//   status            état de chaque migration
//   create <nom>      génère une migration depuis le schéma (--skip-empty : rien si inchangé)
//   check             échoue si le schéma a changé sans migration (sans base ni réseau)
//   baseline          adopte une base créée en mode développement (voir README)
require('dotenv').config();
require('../core/next-env-patch'); // avant payload

const fs = require('fs');
const path = require('path');
const { DEV_SCHEMA_MESSAGE, hasDevPushedSchema, isBenignSchemaStatement } = require('../lib/db-migrations');

const COMMANDS = ['migrate', 'status', 'create', 'check', 'baseline'];
const DEMO_ACCOUNTS = ['admin@admin.com', 'client@client.com'];

const argv = process.argv.slice(2);
const command = argv[0] || 'migrate';

function fail(message, details = []) {
  console.error(message);
  for (const line of details) console.error('  ' + line);
  process.exit(1);
}

if (!COMMANDS.includes(command)) {
  fail(`❌ [Migrations] Commande inconnue « ${command} » : utilisez ${COMMANDS.join(', ')}.`);
}

const migrationName = command === 'create' && argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
if (command === 'create' && !migrationName) fail('❌ [Migrations] Nom manquant : npm run migrate:create -- <nom>');

const offline = command === 'create' || command === 'check';
if (offline) {
  // Génération et vérification : le schéma vient de la configuration, aucune connexion
  process.env.DATABASE_URI ||= 'postgres://hors-ligne@127.0.0.1:5432/aucune';
  process.env.PAYLOAD_SECRET ||= 'verification-hors-ligne-sans-connexion';
}
// Jamais de synchronisation automatique du schéma (push) ni de rechargement à chaud ici
process.env.PAYLOAD_MIGRATING = 'true';
process.env.DISABLE_PAYLOAD_HMR = 'true';

// Dernier instantané du schéma (fichier .json écrit avec chaque migration), par nom
function latestSnapshotFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.length ? files[files.length - 1] : null;
}

async function check(payload) {
  const { generateDrizzleJson, generateMigration, upSnapshot } = payload.db.requireDrizzleKit();
  const file = latestSnapshotFile(payload.db.migrationDir);
  if (!file) fail('❌ [Migrations] Aucune migration : lancez « npm run migrate:create -- initial ».');
  let snapshot = JSON.parse(fs.readFileSync(path.join(payload.db.migrationDir, file), 'utf8'));
  const current = await generateDrizzleJson(payload.db.schema);
  if (upSnapshot && snapshot.version < current.version) snapshot = upSnapshot(snapshot);
  const statements = await generateMigration(snapshot, current);
  if (statements.length) {
    fail('❌ [Migrations] Schéma modifié sans migration : lancez « npm run migrate:create -- <nom> ».', statements);
  }
  console.log(`✔ Migrations à jour (${file})`);
}

async function baseline(payload) {
  const db = payload.db;
  if (!(await hasDevPushedSchema(db))) {
    console.log('✔ [Migrations] Rien à adopter : la base ne vient pas du mode développement.');
    return;
  }
  // Écart entre la base et le schéma de CETTE version, sans rien appliquer
  const { pushSchema } = db.requireDrizzleKit();
  const { statementsToExecute } = await pushSchema(db.schema, db.drizzle, db.schemaName ? [db.schemaName] : undefined, db.tablesFilter, undefined);
  const remaining = statementsToExecute.filter((sql) => !isBenignSchemaStatement(sql));
  const benign = statementsToExecute.length - remaining.length;
  if (benign) console.log(`ℹ️ [Migrations] ${benign} instruction(s) sans effet sur les données ignorée(s) (valeur par défaut d'une colonne).`);
  if (remaining.length) {
    fail('❌ [Migrations] La base diffère du schéma de cette version :', [
      ...remaining,
      'Démarrez une fois le serveur en développement avec CETTE version (le schéma sera synchronisé) puis relancez « npm run migrate:baseline ».',
    ]);
  }
  // Migrations versionnées marquées comme appliquées, puis marque du mode dev retirée
  const { migrations } = require('../migrations/index.ts');
  const { docs } = await payload.find({ collection: 'payload-migrations', limit: 0, depth: 0 });
  const known = new Set(docs.map((d) => d.name));
  for (const { name } of migrations) {
    if (known.has(name)) continue;
    await payload.create({ collection: 'payload-migrations', data: { name, batch: 1 } });
    console.log(`✔ [Migrations] ${name} marquée comme appliquée.`);
  }
  await db.execute({ drizzle: db.drizzle, raw: 'DELETE FROM "payload_migrations" WHERE batch = -1' });
  console.log('✔ [Migrations] Base adoptée : « npm run start:prod » appliquera les migrations suivantes.');
  const demo = await payload.find({ collection: 'users', where: { email: { in: DEMO_ACCOUNTS } }, limit: 10, depth: 0 });
  if (demo.docs.length) {
    console.warn(`⚠️ [Migrations] Comptes de démonstration présents (${demo.docs.map((u) => u.email).join(', ')}) : changez leurs mots de passe ou supprimez-les.`);
  }
}

async function main() {
  const { getPayload } = require('payload');
  const payload = await getPayload({
    config: require('../payload.config.ts').default,
    disableDBConnect: offline,
    disableOnInit: true,
  });
  if (command === 'create') {
    await payload.db.createMigration({ migrationName, payload, skipEmpty: argv.includes('--skip-empty') });
  } else if (command === 'check') {
    await check(payload);
  } else if (command === 'status') {
    await payload.db.migrateStatus();
  } else if (command === 'baseline') {
    await baseline(payload);
  } else {
    if (await hasDevPushedSchema(payload.db)) fail(DEV_SCHEMA_MESSAGE);
    await payload.db.migrate();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ [Migrations]', err.message);
  process.exit(1);
});
