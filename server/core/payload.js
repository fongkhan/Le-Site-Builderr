// Instance Payload CMS partagée. Elle n'existe qu'après initPayload() (boot asynchrone) :
// les modules la lisent via getPayloadInstance() au moment de l'appel, jamais à l'import.
const { getPayload } = require('payload');
const sitesStore = require('../sites-store');
const { IS_PRODUCTION } = require('./config');
const { resolveSeedAdmin, missingAdminMessage } = require('../lib/seed');

let payloadInstance = null;

function getPayloadInstance() {
  return payloadInstance;
}

const DEFAULT_SEED_PASSWORD = 'password123';

// Comptes initiaux. Hors production : admin + client de démonstration (mots de passe
// surchargeables, utilisés par la CI). En production : seul l'admin est créé, et
// uniquement avec un SEED_ADMIN_PASSWORD explicite et robuste — jamais « password123 ».
async function seedUsers(payload) {
  try {
    // 1. Super Admin (email : SEED_ADMIN_EMAIL, obligatoire en production)
    const adminEmail = resolveSeedAdmin(process.env);
    const adminRes = adminEmail
      ? await payload.find({ collection: 'users', where: { email: { equals: adminEmail } } })
      : null;
    // Production sans SEED_ADMIN_EMAIL : aucun admin créé ici (jamais admin@admin.com) ;
    // le démarrage s'arrête ensuite s'il n'en existe aucun (missingAdminMessage).
    if (adminEmail && adminRes.docs.length === 0) {
      const adminPassword = process.env.SEED_ADMIN_PASSWORD || (IS_PRODUCTION ? '' : DEFAULT_SEED_PASSWORD);
      if (IS_PRODUCTION && (adminPassword.length < 12 || adminPassword === DEFAULT_SEED_PASSWORD)) {
        console.error(`❌ [Seeding] Aucun administrateur : définissez SEED_ADMIN_PASSWORD (12 caractères minimum) dans le .env puis redémarrez pour créer ${adminEmail}.`);
      } else {
        await payload.create({
          collection: 'users',
          data: {
            email: adminEmail,
            roles: ['admin'],
            password: adminPassword
          }
        });
        console.log(`✔ [Seeding] ${adminEmail} créé.`);
      }
    }

    // 2. Client de démonstration (hors production), rattaché au site seedé par slug
    if (IS_PRODUCTION && process.env.SEED_DEMO_CLIENT !== 'true') return;
    const clientRes = await payload.find({
      collection: 'users',
      where: { email: { equals: 'client@client.com' } }
    });
    if (clientRes.docs.length === 0) {
      const demoSite = await sitesStore.getOrCreatePayloadDoc('boulangerie-artisanale');
      await payload.create({
        collection: 'users',
        data: {
          email: 'client@client.com',
          roles: ['client'],
          sites: [demoSite.id],
          // Offre de démonstration : permet de créer d'autres sites depuis ce compte
          plan: 'pro',
          password: process.env.SEED_CLIENT_PASSWORD || DEFAULT_SEED_PASSWORD
        }
      });
      console.log("✔ [Seeding] client@client.com créé (site : boulangerie-artisanale).");
    }
  } catch (seedErr) {
    console.error("❌ [Seeding] Erreur de seeding des utilisateurs :", seedErr.message);
  }
}

async function initPayload() {
  if (process.env.DATABASE_URI) {
    try {
      const config = require('../payload.config.ts').default;
      payloadInstance = await getPayload({
        config,
      });
      console.log(`✔ [Payload CMS] Initialisé sur la base de données.`);
      // Payload devient la source de vérité : import one-way de sites.json (idempotent)
      await sitesStore.migrateFromJson();
      await seedUsers(payloadInstance);
      // Production sans aucun admin : arrêt (sinon serveur sans compte exploitable)
      const fatal = await missingAdminMessage(payloadInstance, process.env);
      if (fatal) {
        console.error(fatal);
        process.exit(1);
      }
    } catch (err) {
      console.error("❌ [Payload CMS] Erreur lors de l'initialisation :", err.message);
      // En production, un serveur sans base n'accepterait aucune connexion (503 partout) :
      // on s'arrête pour que le superviseur relance un process propre.
      if (IS_PRODUCTION && !payloadInstance) process.exit(1);
    }
  } else {
    console.log("💡 [Payload CMS] DATABASE_URI non définie dans le fichier .env. Mode simulation JSON actif.");
  }
}

module.exports = { getPayloadInstance, initPayload };
