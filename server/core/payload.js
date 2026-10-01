// Instance Payload CMS partagée. Elle n'existe qu'après initPayload() (boot asynchrone) :
// les modules la lisent via getPayloadInstance() au moment de l'appel, jamais à l'import.
const { getPayload } = require('payload');
const sitesStore = require('../sites-store');

let payloadInstance = null;

function getPayloadInstance() {
  return payloadInstance;
}

async function seedUsers(payload) {
  try {
    // 1. Super Admin
    const adminRes = await payload.find({
      collection: 'users',
      where: { email: { equals: 'admin@admin.com' } }
    });
    if (adminRes.docs.length === 0) {
      await payload.create({
        collection: 'users',
        data: {
          email: 'admin@admin.com',
          roles: ['admin'],
          password: process.env.SEED_ADMIN_PASSWORD || 'password123'
        }
      });
      console.log("✔ [Seeding] admin@admin.com créé.");
    }

    // 2. Client de démonstration, rattaché au site seedé par slug (jamais par ID en dur)
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
          password: process.env.SEED_CLIENT_PASSWORD || 'password123'
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
    } catch (err) {
      console.error("❌ [Payload CMS] Erreur lors de l'initialisation :", err.message);
    }
  } else {
    console.log("💡 [Payload CMS] DATABASE_URI non définie dans le fichier .env. Mode simulation JSON actif.");
  }
}

module.exports = { getPayloadInstance, initPayload };
