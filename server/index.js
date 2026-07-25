require('dotenv').config();

// --- MONKEYPATCH FOR ESM / CJS INTEROP IN NEXT 15 ---
try {
  const env = require('@next/env');
  if (env && !env.default) {
    const wrapper = { ...env, default: env };
    require.cache[require.resolve('@next/env')] = { exports: wrapper };
  }
} catch (e) {}

const { runOnboard, runAssist } = require('./ai');
const auth = require('./auth');
const sitesStore = require('./sites-store');
const aiQuota = require('./ai-quota');
const { generateSlug, assertSafePath } = require('./lib/paths');
const { validateTheme } = require('./lib/theme');
const { getHosting } = require('./lib/hosting');
const releases = require('./lib/releases');
const seo = require('./lib/seo');
const media = require('./lib/media');
const stats = require('./lib/stats');
const domains = require('./lib/domains');
const analytics = require('./lib/analytics');
const backup = require('./lib/backup');
const dns = require('dns').promises;

// Driver d'hébergement (simulation par défaut ; cpanel = publication réelle o2switch).
// Config invalide → échec immédiat et explicite au boot plutôt qu'en plein déploiement.
let hosting;
try {
  hosting = getHosting();
} catch (hostingErr) {
  console.error(`❌ [Hébergement] ${hostingErr.message}`);
  process.exit(1);
}
console.log(`✔ [Hébergement] Driver actif : ${hosting.name}`);
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- GESTION DES ERREURS AU NIVEAU PROCESSUS ---
// Les erreurs de connexion BDD sont catchées localement (initPayload, requêtes) et ne
// remontent pas ici. Un rejet non-géré est journalisé sans tuer le process (souvent une
// promesse orpheline sans impact sur les requêtes en cours).
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Process] Rejet de promesse non-géré :', (reason && reason.stack) || (reason && reason.message) || reason);
});

// Une exception non-capturée laisse le process dans un état indéterminé. En PRODUCTION
// (build Next figé) on journalise puis on sort (le superviseur — PM2/systemd/o2switch —
// relance un process propre) : fini l'ancien « log & continue » qui masquait des bugs.
// En DEV, on tolère : Next recompile à chaud et peut lever des erreurs webpack
// transitoires pendant le warmup qui ne doivent pas tuer le serveur.
process.on('uncaughtException', (err) => {
  if (process.env.NODE_ENV === 'production') {
    console.error('💥 [Process] Exception non-capturée — arrêt du process :', (err && err.stack) || err);
    process.exit(1);
  }
  console.error('⚠️ [Process] Exception non-capturée (tolérée en dev) :', (err && err.stack) || err);
});

const next = require('next');
const { getPayload } = require('payload');

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev, dir: __dirname });
const handle = nextApp.getRequestHandler();

const app = express();

// Derrière un reverse-proxy (o2switch/nginx), faire confiance au proxy pour déduire
// l'IP client réelle (utilisée par le rate-limit). Conditionné par env : en dev/CI on ne
// fait PAS confiance (sinon X-Forwarded-For serait usurpable pour contourner la limite).
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

app.use(cors({
  origin: (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim()),
  credentials: true
}));

// En-têtes de sécurité HTTP. CSP désactivée : elle casserait l'admin Payload (Next) et
// les assets injectés ; CORP désactivée car l'orchestrateur est servi sur une autre
// origine en dev. Le reste (nosniff, frameguard, HSTS…) est conservé. CORS monté avant
// pour que même les réponses 429 du rate-limit portent les en-têtes cross-origin.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

// --- Limiteurs de débit (anti brute-force / anti-abus) ---
// Montés AVANT le catch-all Next : sur succès ils appellent next() et laissent
// Next/Payload traiter la requête (flux intact) ; au-delà du seuil ils renvoient 429 JSON.
const RL_WINDOW_MS = 15 * 60 * 1000;
const makeLimiter = (limit, message, extra = {}) => rateLimit({
  windowMs: RL_WINDOW_MS,
  limit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: message }),
  ...extra,
});
// Login : ne compte QUE les échecs (skipSuccessfulRequests) — un usage légitime ne
// consomme jamais le budget ; seules les tentatives ratées (brute-force) comptent.
const loginLimiter = makeLimiter(
  Number.parseInt(process.env.RL_LOGIN_MAX ?? '', 10) || 8,
  "Trop de tentatives de connexion échouées. Réessayez dans quelques minutes.",
  { skipSuccessfulRequests: true }
);
const onboardLimiter = makeLimiter(30, "Trop de générations demandées. Réessayez dans quelques minutes.");
const webhookLimiter = makeLimiter(60, "Trop de requêtes de build reçues. Réessayez plus tard.");
const contactLimiter = makeLimiter(10, "Trop de messages envoyés. Réessayez dans quelques minutes.");
// Beacon de stats : public, appelé une fois par page vue. Plafond généreux (une même
// IP peut porter plusieurs visiteurs derrière un NAT) mais borné contre le flood.
const statsLimiter = makeLimiter(120, "Trop de requêtes.");
// Domaine personnalisé : chaque appel peut déclencher une requête DNS et un appel cPanel.
// Admin only, mais on borne quand même contre les boucles/abus.
const domainLimiter = makeLimiter(30, "Trop d'opérations sur le domaine. Réessayez dans quelques minutes.");
app.use('/api/users/login', loginLimiter); // route servie par Next → le limiter next() vers elle
app.use('/api/onboard', onboardLimiter);
app.use('/webhook/rebuild', webhookLimiter);
app.use('/api/contact', contactLimiter);
app.use('/api/stats', statsLimiter);
// Le parsing JSON ne s'applique QU'AUX routes Express custom : les routes déléguées à
// Next/Payload (login, REST Payload, /admin) doivent recevoir leur flux de requête intact.
const jsonParser = express.json({ limit: '10mb' });
const EXPRESS_ROUTE_PREFIXES = ['/api/sites', '/api/site-pages', '/api/site-posts', '/api/theme', '/api/config', '/api/onboard', '/api/build-status', '/api/hosting', '/api/contact', '/api/ai', '/api/stats', '/api/admin', '/webhook', '/internal'];
app.use((req, res, next) => {
  const handledByExpress = EXPRESS_ROUTE_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'));
  if (!handledByExpress) return next();
  jsonParser(req, res, next);
});

// Jeton interne régénéré à chaque boot : seul le process de build Astro le reçoit (via env)
const BUILD_TOKEN = crypto.randomBytes(24).toString('hex');

// Réponse d'erreur serveur : le détail (message, stack) est loggé côté serveur mais
// jamais renvoyé au réseau — le client reçoit un message générique. Réservé aux 500 ;
// les 400/403/404 métier conservent leur message explicite volontairement.
function sendError(res, publicMsg, err, status = 500) {
  console.error(`❌ [${status}] ${publicMsg} —`, (err && (err.stack || err.message)) || err);
  if (!res.headersSent) res.status(status).json({ error: publicMsg });
}

// Journal d'audit des actions sensibles (collection audit_logs, admin only en lecture).
// Fire-and-forget : l'audit n'échoue jamais une requête métier.
function logAudit(req, action, target, details = '') {
  if (!payloadInstance) return;
  payloadInstance
    .create({
      collection: 'audit_logs',
      data: {
        action,
        actor: (req && req.user && req.user.email) || 'système',
        target: String(target || ''),
        details: String(details || '').slice(0, 1000),
      },
      overrideAccess: true,
    })
    .catch((e) => console.error('Audit non enregistré :', e.message));
}

if (auth.DEV_NO_AUTH) {
  console.warn('⚠️⚠️⚠️  [Sécurité] DEV_NO_AUTH=true : TOUTES les requêtes sont traitées comme un admin. À ne JAMAIS utiliser en production. ⚠️⚠️⚠️');
}

// Debug logger middleware
app.use((req, res, next) => {
  if (req.url.includes('NaN') || req.url.includes('api')) {
    console.log(`🔍 [HTTP] ${req.method} ${req.url}`);
  }
  next();
});

// --- INITIALISATION CONDITIONNELLE DE PAYLOAD CMS V3 ---
let payloadInstance = null;
auth.init(() => payloadInstance);

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
      const config = require('./payload.config.ts').default;
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

// Dossier de données et chemins
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const LOGS_FILE = path.join(DATA_DIR, 'build-logs.txt');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
sitesStore.init({ getPayload: () => payloadInstance, sitesFile: SITES_FILE });

const ASTRO_PROJECT_DIR = path.resolve(__dirname, '../client-template');
const DIST_DIR = path.join(ASTRO_PROJECT_DIR, 'dist');
const PUBLIC_HTML_DIR = path.resolve(__dirname, '../simulated_public_html');
// Racine des dépôts de sources provisionnés (cohérent avec l'onboarding)
const REPOSITORIES_DIR = path.resolve(path.dirname(PUBLIC_HTML_DIR), 'repositories');
// Versions de déploiement conservées pour rollback (N dernières par site)
const RELEASES_DIR = path.resolve(path.dirname(PUBLIC_HTML_DIR), 'releases');
// Fichiers de la médiathèque (collection Payload « media », staticDir)
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DEPLOY_KEEP_RELEASES = Number.parseInt(process.env.DEPLOY_KEEP_RELEASES ?? '', 10) || 3;
// Sauvegardes automatiques (contenu des sites : pages/thème/articles)
const BACKUPS_DIR = path.resolve(path.dirname(PUBLIC_HTML_DIR), 'backups');
const BACKUP_KEEP = Number.parseInt(process.env.BACKUP_KEEP ?? '', 10) || 14;
const BACKUP_INTERVAL_HOURS = Number.parseInt(process.env.BACKUP_INTERVAL_HOURS ?? '', 10) || 24;
const BACKUP_ENABLED = process.env.BACKUP_ENABLED === 'true';
const LOCK_FILE = path.join(ASTRO_PROJECT_DIR, 'build.lock');

// Domaine attribué à un site à sa création.
// - simulation : motif fictif historique <slug>.o2switch.site (ou domaine fourni).
// - cpanel : sous-domaine RÉEL <slug>.<rootDomain> créé via l'API (idempotent) ; un
//   domaine explicitement fourni est respecté (domaine custom déjà configuré côté
//   cPanel), sauf s'il s'agit du motif fictif hérité d'un scan.
async function resolveSiteDomain(slug, explicitDomain) {
  const isFakePattern = typeof explicitDomain === 'string' && explicitDomain.endsWith('.o2switch.site');
  if (explicitDomain && !isFakePattern) return explicitDomain;
  if (!hosting.isRemote) return explicitDomain || `${slug}.o2switch.site`;
  const { domain, created } = await hosting.ensureSubdomain(slug);
  if (created) {
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Sous-domaine cPanel créé : ${domain}\n`);
  }
  return domain;
}

// SSL initial : fictivement actif en simulation ; en cpanel, AutoSSL doit d'abord
// émettre le certificat (statut rafraîchi au premier déploiement).
function initialSslStatus() {
  return hosting.isRemote ? 'pending' : 'active';
}

// Confine documentRoot/repositoryPath fournis par le client sous leurs racines autorisées.
// Renvoie true si OK, sinon envoie une 400 et renvoie false (l'appelant doit s'arrêter).
// Un chemin arbitraire (ex. "/etc") deviendrait la cible de fs.rmSync au build/delete.
function ensureConfinedPaths(res, { documentRoot, repositoryPath }) {
  try {
    if (documentRoot) assertSafePath(documentRoot, PUBLIC_HTML_DIR);
    if (repositoryPath) assertSafePath(repositoryPath, REPOSITORIES_DIR);
    return true;
  } catch (e) {
    res.status(400).json({ error: "Chemin non autorisé : le dossier doit rester dans le périmètre du projet." });
    return false;
  }
}

// Le dossier de production simulé doit exister dès le boot (le scan par défaut le cible,
// et il n'est créé par aucun autre chemin avant le premier déploiement)
if (!fs.existsSync(PUBLIC_HTML_DIR)) {
  fs.mkdirSync(PUBLIC_HTML_DIR, { recursive: true });
}

// Serve generated websites statically under /preview/<slug>/
// (le préfixe /sites est réservé aux routes du dashboard React)
app.use('/preview', express.static(PUBLIC_HTML_DIR));

// Helper functions for dynamic multi-site path handling
function getSitePagesFile(slug) {
  return path.join(DATA_DIR, `site_${slug}_pages.json`);
}

function getSiteThemeFile(slug) {
  return path.join(DATA_DIR, `site_${slug}_theme.json`);
}

function getSiteStatsFile(slug) {
  return path.join(DATA_DIR, `stats_${slug}.json`);
}

function provisionRepository(repoPath) {
  if (repoPath && !fs.existsSync(repoPath)) {
    try {
      fs.mkdirSync(repoPath, { recursive: true });
      // Copier le client-template localement pour que l'utilisateur ait le code source complet du site client sans Git
      fs.cpSync(ASTRO_PROJECT_DIR, repoPath, {
        recursive: true,
        filter: (src) => {
          // Ne pas copier node_modules, .astro, dist ou .git
          const base = path.basename(src);
          return base !== 'node_modules' && base !== '.astro' && base !== 'dist' && base !== '.git';
        }
      });
      console.log(`[Provisioning] Dépôt local copié sans Git dans : ${repoPath}`);
    } catch (err) {
      console.error(`[Provisioning] Erreur de copie du dépôt local : ${err.message}`);
    }
  }
}

// Initialiser les structures par défaut
const defaultPages = {
  docs: [
    {
      title: "Accueil",
      slug: "home",
      layout: [
        {
          blockType: "hero",
          title: "Boulangerie Artisanale Clamart",
          subtitle: "Des pains croustillants et des viennoiseries pur beurre cuits sur place tous les jours.",
          ctaText: "Découvrir nos produits",
          backgroundImage: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&q=80&w=1200"
        },
        {
          blockType: "features",
          title: "Pourquoi choisir notre boulangerie ?",
          items: [
            { title: "Farines Bio", description: "Nous sélectionnons uniquement des farines certifiées biologiques et locales." },
            { title: "Savoir-faire", description: "Nos boulangers respectent des méthodes de fermentation lente sur levain naturel." },
            { title: "Chaque matin", description: "Cuisson tout au long de la journée pour vous garantir une fraîcheur optimale." }
          ]
        },
        {
          blockType: "product-grid",
          title: "Nos Produits Vedettes",
          products: [
            { name: "La Baguette de Tradition", price: "1.30 €", image: "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&q=80&w=400" },
            { name: "Le Croissant Pur Beurre", price: "1.20 €", image: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&q=80&w=400" },
            { name: "Le Pain au Chocolat", price: "1.30 €", image: "https://images.unsplash.com/photo-1608686207856-001b95cf60ca?auto=format&fit=crop&q=80&w=400" }
          ]
        },
        {
          blockType: "testimonials",
          title: "Ce que nos clients disent",
          testimonials: [
            { quote: "Le meilleur pain de la région ! Croustillant et savoureux.", author: "Marie Dupont", role: "Cliente régulière", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150" },
            { quote: "Des viennoiseries au vrai goût de beurre. Un régal chaque matin.", author: "Jean Martin", role: "Habitant de Clamart", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150" }
          ]
        },
        {
          blockType: "faq",
          title: "Questions Fréquentes",
          items: [
            { question: "Proposez-vous des produits sans gluten ?", answer: "Nous fabriquons principalement des pains au levain traditionnel contenant du gluten, mais nous avons une gamme de gâteaux sans farine de blé." },
            { question: "Quels sont vos horaires de cuisson ?", answer: "Nos fournées ont lieu à 7h00, 11h30 et 16h30 pour vous garantir du pain chaud toute la journée." }
          ]
        },
        {
          blockType: "pricing",
          title: "Nos Formules Petit-Déjeuner",
          plans: [
            { name: "Formule Matin", price: "4.50 €", description: "Pour bien commencer la journée.", features: [{ feature: "1 Viennoiserie" }, { feature: "1 Café ou Thé" }, { feature: "1/2 Baguette beurre" }], ctaText: "Commander", isPopular: false },
            { name: "Formule Brunch", price: "12.50 €", description: "Le week-end ou pour les gourmands.", features: [{ feature: "2 Viennoiseries" }, { feature: "1 Jus de fruits frais" }, { feature: "1 Pain chaud au choix" }, { feature: "Assiette jambon-fromage" }], ctaText: "Réserver", isPopular: true }
          ]
        }
      ]
    }
  ]
};

const defaultTheme = {
  theme: {
    colors: {
      primary: "#8B5A2B",
      secondary: "#F5E6CC",
      background: "#FAFAFA",
      text: "#2D241E"
    },
    fonts: {
      heading: "Playfair Display",
      body: "Inter"
    },
    radius: "12px"
  }
};

// Seeding logic for multi-site database
if (!fs.existsSync(SITES_FILE)) {
  const seededSites = [
    {
      slug: "boulangerie-artisanale",
      name: "Boulangerie Artisanale Clamart",
      domain: "boulangerie-clamart.o2switch.site",
      documentRoot: path.join(PUBLIC_HTML_DIR, 'boulangerie-artisanale').replace(/\\/g, '/'),
      repositoryPath: "",
      stack: "Astro SSG + Payload CMS",
      createdWithTool: true,
      status: "draft",
      sslStatus: "active"
    }
  ];
  fs.writeFileSync(SITES_FILE, JSON.stringify(seededSites, null, 2), 'utf-8');
}

// Réécrit les fichiers de pages/thème du site seedé s'ils sont absents ou vides/corrompus
function isUsableJsonFile(filePath, validate) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return validate(parsed);
  } catch (e) {
    return false;
  }
}
if (!isUsableJsonFile(getSitePagesFile('boulangerie-artisanale'), (p) => Array.isArray(p.docs) && p.docs.length > 0)) {
  fs.writeFileSync(getSitePagesFile('boulangerie-artisanale'), JSON.stringify(defaultPages, null, 2), 'utf-8');
}
if (!isUsableJsonFile(getSiteThemeFile('boulangerie-artisanale'), (t) => Boolean(t.theme && t.theme.colors))) {
  fs.writeFileSync(getSiteThemeFile('boulangerie-artisanale'), JSON.stringify(defaultTheme, null, 2), 'utf-8');
}

// Global variable to track active build site slug (for dynamic pages routing fallback during Astro build)
let activeBuildingSite = null;

async function getSiteFromRequest(req) {
  if (req.query.site) return req.query.site;
  if (activeBuildingSite) return activeBuildingSite;
  // Fallback to first site in database
  try {
    const sites = await sitesStore.listSites();
    if (sites.length > 0) return sites[0].slug;
  } catch (e) {}
  return 'boulangerie-artisanale';
}

// Fonction pour synchroniser le thème JSON vers le fichier CSS Astro
function writeThemeCss(themeData) {
  // Défense en profondeur : un siteThemeFile corrompu ou légué (antérieur à la
  // validation d'entrée) ne doit jamais injecter de CSS ni casser le build.
  const candidate = themeData && themeData.theme;
  const t = validateTheme(candidate).ok ? candidate : defaultTheme.theme;
  const cssContent = `/* Généré automatiquement par l'Orchestrateur */
:root {
  --color-primary: ${t.colors.primary};
  --color-secondary: ${t.colors.secondary};
  --color-bg: ${t.colors.background};
  --color-text: ${t.colors.text};
  --font-heading: '${t.fonts.heading}', serif;
  --font-body: '${t.fonts.body}', sans-serif;
  --border-radius: ${t.radius};
}
`;
  const cssDir = path.join(ASTRO_PROJECT_DIR, 'src/styles');
  if (!fs.existsSync(cssDir)) {
    fs.mkdirSync(cssDir, { recursive: true });
  }
  fs.writeFileSync(path.join(cssDir, 'theme.css'), cssContent, 'utf-8');
}

// Initialize template theme.css with default
writeThemeCss(defaultTheme);

// Lecture des pages d'un site : Payload d'abord, fallback JSON (partagé entre l'API
// authentifiée et le canal interne de build)
async function readSitePages(siteSlug) {
  if (payloadInstance) {
    try {
      const siteRes = await payloadInstance.find({
        collection: 'payload_sites',
        where: { slug: { equals: siteSlug } },
        limit: 1,
        overrideAccess: true
      });
      if (siteRes.docs.length > 0) {
        const siteId = siteRes.docs[0].id;
        const pagesRes = await payloadInstance.find({
          collection: 'pages',
          where: { site: { equals: siteId } },
          overrideAccess: true
        });
        if (pagesRes.docs.length > 0) {
          return {
            docs: pagesRes.docs.map(page => ({
              title: page.title,
              slug: page.slug,
              metaTitle: page.metaTitle || undefined,
              metaDescription: page.metaDescription || undefined,
              layout: page.layout ? page.layout.map(block => {
                const { id, ...fields } = block;
                if (block.blockType === 'gallery' && fields.images) {
                  fields.images = fields.images.map(img => typeof img === 'object' && img !== null ? img.url : img);
                }
                return {
                  blockType: block.blockType,
                  ...fields
                };
              }) : []
            }))
          };
        }
      }
    } catch (dbError) {
      console.error("Erreur lecture pages de Payload, fallback JSON:", dbError.message);
    }
  }

  const sitePagesFile = getSitePagesFile(siteSlug);
  if (!fs.existsSync(sitePagesFile)) {
    return defaultPages;
  }
  try {
    return JSON.parse(fs.readFileSync(sitePagesFile, 'utf-8'));
  } catch (e) {
    console.error(`Fichier de pages corrompu pour ${siteSlug}, fallback par défaut :`, e.message);
    return defaultPages;
  }
}

// --- Blog / actualités : articles par site ---
function getSitePostsFile(slug) {
  return path.join(DATA_DIR, `posts_${slug}.json`);
}

function normalizePost(p) {
  return {
    title: p.title || '',
    slug: p.slug || '',
    excerpt: p.excerpt || '',
    coverImage: p.coverImage || '',
    body: p.body || '',
    tags: p.tags || '',
    publishedAt: p.publishedAt || null,
    status: p.status === 'published' ? 'published' : 'draft',
  };
}

// Lit les articles d'un site. Payload prioritaire ; repli sur le fichier JSON.
// publishedOnly=true → uniquement les articles publiés (pour le build public).
async function readSitePosts(siteSlug, { publishedOnly = false } = {}) {
  if (payloadInstance) {
    try {
      const siteRes = await payloadInstance.find({
        collection: 'payload_sites', where: { slug: { equals: siteSlug } }, limit: 1, overrideAccess: true,
      });
      if (siteRes.docs.length > 0) {
        const where = { and: [{ site: { equals: siteRes.docs[0].id } }] };
        if (publishedOnly) where.and.push({ status: { equals: 'published' } });
        const postsRes = await payloadInstance.find({
          collection: 'posts', where, sort: '-publishedAt', limit: 500, overrideAccess: true,
        });
        return { docs: postsRes.docs.map(normalizePost) };
      }
    } catch (dbError) {
      console.error('Erreur lecture posts de Payload, fallback JSON :', dbError.message);
    }
  }
  const file = getSitePostsFile(siteSlug);
  let docs = [];
  try { docs = (JSON.parse(fs.readFileSync(file, 'utf-8')).docs || []).map(normalizePost); } catch { docs = []; }
  if (publishedOnly) docs = docs.filter((p) => p.status === 'published');
  return { docs };
}

// --- MULTI-SITE CPANEL ENDPOINTS ---

// List sites: un admin voit tout, un client uniquement ses sites
app.get('/api/sites', auth.authenticate, auth.requireAuth, async (req, res) => {
  try {
    let sites = await sitesStore.listSites();
    if (!auth.isAdmin(req.user)) {
      sites = sites.filter(s => req.userSiteSlugs.has(s.slug));
    }
    res.json(sites);
  } catch (e) {
    sendError(res, "Impossible de lire la liste des sites.", e);
  }
});

// Carte { slug: [emails] } des propriétaires de sites (jointure users.sites → slug).
// Partagée entre l'endpoint owners et les notifications de fin de build.
async function getSiteOwnersMap() {
  if (!payloadInstance) return {};
  // depth:1 peuple la relation users.sites (on récupère le slug de chaque site)
  const usersRes = await payloadInstance.find({ collection: 'users', depth: 1, limit: 1000, overrideAccess: true });
  const owners = {};
  for (const u of usersRes.docs) {
    for (const site of (u.sites || [])) {
      const slug = site && typeof site === 'object' ? site.slug : null;
      if (!slug) continue;
      (owners[slug] ||= []).push(u.email);
    }
  }
  return owners;
}

// Emails des propriétaires d'UN seul site. Contrairement à getSiteOwnersMap (qui balaie
// toute la collection users), on filtre côté base sur la relation users.sites → adapté
// aux chemins fréquents/publics (formulaire de contact, notifications de build) sans
// charger tous les comptes. Lecture sans effet de bord (jamais de création implicite).
async function getSiteOwners(slug) {
  if (!payloadInstance || !slug) return [];
  const siteRes = await payloadInstance.find({
    collection: 'payload_sites',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  const siteId = siteRes.docs[0]?.id;
  if (!siteId) return [];
  const usersRes = await payloadInstance.find({
    collection: 'users',
    where: { sites: { in: [siteId] } },
    depth: 0,
    limit: 1000,
    overrideAccess: true,
  });
  return usersRes.docs.map((u) => u.email).filter(Boolean);
}

// Propriétaires de chaque site (admin only) : { slug: [emails] }. Déclaré AVANT toute
// route paramétrée /api/sites/:xxx pour éviter toute collision de matching Express.
app.get('/api/sites/owners', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    res.json(await getSiteOwnersMap());
  } catch (e) {
    sendError(res, "Impossible de lire les propriétaires des sites.", e);
  }
});

// Vue d'ensemble multi-sites (admin) : statut, domaine/SSL et visites agrégées par site.
app.get('/api/admin/overview', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const sites = await sitesStore.listSites();
    const rows = sites.map((s) => {
      let statsData = {};
      try { statsData = JSON.parse(fs.readFileSync(getSiteStatsFile(s.slug), 'utf-8')); } catch { statsData = {}; }
      const series = stats.lastNDays(statsData, 30);
      return {
        slug: s.slug,
        name: s.name,
        domain: s.domain,
        status: s.status,
        sslStatus: s.sslStatus,
        domainStatus: s.domainStatus || 'none',
        customDomain: s.customDomain || '',
        visitsTotal: stats.total(statsData),
        visits30: series.reduce((sum, d) => sum + d.count, 0),
        series: series.map((d) => d.count),
      };
    });
    const totals = {
      sites: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      visits30: rows.reduce((sum, r) => sum + r.visits30, 0),
      customDomains: rows.filter((r) => r.domainStatus === 'active').length,
    };
    res.json({ totals, sites: rows });
  } catch (e) {
    sendError(res, "Impossible de charger la vue d'ensemble.", e);
  }
});

// --- Sauvegardes automatiques du contenu (pages/thème/articles de tous les sites) ---

let backupInProgress = false;

// Crée une archive zip de tout le contenu et applique la rétention. Renvoie le nom de fichier.
async function createBackupArchive() {
  if (backupInProgress) return null;
  backupInProgress = true;
  try {
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const archiver = require('archiver');
    const filename = backup.backupFilename(new Date());
    const dest = path.join(BACKUPS_DIR, filename);
    const sites = await sitesStore.listSites();

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(dest);
      const archive = archiver('zip', { zlib: { level: 6 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.append(JSON.stringify({ createdAt: new Date().toISOString(), sites: sites.map((s) => s.slug) }, null, 2), { name: 'manifest.json' });
      // Un dossier par site : pages, thème, articles.
      (async () => {
        for (const s of sites) {
          const base = `sites/${s.slug}`;
          try { archive.append(JSON.stringify(await readSitePages(s.slug), null, 2), { name: `${base}/pages.json` }); } catch { /* ignore */ }
          try { archive.append(JSON.stringify(await readSitePosts(s.slug), null, 2), { name: `${base}/posts.json` }); } catch { /* ignore */ }
          const themeFile = getSiteThemeFile(s.slug);
          if (fs.existsSync(themeFile)) archive.file(themeFile, { name: `${base}/theme.json` });
        }
        archive.finalize();
      })().catch(reject);
    });

    // Rétention : ne garder que les BACKUP_KEEP plus récentes.
    let names = [];
    try { names = fs.readdirSync(BACKUPS_DIR); } catch { names = []; }
    for (const old of backup.selectBackupsToDelete(names, BACKUP_KEEP)) {
      try { fs.rmSync(path.join(BACKUPS_DIR, old), { force: true }); } catch { /* ignore */ }
    }
    return filename;
  } finally {
    backupInProgress = false;
  }
}

// Liste des sauvegardes (admin) + configuration courante.
app.get('/api/admin/backups', auth.authenticate, auth.requireAdmin, (req, res) => {
  try {
    let items = [];
    if (fs.existsSync(BACKUPS_DIR)) {
      items = fs.readdirSync(BACKUPS_DIR)
        .filter(backup.isValidBackupName)
        .map((name) => {
          const st = fs.statSync(path.join(BACKUPS_DIR, name));
          return { name, size: st.size, createdAt: st.mtime.toISOString() };
        })
        .sort((a, b) => b.name.localeCompare(a.name));
    }
    res.json({
      config: { enabled: BACKUP_ENABLED, intervalHours: BACKUP_INTERVAL_HOURS, keep: BACKUP_KEEP },
      backups: items,
    });
  } catch (e) {
    sendError(res, "Impossible de lister les sauvegardes.", e);
  }
});

// Déclenche une sauvegarde immédiate (admin).
app.post('/api/admin/backups', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const filename = await createBackupArchive();
    if (!filename) return res.status(409).json({ error: "Une sauvegarde est déjà en cours." });
    logAudit(req, 'sauvegarde.creation', 'global', filename);
    res.json({ success: true, filename });
  } catch (e) {
    sendError(res, "Échec de la sauvegarde.", e);
  }
});

// Téléchargement d'une sauvegarde (admin) — nom strictement validé (anti-traversée).
app.get('/api/admin/backups/download', auth.authenticate, auth.requireAdmin, (req, res) => {
  const name = req.query.name;
  if (!backup.isValidBackupName(name)) return res.status(400).json({ error: "Nom de sauvegarde invalide." });
  const file = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Sauvegarde introuvable." });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  fs.createReadStream(file).pipe(res);
});

// Create manual site (admin uniquement)
app.post('/api/sites', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { name, domain, stack, documentRoot, repositoryPath } = req.body;
  if (!name) return res.status(400).json({ error: "Le nom du site est requis." });

  const slug = generateSlug(name);
  if (!slug) return res.status(400).json({ error: "Nom de site invalide : au moins un caractère alphanumérique est requis." });
  if (!ensureConfinedPaths(res, { documentRoot, repositoryPath })) return;

  try {
    if (await sitesStore.getSiteBySlug(slug)) {
      return res.status(400).json({ error: "Un site avec ce nom/slug existe déjà." });
    }

    const newSite = await sitesStore.createSite({
      slug,
      name,
      domain: await resolveSiteDomain(slug, domain),
      documentRoot: (documentRoot || path.join(PUBLIC_HTML_DIR, slug)).replace(/\\/g, '/'),
      repositoryPath: (repositoryPath || "").replace(/\\/g, '/'),
      stack: stack || "Astro SSG",
      createdWithTool: true,
      status: "draft",
      sslStatus: initialSslStatus()
    });

    // Provision local files repository without Git
    provisionRepository(newSite.repositoryPath);

    // Initialize config files for this site
    fs.writeFileSync(getSitePagesFile(slug), JSON.stringify(defaultPages, null, 2), 'utf-8');
    fs.writeFileSync(getSiteThemeFile(slug), JSON.stringify(defaultTheme, null, 2), 'utf-8');

    logAudit(req, 'site.creation', slug, `nom=${name}`);
    res.json({ success: true, site: newSite });
  } catch (e) {
    sendError(res, "Impossible de créer le site.", e);
  }
});

// Update manual site metadata (admin uniquement)
app.put('/api/sites/:slug', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const { name, domain, documentRoot, repositoryPath, stack, sslStatus, status, analyticsProvider, analyticsId, analyticsHost } = req.body;

  if (!ensureConfinedPaths(res, { documentRoot, repositoryPath })) return;

  // Mesure d'audience : validation stricte (ces valeurs finissent dans les pages publiées)
  let analyticsChanges = {};
  if (analyticsProvider !== undefined || analyticsId !== undefined || analyticsHost !== undefined) {
    const current = await sitesStore.getSiteBySlug(slug);
    if (!current) return res.status(404).json({ error: "Site non trouvé." });
    const checked = analytics.validateAnalytics({
      provider: analyticsProvider !== undefined ? analyticsProvider : current.analyticsProvider,
      id: analyticsId !== undefined ? analyticsId : current.analyticsId,
      host: analyticsHost !== undefined ? analyticsHost : current.analyticsHost,
    });
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    analyticsChanges = checked.value;
  }

  try {
    const site = await sitesStore.updateSite(slug, {
      name: name || undefined,
      domain: domain || undefined,
      documentRoot: documentRoot ? documentRoot.replace(/\\/g, '/') : undefined,
      repositoryPath: repositoryPath !== undefined ? (repositoryPath ? repositoryPath.replace(/\\/g, '/') : "") : undefined,
      stack: stack || undefined,
      sslStatus: sslStatus || undefined,
      status: status || undefined,
      ...analyticsChanges
    });
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    res.json({ success: true, site });
  } catch (e) {
    sendError(res, "Impossible de mettre à jour le site.", e);
  }
});

// Delete site (admin uniquement — supprime aussi les fichiers si demandé)
app.delete('/api/sites/:slug', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const deleteFiles = req.query.deleteFiles === 'true';

  try {
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) {
      return res.status(404).json({ error: "Site non trouvé." });
    }

    // La suppression Payload nettoie aussi pages/themes rattachés et la relation users.sites
    await sitesStore.deleteSite(slug);

    // Delete site configurations (fichiers JSON de fallback)
    const pagesFile = getSitePagesFile(slug);
    const themeFile = getSiteThemeFile(slug);
    if (fs.existsSync(pagesFile)) fs.unlinkSync(pagesFile);
    if (fs.existsSync(themeFile)) fs.unlinkSync(themeFile);

    // Delete site build directory
    if (deleteFiles && site.documentRoot && fs.existsSync(site.documentRoot)) {
      fs.rmSync(site.documentRoot, { recursive: true, force: true });
    }

    logAudit(req, 'site.suppression', req.params.slug, `fichiers=${Boolean(deleteFiles)}`);
    res.json({ success: true, message: "Site supprimé avec succès." });
  } catch (e) {
    sendError(res, "Impossible de supprimer le site.", e);
  }
});

// Scan folder for unregistered sites (admin uniquement — accède au filesystem serveur)
app.post('/api/sites/scan', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const scanPath = req.body.scanPath || req.query.scanPath || PUBLIC_HTML_DIR;

  try {
    const sites = await sitesStore.listSites();
    const registeredRoots = sites.filter(s => s.documentRoot).map(s => path.resolve(s.documentRoot).toLowerCase());
    const registeredRepos = sites.filter(s => s.repositoryPath).map(s => path.resolve(s.repositoryPath).toLowerCase());

    // Les chemins relatifs sont résolus depuis la racine du projet (pas depuis server/)
    const targetDir = path.isAbsolute(scanPath)
      ? path.resolve(scanPath)
      : path.resolve(path.dirname(__dirname), scanPath);
    if (!fs.existsSync(targetDir)) {
      return res.status(400).json({ error: `Le chemin spécifié n'existe pas : ${targetDir}` });
    }

    const dirs = fs.readdirSync(targetDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const scanned = [];
    for (const dirName of dirs) {
      const dirPath = path.join(targetDir, dirName);
      const resolvedPath = path.resolve(dirPath);
      
      // Skip folders already registered
      if (registeredRoots.includes(resolvedPath.toLowerCase()) || registeredRepos.includes(resolvedPath.toLowerCase())) {
        continue;
      }

      const hasIndex = fs.existsSync(path.join(dirPath, 'index.html'));
      const hasPackage = fs.existsSync(path.join(dirPath, 'package.json'));

      if (hasIndex || hasPackage) {
        let detectedStack = "Static HTML";
        if (hasIndex && hasPackage) detectedStack = "Astro Site (Source + Build)";
        else if (hasPackage) detectedStack = "Node.js / CMS Repository";
        else if (hasIndex) detectedStack = "Static Build / HTML";

        scanned.push({
          slug: dirName,
          name: dirName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          documentRoot: resolvedPath.replace(/\\/g, '/'),
          repositoryPath: hasPackage ? resolvedPath.replace(/\\/g, '/') : "",
          domain: `${dirName}.o2switch.site`,
          stack: detectedStack
        });
      }
    }
    res.json(scanned);
  } catch (e) {
    sendError(res, "Erreur lors du scan du répertoire.", e);
  }
});

// Import scanned site (admin uniquement)
app.post('/api/sites/import', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug: rawSlug, name, domain, stack, documentRoot, repositoryPath } = req.body;
  if (!rawSlug) return res.status(400).json({ error: "Le slug est requis pour l'import." });
  const slug = generateSlug(rawSlug);
  if (!slug) return res.status(400).json({ error: "Slug d'import invalide." });
  if (!ensureConfinedPaths(res, { documentRoot, repositoryPath })) return;

  try {
    if (await sitesStore.getSiteBySlug(slug)) {
      return res.status(400).json({ error: "Ce site est déjà enregistré." });
    }

    const newSite = await sitesStore.createSite({
      slug,
      name: name || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      domain: await resolveSiteDomain(slug, domain),
      documentRoot: (documentRoot || path.join(PUBLIC_HTML_DIR, slug)).replace(/\\/g, '/'),
      repositoryPath: (repositoryPath || "").replace(/\\/g, '/'),
      stack: stack || "Plain HTML (Importé)",
      createdWithTool: false,
      status: "active",
      sslStatus: initialSslStatus()
    });

    // Provision local files repository without Git
    provisionRepository(newSite.repositoryPath);

    logAudit(req, 'site.import', slug);
    res.json({ success: true, site: newSite });
  } catch (e) {
    sendError(res, "Impossible d'importer le site.", e);
  }
});

// List files of a specific site for file manager (admin uniquement)
app.get('/api/sites/:slug/files', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const pathType = req.query.type || 'documentRoot'; // 'documentRoot' or 'repository'

  try {
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const rootDir = pathType === 'repository' ? site.repositoryPath : site.documentRoot;
    if (!rootDir || !fs.existsSync(rootDir)) {
      return res.json([]);
    }

    function walkDir(dir, baseDir = rootDir) {
      let results = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        // Skip node_modules, git, and Astro caching folders inside repos for performance
        if (pathType === 'repository' && (file === 'node_modules' || file === '.git' || file === '.astro')) {
          continue;
        }

        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
        
        if (stat.isDirectory()) {
          results.push({
            name: file,
            path: relativePath,
            isDir: true,
            mtime: stat.mtime
          });

          // Limit depth in repos to prevent browser memory exhaust
          const depth = relativePath.split('/').length;
          if (pathType === 'repository' && depth > 3) {
            continue;
          }
          results = results.concat(walkDir(filePath, baseDir));
        } else {
          results.push({
            name: file,
            path: relativePath,
            isDir: false,
            size: stat.size,
            mtime: stat.mtime
          });
        }
      }
      return results;
    }

    const files = walkDir(rootDir);
    res.json(files);
  } catch (e) {
    sendError(res, "Erreur lors de la lecture des fichiers.", e);
  }
});

// View text file content of a specific site (admin uniquement)
app.get('/api/sites/:slug/files/view', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const relativePath = req.query.path;
  const pathType = req.query.type || 'documentRoot'; // 'documentRoot' or 'repository'

  if (!relativePath) return res.status(400).json({ error: "Le chemin du fichier est requis." });

  try {
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const rootDir = pathType === 'repository' ? site.repositoryPath : site.documentRoot;
    if (!rootDir || !fs.existsSync(rootDir)) {
      return res.status(404).json({ error: "Dossier racine introuvable." });
    }

    const filePath = path.join(rootDir, relativePath);
    // Security check to avoid path traversal
    const rel = path.relative(rootDir, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(403).json({ error: "Accès interdit." });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: "Fichier non trouvé." });
    }

    const stats = fs.statSync(filePath);
    if (stats.size > 200 * 1024) {
      return res.status(400).json({ error: "Fichier trop volumineux pour l'affichage." });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (e) {
    sendError(res, "Impossible de lire le fichier.", e);
  }
});

// --- Releases & rollback (admin only) ---

// Versions de déploiement disponibles pour un site (plus récentes d'abord)
app.get('/api/sites/:slug/releases', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    res.json(releases.listReleases(RELEASES_DIR, req.params.slug));
  } catch (e) {
    sendError(res, "Impossible de lister les versions.", e);
  }
});

// Historique des builds d'un site (admin ou propriétaire — ownership vérifié).
app.get('/api/sites/:slug/builds', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.params.slug), async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    if (!payloadInstance) return res.json([]);
    const siteDoc = await sitesStore.getOrCreatePayloadDoc(req.params.slug);
    const out = await payloadInstance.find({
      collection: 'builds',
      where: { site: { equals: siteDoc.id } },
      sort: '-createdAt',
      limit: 10,
      depth: 0,
      overrideAccess: true,
    });
    res.json(out.docs.map((b) => ({
      status: b.status,
      durationMs: b.durationMs ?? null,
      triggeredBy: b.triggeredBy ?? null,
      createdAt: b.createdAt,
    })));
  } catch (e) {
    sendError(res, "Impossible de lire l'historique des builds.", e);
  }
});

// Rollback : republie une version conservée dans le documentRoot (bascule atomique).
app.post('/api/sites/:slug/rollback', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const slug = req.params.slug;
  try {
    // Pas de rollback pendant un build : le pipeline va justement remplacer la cible
    if (buildLockHeld || buildStatus.inProgress || fs.existsSync(LOCK_FILE)) {
      return res.status(409).json({ error: "Un build est en cours : réessayez quand il sera terminé." });
    }
    const site = await sitesStore.getSiteBySlug(slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    // L'identifiant client n'est jamais utilisé comme chemin : la release est résolue
    // depuis RELEASES_DIR/slug uniquement (identifiants hostiles → null → 400).
    const releaseDir = releases.resolveRelease(RELEASES_DIR, slug, req.body?.release);
    if (!releaseDir) return res.status(400).json({ error: "Version inconnue ou invalide." });

    const siteDestDir = site.documentRoot;
    assertSafePath(siteDestDir, PUBLIC_HTML_DIR);
    const tmpDir = siteDestDir + '.tmp-rollback';
    const oldDir = siteDestDir + '.old-rollback';
    try {
      // Même motif atomique que le déploiement : copie complète puis bascule par rename
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.cpSync(releaseDir, tmpDir, { recursive: true, force: true });
      fs.rmSync(oldDir, { recursive: true, force: true });
      if (fs.existsSync(siteDestDir)) fs.renameSync(siteDestDir, oldDir);
      fs.renameSync(tmpDir, siteDestDir);
      fs.rmSync(oldDir, { recursive: true, force: true });
    } catch (swapErr) {
      try {
        if (!fs.existsSync(siteDestDir) && fs.existsSync(oldDir)) fs.renameSync(oldDir, siteDestDir);
      } catch (restoreErr) {
        console.error('Échec de restauration après rollback raté :', restoreErr.message);
      }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      throw swapErr;
    }

    // En mode cpanel : republier aussi la version restaurée sur l'hébergement réel
    if (hosting.isRemote) {
      await hosting.publish(slug, siteDestDir);
    }

    updateSiteStatus(slug, 'active');
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] ROLLBACK : site "${slug}" restauré sur la release ${req.body.release}.\n`);
    logAudit(req, 'site.rollback', slug, `release=${req.body.release}`);
    res.json({ success: true, release: req.body.release });
  } catch (e) {
    sendError(res, "Échec du retour à la version précédente.", e);
  }
});

// --- Export / import de site (admin only) ---

// Export : archive zip streamée contenant meta.json, pages.json, theme.json et le
// build déployé (dist/) s'il existe. Sert de sauvegarde ou de transfert.
app.get('/api/sites/:slug/export', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const archiver = require('archiver');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="site-${site.slug}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (e) => { console.error('Erreur export zip :', e.message); res.destroy(); });
    archive.pipe(res);

    const meta = { slug: site.slug, name: site.name, domain: site.domain, stack: site.stack, exportedAt: new Date().toISOString() };
    archive.append(JSON.stringify(meta, null, 2), { name: 'meta.json' });
    archive.append(JSON.stringify(await readSitePages(site.slug), null, 2), { name: 'pages.json' });

    const themeFile = getSiteThemeFile(site.slug);
    if (fs.existsSync(themeFile)) {
      archive.file(themeFile, { name: 'theme.json' });
    }
    if (site.documentRoot && fs.existsSync(site.documentRoot)) {
      try {
        assertSafePath(site.documentRoot, PUBLIC_HTML_DIR);
        archive.directory(site.documentRoot, 'dist');
      } catch {
        // documentRoot hérité hors périmètre : on exporte sans le build
      }
    }
    logAudit(req, 'site.export', site.slug);
    await archive.finalize();
  } catch (e) {
    sendError(res, "Échec de l'export du site.", e);
  }
});

// Import : recrée un site depuis une archive d'export. Corps = zip brut (bornés à 50 Mo).
// Anti zip-slip : chaque entrée est filtrée (basename/segments contrôlés) et écrite
// uniquement sous le documentRoot fraîchement créé via assertSafePath.
app.post('/api/sites/import-archive',
  auth.authenticate, auth.requireAdmin,
  express.raw({ type: ['application/zip', 'application/octet-stream'], limit: '50mb' }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Archive manquante (envoyez le zip en corps de requête, Content-Type: application/zip)." });
      }
      const AdmZip = require('adm-zip');
      let zip;
      try {
        zip = new AdmZip(req.body);
      } catch {
        return res.status(400).json({ error: "Archive illisible : zip invalide." });
      }

      const readEntry = (name) => {
        const entry = zip.getEntry(name);
        return entry ? zip.readAsText(entry) : null;
      };

      let meta;
      try {
        meta = JSON.parse(readEntry('meta.json') || '');
      } catch {
        return res.status(400).json({ error: "meta.json absent ou invalide dans l'archive." });
      }

      const baseSlug = generateSlug(meta.slug || meta.name || '');
      if (!baseSlug) return res.status(400).json({ error: "Slug invalide dans meta.json." });
      let slug = baseSlug;
      let suffix = 2;
      while (await sitesStore.getSiteBySlug(slug)) slug = `${baseSlug}-${suffix++}`;

      const documentRoot = path.join(PUBLIC_HTML_DIR, slug).replace(/\\/g, '/');
      const newSite = await sitesStore.createSite({
        slug,
        name: meta.name || slug,
        domain: await resolveSiteDomain(slug),
        documentRoot,
        repositoryPath: "",
        stack: meta.stack || "Astro SSG",
        createdWithTool: true,
        status: "draft",
        sslStatus: initialSslStatus()
      });

      // Pages : fichier JSON de fallback (repris par le CMS puis persisté dans Payload
      // à la première sauvegarde). Thème : validé avant écriture.
      const pagesRaw = readEntry('pages.json');
      if (pagesRaw) {
        try {
          const pagesData = JSON.parse(pagesRaw);
          if (pagesData && Array.isArray(pagesData.docs)) {
            fs.writeFileSync(getSitePagesFile(slug), JSON.stringify(pagesData, null, 2), 'utf-8');
          }
        } catch { /* pages illisibles : le site démarre avec les pages par défaut */ }
      }
      const themeRaw = readEntry('theme.json');
      if (themeRaw) {
        try {
          const themeData = JSON.parse(themeRaw);
          if (validateTheme(themeData && themeData.theme).ok) {
            fs.writeFileSync(getSiteThemeFile(slug), JSON.stringify(themeData, null, 2), 'utf-8');
          }
        } catch { /* thème illisible : défaut au premier enregistrement */ }
      }

      // Build embarqué (dist/) : extraction contrôlée entrée par entrée
      let extracted = 0;
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith('dist/')) continue;
        const relative = entry.entryName.slice('dist/'.length);
        // refuser toute entrée louche (segments vides, "..", chemins absolus)
        const segments = relative.split('/');
        if (segments.some((s) => s === '' || s === '.' || s === '..')) continue;
        const dest = path.join(documentRoot, ...segments);
        assertSafePath(dest, PUBLIC_HTML_DIR);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
        extracted++;
      }
      if (extracted > 0) updateSiteStatus(slug, 'active');

      logAudit(req, 'site.import-archive', slug, `fichiers=${extracted}`);
      res.json({ success: true, site: newSite, extractedFiles: extracted });
    } catch (e) {
      sendError(res, "Échec de l'import de l'archive.", e);
    }
  });

// Duplication d'un site (admin) : crée un jumeau (contenu + thème) sous un nouveau slug.
app.post('/api/sites/:slug/duplicate', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const source = await sitesStore.getSiteBySlug(req.params.slug);
    if (!source) return res.status(404).json({ error: "Site source introuvable." });

    const base = generateSlug(`${source.slug}-copie`) || `${source.slug}-copie`;
    let slug = base;
    let suffix = 2;
    while (await sitesStore.getSiteBySlug(slug)) slug = `${base}-${suffix++}`;

    const documentRoot = path.join(PUBLIC_HTML_DIR, slug).replace(/\\/g, '/');
    const newSite = await sitesStore.createSite({
      slug,
      name: `${source.name} (copie)`,
      domain: await resolveSiteDomain(slug),
      documentRoot,
      repositoryPath: "",
      stack: source.stack,
      createdWithTool: true,
      status: "draft",
      sslStatus: initialSslStatus()
    });

    // Contenu + thème copiés via le fallback JSON (repris par le CMS, persisté dans
    // Payload à la première sauvegarde) — même approche que l'import d'archive.
    try {
      const pagesData = await readSitePages(source.slug);
      if (pagesData && Array.isArray(pagesData.docs)) {
        fs.writeFileSync(getSitePagesFile(slug), JSON.stringify(pagesData, null, 2), 'utf-8');
      }
    } catch { /* pages source illisibles : le jumeau démarre avec les pages par défaut */ }
    const srcTheme = getSiteThemeFile(source.slug);
    if (fs.existsSync(srcTheme)) {
      try { fs.copyFileSync(srcTheme, getSiteThemeFile(slug)); } catch { /* thème par défaut sinon */ }
    }

    logAudit(req, 'site.duplication', slug, `source=${source.slug}`);
    res.json({ success: true, site: newSite });
  } catch (e) {
    sendError(res, "Échec de la duplication du site.", e);
  }
});

// --- ENDPOINTS CMS ---

// Pages (le paramètre ?site= est obligatoire, l'accès est vérifié par ownership)
app.get('/api/site-pages', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;
  try {
    res.json(await readSitePages(siteSlug));
  } catch (e) {
    sendError(res, "Impossible de lire les pages du site.", e);
  }
});

app.post('/api/site-pages', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;

  if (payloadInstance) {
    try {
      const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);

      if (req.body.docs && Array.isArray(req.body.docs)) {
        for (const pageInput of req.body.docs) {
          const pageRes = await payloadInstance.find({
            collection: 'pages',
            where: {
              and: [
                { site: { equals: siteDoc.id } },
                { slug: { equals: pageInput.slug } }
              ]
            },
            limit: 1
          });

          const pageData = {
            title: pageInput.title,
            slug: pageInput.slug,
            metaTitle: pageInput.metaTitle || null,
            metaDescription: pageInput.metaDescription || null,
            site: siteDoc.id,
            layout: pageInput.layout ? pageInput.layout.map(block => {
              const { blockType, id, ...fields } = block;
              if (blockType === 'gallery' && fields.images) {
                fields.images = fields.images.map(img => typeof img === 'string' ? { url: img } : img);
              }
              return {
                blockType: blockType,
                ...fields
              };
            }) : []
          };

          if (pageRes.docs.length > 0) {
            await payloadInstance.update({
              collection: 'pages',
              id: pageRes.docs[0].id,
              data: pageData
            });
          } else {
            await payloadInstance.create({
              collection: 'pages',
              data: pageData
            });
          }
        }
      }
    } catch (dbError) {
      console.error("Erreur écriture pages dans Payload:", dbError.message);
    }
  }

  const sitePagesFile = getSitePagesFile(siteSlug);
  fs.writeFileSync(sitePagesFile, JSON.stringify(req.body, null, 2), 'utf-8');
  res.json({ success: true, message: "Pages enregistrées avec succès !" });
});

// --- Blog / actualités (auth + ownership du site) ---

// Liste des articles (brouillons + publiés) pour la gestion dans le CMS.
app.get('/api/site-posts', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  try {
    res.json(await readSitePosts(req.query.site));
  } catch (e) {
    sendError(res, "Impossible de lire les articles du site.", e);
  }
});

// Écrit le fichier JSON miroir depuis la liste courante (repli hors base de données).
async function writePostsMirror(siteSlug) {
  try {
    const { docs } = await readSitePosts(siteSlug);
    fs.writeFileSync(getSitePostsFile(siteSlug), JSON.stringify({ docs }, null, 2), 'utf-8');
  } catch (e) {
    console.error('Miroir JSON des articles non écrit :', e.message);
  }
}

// Crée ou met à jour un article (identifié par son slug au sein du site).
app.post('/api/site-posts', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return res.status(400).json({ error: "Le titre de l'article est requis." });
  // Le slug de l'article est dérivé/validé (jamais vide, URL-safe) — sinon dérivé du titre.
  const postSlug = generateSlug(body.slug) || generateSlug(title);
  if (!postSlug) return res.status(400).json({ error: "Titre invalide : impossible d'en dériver une adresse." });

  const post = normalizePost({ ...body, title, slug: postSlug });

  try {
    if (payloadInstance) {
      const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);
      const existing = await payloadInstance.find({
        collection: 'posts',
        where: { and: [{ site: { equals: siteDoc.id } }, { slug: { equals: postSlug } }] },
        limit: 1, overrideAccess: true,
      });
      const data = { ...post, site: siteDoc.id };
      if (existing.docs.length > 0) {
        await payloadInstance.update({ collection: 'posts', id: existing.docs[0].id, data, overrideAccess: true });
      } else {
        await payloadInstance.create({ collection: 'posts', data, overrideAccess: true });
      }
    } else {
      // Mode sans base : upsert directement dans le fichier JSON
      let docs = [];
      try { docs = JSON.parse(fs.readFileSync(getSitePostsFile(siteSlug), 'utf-8')).docs || []; } catch { docs = []; }
      const idx = docs.findIndex((p) => p.slug === postSlug);
      if (idx >= 0) docs[idx] = post; else docs.push(post);
      fs.writeFileSync(getSitePostsFile(siteSlug), JSON.stringify({ docs }, null, 2), 'utf-8');
    }
    if (payloadInstance) await writePostsMirror(siteSlug);
    logAudit(req, 'article.enregistrement', siteSlug, postSlug);
    res.json({ success: true, slug: postSlug });
  } catch (e) {
    sendError(res, "Impossible d'enregistrer l'article.", e);
  }
});

// Supprime un article par slug.
app.delete('/api/site-posts', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;
  const postSlug = generateSlug(req.query.slug);
  if (!postSlug) return res.status(400).json({ error: "Article invalide." });
  try {
    if (payloadInstance) {
      const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);
      const existing = await payloadInstance.find({
        collection: 'posts',
        where: { and: [{ site: { equals: siteDoc.id } }, { slug: { equals: postSlug } }] },
        limit: 1, overrideAccess: true,
      });
      if (existing.docs.length > 0) {
        await payloadInstance.delete({ collection: 'posts', id: existing.docs[0].id, overrideAccess: true });
      }
      await writePostsMirror(siteSlug);
    } else {
      let docs = [];
      try { docs = JSON.parse(fs.readFileSync(getSitePostsFile(siteSlug), 'utf-8')).docs || []; } catch { docs = []; }
      fs.writeFileSync(getSitePostsFile(siteSlug), JSON.stringify({ docs: docs.filter((p) => p.slug !== postSlug) }, null, 2), 'utf-8');
    }
    logAudit(req, 'article.suppression', siteSlug, postSlug);
    res.json({ success: true });
  } catch (e) {
    sendError(res, "Impossible de supprimer l'article.", e);
  }
});

// Thème (le paramètre ?site= est obligatoire, l'accès est vérifié par ownership)
app.get('/api/theme', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;

  if (payloadInstance) {
    try {
      const siteRes = await payloadInstance.find({
        collection: 'payload_sites',
        where: { slug: { equals: siteSlug } },
        limit: 1
      });
      if (siteRes.docs.length > 0) {
        const siteId = siteRes.docs[0].id;
        const themeRes = await payloadInstance.find({
          collection: 'themes',
          where: { site: { equals: siteId } },
          limit: 1
        });
        if (themeRes.docs.length > 0) {
          const t = themeRes.docs[0];
          return res.json({
            theme: {
              colors: t.colors,
              fonts: t.fonts,
              radius: t.radius
            }
          });
        }
      }
    } catch (dbError) {
      console.error("Erreur lecture theme de Payload, fallback JSON:", dbError.message);
    }
  }

  const siteThemeFile = getSiteThemeFile(siteSlug);
  if (!fs.existsSync(siteThemeFile)) {
    return res.json(defaultTheme);
  }

  try {
    res.json(JSON.parse(fs.readFileSync(siteThemeFile, 'utf-8')));
  } catch (e) {
    console.error(`Fichier de thème corrompu pour ${siteSlug}, fallback par défaut :`, e.message);
    res.json(defaultTheme);
  }
});

app.post('/api/theme', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;
  const themeData = req.body;

  // Valider avant toute écriture : les valeurs finissent interpolées dans theme.css
  // (injection CSS possible) et une police hors-liste casse le rendu du site généré.
  const validation = validateTheme(themeData && themeData.theme);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  if (payloadInstance) {
    try {
      const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);

      const themeRes = await payloadInstance.find({
        collection: 'themes',
        where: { site: { equals: siteDoc.id } },
        limit: 1
      });

      const tInput = themeData.theme;
      const themePayloadData = {
        site: siteDoc.id,
        colors: tInput.colors,
        fonts: tInput.fonts,
        radius: tInput.radius
      };

      if (themeRes.docs.length > 0) {
        await payloadInstance.update({
          collection: 'themes',
          id: themeRes.docs[0].id,
          data: themePayloadData
        });
      } else {
        await payloadInstance.create({
          collection: 'themes',
          data: themePayloadData
        });
      }
    } catch (dbError) {
      console.error("Erreur écriture theme dans Payload:", dbError.message);
    }
  }

  const siteThemeFile = getSiteThemeFile(siteSlug);
  fs.writeFileSync(siteThemeFile, JSON.stringify(themeData, null, 2), 'utf-8');
  // NOTE : on n'écrit PAS theme.css ici. Ce fichier est global au template Astro ;
  // l'écrire hors build créait une race multi-tenant (le build d'un site A pouvait
  // embarquer le thème d'un site B). Le build le régénère depuis siteThemeFile.
  res.json({ success: true, message: "Thème mis à jour avec succès !" });
});

// Configuration et clés disponibles (booléens uniquement, jamais les clés elles-mêmes)
// --- Hébergement (admin only) : état du driver et test de connexion cPanel ---
// status() ne renvoie JAMAIS le jeton API (hôte/utilisateur/domaine racine seulement).
app.get('/api/hosting/status', auth.authenticate, auth.requireAdmin, (req, res) => {
  res.json(hosting.status());
});

app.post('/api/hosting/test', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    res.json(await hosting.testConnection());
  } catch (e) {
    // Message contrôlé par le driver (jamais le jeton) mais on reste générique côté HTTP
    res.status(502).json({ ok: false, error: e.message });
  }
});

// --- Domaine personnalisé (ADMIN only) : rattacher le vrai nom de domaine d'un client ---
// Preuve de propriété par enregistrement TXT, puis création du domaine additionnel côté
// cPanel (AutoSSL prend le relais pour le certificat). Fonctionne aussi en simulation.

// 1) Saisie : valide le domaine, génère le jeton TXT à publier, passe en 'pending'.
app.post('/api/sites/:slug/custom-domain', domainLimiter, auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const domain = domains.normalizeDomain(req.body && req.body.domain);
    if (!domains.isValidDomain(domain, { rootDomain: process.env.CPANEL_ROOT_DOMAIN })) {
      return res.status(400).json({ error: "Nom de domaine invalide. Saisissez un domaine public (ex. mon-commerce.fr)." });
    }

    // Réutilise le jeton si on reconfigure le même domaine, sinon en génère un nouveau.
    const token = (site.customDomain === domain && site.domainVerifyToken)
      ? site.domainVerifyToken
      : domains.makeVerifyToken();
    await sitesStore.updateSite(site.slug, { customDomain: domain, domainVerifyToken: token, domainStatus: 'pending' });
    logAudit(req, 'site.domaine.saisie', site.slug, domain);

    res.json({
      customDomain: domain,
      domainStatus: 'pending',
      record: { type: 'TXT', host: domains.verifyRecordHost(domain), value: token },
      pointingHint: `Faites aussi pointer ${domain} vers o2switch (enregistrement A vers l'IP du serveur, ou les serveurs DNS o2switch) pour que le site soit servi et que le certificat SSL soit émis.`,
    });
  } catch (e) {
    sendError(res, "Impossible d'enregistrer le domaine personnalisé.", e);
  }
});

// 2) Vérification + activation : contrôle le TXT, crée le domaine additionnel, bascule le domaine servi.
app.post('/api/sites/:slug/custom-domain/verify', domainLimiter, auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    if (!site.customDomain || !site.domainVerifyToken) {
      return res.status(400).json({ error: "Aucun domaine personnalisé à vérifier. Enregistrez d'abord le domaine." });
    }

    // Résolution TXT — jamais de 500 si l'enregistrement est absent (NXDOMAIN, propagation…).
    let records = [];
    try {
      records = await dns.resolveTxt(domains.verifyRecordHost(site.customDomain));
    } catch {
      records = [];
    }
    if (!domains.verifyTxtRecords(records, site.domainVerifyToken)) {
      return res.json({
        verified: false,
        domainStatus: site.domainStatus,
        message: "Enregistrement TXT introuvable ou incorrect. La propagation DNS peut prendre quelques minutes.",
      });
    }

    // Propriété prouvée → création du domaine additionnel (idempotent).
    try {
      await hosting.ensureCustomDomain(site.customDomain, site.slug);
    } catch (e) {
      await sitesStore.updateSite(site.slug, { domainStatus: 'error' });
      return sendError(res, "Domaine vérifié, mais son rattachement à l'hébergement a échoué.", e, 502);
    }

    // Le domaine client devient le domaine servi ; SSL repart en attente (AutoSSL).
    await sitesStore.updateSite(site.slug, { domain: site.customDomain, domainStatus: 'active', sslStatus: initialSslStatus() });
    logAudit(req, 'site.domaine.active', site.slug, site.customDomain);

    // Statut SSL courant (best-effort — n'échoue pas la requête).
    let sslStatus = initialSslStatus();
    try { sslStatus = await hosting.getSslStatus(site.customDomain); } catch { /* AutoSSL pas encore émis */ }
    await sitesStore.updateSite(site.slug, { sslStatus });

    res.json({ verified: true, domainStatus: 'active', domain: site.customDomain, sslStatus });
  } catch (e) {
    sendError(res, "Impossible de vérifier le domaine personnalisé.", e);
  }
});

// 3) Détachement : retire le domaine additionnel (best-effort) et rebascule sur le sous-domaine.
app.delete('/api/sites/:slug/custom-domain', domainLimiter, auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    if (site.customDomain) {
      try {
        await hosting.removeCustomDomain(site.customDomain);
      } catch (e) {
        console.error('⚠️ [Domaine] Retrait cPanel best-effort échoué —', (e && e.message) || e);
      }
    }
    // Rebascule le domaine servi sur le sous-domaine généré.
    const subdomain = await resolveSiteDomain(site.slug);
    await sitesStore.updateSite(site.slug, {
      customDomain: '', domainVerifyToken: '', domainStatus: 'none', domain: subdomain,
    });
    logAudit(req, 'site.domaine.detache', site.slug, site.customDomain || '');

    res.json({ success: true, domain: subdomain, domainStatus: 'none' });
  } catch (e) {
    sendError(res, "Impossible de détacher le domaine personnalisé.", e);
  }
});

// --- Formulaire de contact des sites publiés (PUBLIC, rate-limité) ---
// Appelé par les sites générés (autre origine en production) : CORS ouvert sur cette
// route uniquement — aucun cookie/credential impliqué, validation stricte + honeypot.
app.post('/api/contact/:slug', cors(), async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site inconnu." });

    const { name, email, message, company } = req.body || {};

    // Honeypot : un humain ne remplit jamais ce champ caché. On répond 200 sans
    // rien envoyer pour ne pas donner d'indice aux robots.
    if (typeof company === 'string' && company.trim() !== '') {
      return res.json({ success: true });
    }

    const isNonEmpty = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    if (!isNonEmpty(name, 120) || !isNonEmpty(message, 5000) || !isNonEmpty(email, 200) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Nom, email valide et message sont requis." });
    }

    const recipients = await getSiteOwners(site.slug);
    const subject = `📬 Nouveau message via ${site.name}`;
    const text =
      `Nouveau message reçu depuis le site « ${site.name} » (${site.domain}) :\n\n` +
      `Nom : ${name.trim()}\nEmail : ${email.trim()}\n\n${message.trim()}\n\n` +
      `— Envoyé par le formulaire de contact Meta-Builder`;

    if (recipients.length > 0) {
      await sendMail(recipients, subject, text);
    } else {
      // Aucun compte rattaché : ne pas perdre le message pour autant
      console.log(`📬 [Contact] Message pour « ${site.slug} » (aucun propriétaire rattaché) :\n${text}`);
    }
    logAudit(req, 'contact.recu', site.slug, `de=${email.trim()}`);
    res.json({ success: true });
  } catch (e) {
    sendError(res, "Impossible d'envoyer le message pour le moment.", e);
  }
});

// --- Statistiques de visites (anonymes, sans cookie ni IP stockée) ---

// Beacon : appelé par le site publié à chaque page vue. PUBLIC (le site déployé n'a pas
// d'auth), rate-limité, et volontairement silencieux : on ne renvoie jamais d'erreur qui
// pourrait casser la page, et on ne stocke qu'un compteur agrégé par jour.
app.post('/api/stats/hit/:slug', cors(), async (req, res) => {
  // Répond 204 quoi qu'il arrive : le beacon ne doit jamais perturber le site.
  res.status(204).end();
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return; // slug inconnu → on ignore silencieusement
    // On construit le chemin depuis le slug canonique stocké, jamais depuis l'entrée brute.
    const file = getSiteStatsFile(site.slug);
    // Lecture + écriture synchrones, sans await entre les deux : atomique vis-à-vis des
    // autres requêtes (boucle d'évènements mono-thread) → pas de compteur perdu.
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { data = {}; }
    fs.writeFileSync(file, JSON.stringify(stats.recordHit(data)), 'utf-8');
  } catch (e) {
    // Jamais d'exception remontée : le status a déjà été envoyé.
    console.error('⚠️ [Stats] hit ignoré —', (e && e.message) || e);
  }
});

// Lecture des stats d'un site : réservée au propriétaire du site (ou admin).
app.get('/api/sites/:slug/stats', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.params.slug), async (req, res) => {
  try {
    const site = await sitesStore.getSiteBySlug(req.params.slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    let data = {};
    try { data = JSON.parse(fs.readFileSync(getSiteStatsFile(site.slug), 'utf-8')); } catch { data = {}; }
    const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 90);
    res.json({
      total: stats.total(data),
      days: stats.lastNDays(data, days),
    });
  } catch (e) {
    sendError(res, "Impossible de lire les statistiques du site.", e);
  }
});

// --- Journal d'audit (admin only, lecture seule) ---
app.get('/api/audit', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    if (!payloadInstance) return res.json([]);
    const out = await payloadInstance.find({
      collection: 'audit_logs',
      sort: '-createdAt',
      limit: 50,
      depth: 0,
      overrideAccess: true,
    });
    res.json(out.docs.map((d) => ({
      action: d.action,
      actor: d.actor,
      target: d.target,
      details: d.details,
      createdAt: d.createdAt,
    })));
  } catch (e) {
    sendError(res, "Impossible de lire le journal d'audit.", e);
  }
});

app.get('/api/config', auth.authenticate, auth.requireAuth, (req, res) => {
  res.json({
    availableProviders: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY
    },
    defaultProvider: process.env.DEFAULT_PROVIDER || 'openai',
    devNoAuth: auth.DEV_NO_AUTH,
    // null = illimité (admin) ; sinon { limit, used, remaining }
    aiQuota: aiQuota.getQuota(req.user)
  });
});

// --- MOCK AI ENDPOINTS ---

// Assistant de rédaction pour le CMS (améliorer un texte, générer une description,
// proposer des meta SEO). Auth + ownership du site + quota IA (comme l'onboarding).
app.post('/api/ai/assist', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.body && req.body.site), async (req, res) => {
  const { action, input, context, provider } = req.body || {};
  if (!['rewrite', 'generate-description', 'seo', 'article'].includes(action)) {
    return res.status(400).json({ error: "Action d'assistance invalide." });
  }

  const reservation = await aiQuota.reserveSlot(req.user);
  if (!reservation.ok) {
    return res.status(429).json({
      error: `Quota IA journalier atteint (${reservation.quota.used}/${reservation.quota.limit}). Réinitialisation à minuit.`,
      quota: reservation.quota
    });
  }

  try {
    const result = await runAssist(provider, { action, input, context });
    res.json(result);
  } catch (error) {
    // Échec IA (clé absente, appel raté…) : on libère le créneau (jamais décompté sur échec)
    await aiQuota.releaseSlot(req.user.id);
    return sendError(res, "L'assistant IA n'a pas pu répondre.", error);
  }
});

// Assistant d'Onboarding (Routage Stack, Ébauche & Thème) — accessible aux admins ET aux clients :
// le site créé est automatiquement rattaché au compte de l'utilisateur connecté.
app.post('/api/onboard', auth.authenticate, auth.requireAuth, async (req, res) => {
  const { name, description, features, ambiance, image, inspirationUrl, provider } = req.body;
  if (!description) {
    return res.status(400).json({ error: "La description est requise." });
  }

  // Quota IA : on RÉSERVE un créneau AVANT l'appel (incrément atomique sérialisé) pour
  // fermer la fenêtre TOCTOU où deux requêtes concurrentes passaient toutes deux la vérif.
  // Les admins/dev sont illimités (reservation.ok=true, quota=null, aucune écriture).
  const reservation = await aiQuota.reserveSlot(req.user);
  if (!reservation.ok) {
    return res.status(429).json({
      error: `Quota IA journalier atteint (${reservation.quota.used}/${reservation.quota.limit}). Réinitialisation à minuit.`,
      quota: reservation.quota
    });
  }

  let result;
  try {
    result = await runOnboard(provider, { name, description, features, ambiance, image, inspirationUrl });
  } catch (error) {
    // L'appel IA a échoué : on libère le créneau réservé (jamais décompté sur échec)
    await aiQuota.releaseSlot(req.user.id);
    return sendError(res, "Échec de la génération du site par IA.", error);
  }

  try {
    // L'IA a réussi : le créneau réservé reste consommé.

    // Generate a new slug for this site (validé : jamais vide → jamais documentRoot partagé)
    const siteName = name || result.qualification.site_name || "Nouveau Site";
    const slug = generateSlug(siteName) || generateSlug(result.qualification.site_name || '') || 'site';

    let finalSlug = slug;
    let suffix = 2;
    while (await sitesStore.getSiteBySlug(finalSlug)) {
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }

    const newSite = await sitesStore.createSite({
      slug: finalSlug,
      name: siteName,
      domain: await resolveSiteDomain(finalSlug),
      documentRoot: path.join(PUBLIC_HTML_DIR, finalSlug).replace(/\\/g, '/'),
      repositoryPath: path.join(path.dirname(PUBLIC_HTML_DIR), 'repositories', finalSlug).replace(/\\/g, '/'), // Setup backend repository under repositories/
      stack: result.qualification.stack_requirements.need_medusajs ? "Astro Hybride + Payload + Medusa" :
             result.qualification.stack_requirements.need_payload ? "Astro SSG + Payload CMS" : "Astro SSG",
      createdWithTool: true,
      status: "draft",
      sslStatus: initialSslStatus()
    });

    // Provision local files repository without Git
    provisionRepository(newSite.repositoryPath);

    // Save pages and theme specifically for this site
    if (result.pages && result.pages.docs) {
      fs.writeFileSync(getSitePagesFile(finalSlug), JSON.stringify(result.pages, null, 2), 'utf-8');
    } else {
      fs.writeFileSync(getSitePagesFile(finalSlug), JSON.stringify(defaultPages, null, 2), 'utf-8');
    }

    const themeData = { theme: result.theme || defaultTheme.theme };
    fs.writeFileSync(getSiteThemeFile(finalSlug), JSON.stringify(themeData, null, 2), 'utf-8');
    // theme.css n'est pas écrit ici (fichier global, régénéré au build depuis siteThemeFile).

    // Référence le site dans Payload et le rattache au compte du client créateur
    if (payloadInstance) {
      try {
        const siteDoc = await sitesStore.getOrCreatePayloadDoc(finalSlug);
        if (req.user && !req.user.devMode && !auth.isAdmin(req.user)) {
          const fullUser = await payloadInstance.findByID({
            collection: 'users',
            id: req.user.id,
            depth: 0,
            overrideAccess: true
          });
          const existingSiteIds = (fullUser.sites || []).map(s => (typeof s === 'object' && s !== null ? s.id : s));
          if (!existingSiteIds.includes(siteDoc.id)) {
            await payloadInstance.update({
              collection: 'users',
              id: req.user.id,
              data: { sites: [...existingSiteIds, siteDoc.id] },
              overrideAccess: true
            });
          }
        }
      } catch (dbError) {
        console.error("Erreur de rattachement du site au compte :", dbError.message);
      }
    }

    logAudit(req, 'site.creation-ia', finalSlug, `nom=${siteName}`);
    res.json({
      qualification: result.qualification,
      pages: result.pages || defaultPages,
      theme: result.theme || defaultTheme.theme,
      site: newSite
    });
  } catch (error) {
    sendError(res, "Échec de la génération du site par IA.", error);
  }
});

// --- WEBHOOK DE DEPLOIEMENT & BUILD (Section 6.2) ---

let buildStatus = {
  inProgress: false,
  status: "idle", // 'idle', 'running', 'success', 'error'
  lastCompleted: null,
  error: null,
  buildingSite: null
};

// File d'attente FIFO de slugs (dédupliquée). Perdue au restart : acceptable,
// le verrou physique orphelin est nettoyé au boot ci-dessous.
const buildQueue = [];

// Déclencheur (email) et heure de départ des builds, pour l'historique (collection
// « builds ») et les notifications. Volatiles comme la file : perte au restart OK.
const buildTriggers = new Map();
const buildStartTimes = new Map();

// Verrou mémoire synchrone : posé AVANT tout await pour fermer la fenêtre TOCTOU
// (deux webhooks concurrents ne peuvent plus démarrer deux builds simultanés).
let buildLockHeld = false;

// Vider les logs + nettoyer un verrou orphelin laissé par un crash
fs.writeFileSync(LOGS_FILE, 'Initialisation du système de build...\n', 'utf-8');
buildLockHeld = false;
if (fs.existsSync(LOCK_FILE)) {
  fs.unlinkSync(LOCK_FILE);
  fs.appendFileSync(LOGS_FILE, 'Verrou de build orphelin détecté et nettoyé au démarrage.\n');
}

app.get('/api/build-status', auth.authenticate, auth.requireAuth, (req, res) => {
  const queueInfo = auth.isAdmin(req.user)
    ? { queue: [...buildQueue], queueLength: buildQueue.length }
    : {
        queueLength: buildQueue.length,
        queuedSites: buildQueue
          .map((slug, i) => ({ slug, position: i + 1 }))
          .filter(q => req.userSiteSlugs.has(q.slug))
      };

  // Un client ne voit les logs que si le build en cours/dernier concerne un de ses sites
  const canSeeLogs = auth.isAdmin(req.user) ||
    !buildStatus.buildingSite ||
    req.userSiteSlugs.has(buildStatus.buildingSite);

  if (!canSeeLogs) {
    return res.json({
      inProgress: buildStatus.inProgress,
      status: buildStatus.inProgress ? 'busy' : 'idle',
      lastCompleted: null,
      error: null,
      buildingSite: null,
      lockExists: fs.existsSync(LOCK_FILE),
      logs: "Un déploiement d'un autre site est en cours. Veuillez patienter.",
      ...queueInfo
    });
  }

  const logs = fs.existsSync(LOGS_FILE) ? fs.readFileSync(LOGS_FILE, 'utf-8') : '';
  res.json({
    ...buildStatus,
    lockExists: fs.existsSync(LOCK_FILE),
    logs: logs,
    ...queueInfo
  });
});

// Dépile et lance le build suivant. Appelée à CHAQUE fin de build (succès ou erreur).
function drainQueue() {
  if (buildQueue.length === 0 || buildLockHeld || fs.existsSync(LOCK_FILE)) return;
  const nextSlug = buildQueue.shift();
  buildLockHeld = true; // réserver le créneau avant l'await de startBuild
  fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] FILE D'ATTENTE : lancement du build suivant (${nextSlug}), ${buildQueue.length} restant(s).\n`);
  startBuild(nextSlug).catch((e) => {
    console.error('Erreur de lancement du build en file :', e.message);
    buildLockHeld = false;
    drainQueue();
  });
}

// Lance un build : pose le verrou, exécute astro build, copie vers documentRoot,
// puis libère le verrou et draine la file — quel que soit le résultat.
// Précondition : buildLockHeld doit déjà être true (réservé par le webhook ou drainQueue).
// Clôture d'un build (succès ou erreur) : historisation en base + notification email
// aux propriétaires. Entièrement non bloquant : un échec ici n'affecte jamais le build.
function finalizeBuild(siteSlug, siteName, status, excerpt) {
  const startedAt = buildStartTimes.get(siteSlug);
  const durationMs = startedAt ? Date.now() - startedAt : null;
  const triggeredBy = buildTriggers.get(siteSlug) || 'système';
  buildStartTimes.delete(siteSlug);
  buildTriggers.delete(siteSlug);

  (async () => {
    if (!payloadInstance) return;
    const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);
    await payloadInstance.create({
      collection: 'builds',
      data: { site: siteDoc.id, status, durationMs, triggeredBy, logExcerpt: String(excerpt || '').slice(-1500) },
      overrideAccess: true,
    });
  })().catch((e) => console.error('Historique de build non enregistré :', e.message));

  notifyBuildResult(siteSlug, siteName, status, durationMs).catch((e) =>
    console.error('Notification de build non envoyée :', e.message)
  );
}

// Envoi d'email générique. Même convention que le reset de mot de passe : sans
// SMTP_HOST, le message est écrit dans la console (mode développement).
let mailTransport = null;
async function sendMail(recipients, subject, text) {
  const emails = Array.isArray(recipients) ? recipients : [recipients];
  if (emails.length === 0) return;
  if (!process.env.SMTP_HOST) {
    console.log(`📧 [Dev] ${subject} → ${emails.join(', ')}\n${text}`);
    return;
  }
  if (!mailTransport) {
    const nodemailer = require('nodemailer');
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number.parseInt(process.env.SMTP_PORT ?? '', 10) || 587,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  const from = process.env.EMAIL_FROM || 'noreply@localhost';
  await Promise.all(emails.map((to) => mailTransport.sendMail({ from, to, subject, text })));
}

// Email de fin de build aux propriétaires du site.
async function notifyBuildResult(siteSlug, siteName, status, durationMs) {
  const emails = await getSiteOwners(siteSlug);
  if (emails.length === 0) return;

  const ok = status === 'success';
  const seconds = durationMs ? Math.round(durationMs / 1000) : null;
  const subject = `${ok ? '✅ Déploiement réussi' : '❌ Déploiement échoué'} — ${siteName}`;
  const text = ok
    ? `Le site « ${siteName} » a été déployé avec succès${seconds ? ` en ${seconds} s` : ''}.\nAperçu : /preview/${siteSlug}/index.html`
    : `Le déploiement du site « ${siteName} » a échoué${seconds ? ` après ${seconds} s` : ''}.\nConsultez les logs de build dans l'orchestrateur pour le détail.`;

  await sendMail(emails, subject, text);
}

async function startBuild(siteSlug) {
  buildLockHeld = true; // défensif (idempotent) : garantit le verrou même si l'appelant l'a oublié
  const site = await sitesStore.getSiteBySlug(siteSlug);
  if (!site) {
    // Le site a pu être supprimé pendant son attente en file
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] ANNULÉ : le site "${siteSlug}" n'existe plus.\n`);
    buildLockHeld = false;
    drainQueue();
    return;
  }

  // Poser le verrou
  fs.writeFileSync(LOCK_FILE, 'locked');
  buildStatus.inProgress = true;
  buildStatus.status = "running";
  buildStatus.error = null;
  buildStatus.buildingSite = siteSlug;
  buildStartTimes.set(siteSlug, Date.now());

  fs.writeFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] DÉMARRAGE : Build du site "${site.name}" (${siteSlug})...\n`, 'utf-8');

  // Sync theme of the site to the CSS template before compilation
  const siteThemeFile = getSiteThemeFile(siteSlug);
  if (fs.existsSync(siteThemeFile)) {
    try {
      const themeData = JSON.parse(fs.readFileSync(siteThemeFile, 'utf-8'));
      writeThemeCss(themeData);
    } catch(e) {
      console.error("Erreur lors de l'application du thème pour le build", e);
    }
  }

  // Set building site globally for Astro dynamic routing
  activeBuildingSite = siteSlug;

  const isWindows = process.platform === "win32";

  // Vérifier si node_modules existe dans client-template, sinon faire npm install
  const needsInstall = !fs.existsSync(path.join(ASTRO_PROJECT_DIR, 'node_modules'));
  const installCmd = needsInstall ? 'npm install && ' : '';

  const cmd = isWindows
    ? `cd /d "${ASTRO_PROJECT_DIR}" && ${installCmd}npm run build`
    : `cd "${ASTRO_PROJECT_DIR}" && ${installCmd}npm run build`;

  fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Commande exécutée : ${cmd}\n`);

  // Le site actif et le jeton d'accès interne passent par l'environnement du process de build
  const buildEnv = {
    ...process.env,
    ACTIVE_SITE_SLUG: siteSlug,
    BUILD_TOKEN,
    ORCHESTRATOR_URL: `http://127.0.0.1:${process.env.PORT || 4000}`,
    // Métadonnées du site pour les balises Open Graph et les données structurées (JSON-LD)
    PUBLIC_SITE_NAME: (site && site.name) || siteSlug,
    PUBLIC_SITE_URL: site && site.domain ? `https://${site.domain}` : '',
    // Mesure d'audience (validée à l'écriture) : chargée après consentement RGPD
    PUBLIC_ANALYTICS_PROVIDER: (site && site.analyticsProvider) || '',
    PUBLIC_ANALYTICS_ID: (site && site.analyticsId) || '',
    PUBLIC_ANALYTICS_HOST: (site && site.analyticsHost) || '',
  };

  exec(cmd, { env: buildEnv }, (error, stdout, stderr) => {
    // Le traitement du résultat est async (publication distante éventuelle) mais le
    // point de sortie reste UNIQUE : libération des verrous dans le finally.
    handleBuildResult(siteSlug, site, error, stdout, stderr)
      .catch((e) => {
        console.error('Erreur inattendue de post-build :', e.message);
        buildStatus.status = 'error';
        buildStatus.error = 'Erreur interne de déploiement.';
        updateSiteStatus(siteSlug, 'error');
      })
      .finally(() => {
        if (fs.existsSync(LOCK_FILE)) {
          fs.unlinkSync(LOCK_FILE);
        }
        buildStatus.inProgress = false;
        buildLockHeld = false;
        drainQueue();
      });
  });
}

async function handleBuildResult(siteSlug, site, error, stdout, stderr) {
  activeBuildingSite = null;
  buildStatus.buildingSite = null;

  if (error) {
    console.error(`Erreur de build : ${error.message}`);
    fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] ERREUR DE BUILD :\n${error.message}\n${stderr}\n`);
    buildStatus.status = "error";
    buildStatus.error = error.message;
    updateSiteStatus(siteSlug, 'error');
    finalizeBuild(siteSlug, site.name, 'error', `${error.message}\n${stderr || ''}`);
    return;
  }

  fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] RÉSULTAT DU BUILD ASTRO :\n${stdout}\n`);
  fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Astro compilé. Déploiement atomique vers ${site.documentRoot}...\n`);

  // Déploiement atomique LOCAL : sert l'aperçu (/preview) et constitue la publication
  // en mode simulation. On ne détruit JAMAIS le site live avant qu'une copie complète
  // soit prête (copie dans .tmp puis bascule par rename, avec rollback).
  const siteDestDir = site.documentRoot;
  const tmpDir = siteDestDir + '.tmp-' + siteSlug;
  const oldDir = siteDestDir + '.old-' + siteSlug;
  try {
    // Défensif : ne rien détruire hors périmètre (site aux données héritées)
    assertSafePath(siteDestDir, PUBLIC_HTML_DIR);
    // Garde : ne pas déployer un build sans sortie exploitable (dist vide malgré exit 0)
    if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
      throw new Error("Build sans sortie exploitable (dist/index.html absent) : déploiement annulé, site actuel préservé.");
    }
    // SEO : sitemap.xml + robots.txt générés dans le dist avant publication
    // (non bloquant : un échec ici ne doit pas empêcher le déploiement)
    try {
      const pagesData = await readSitePages(siteSlug);
      const slugs = (pagesData.docs || []).map((p) => p.slug).filter(Boolean);
      // Ajoute l'index du blog + chaque article publié (URL /blog/<slug>/)
      const postsData = await readSitePosts(siteSlug, { publishedOnly: true });
      const postSlugs = (postsData.docs || []).map((p) => p.slug).filter(Boolean);
      if (postSlugs.length > 0) {
        slugs.push('blog', ...postSlugs.map((s) => `blog/${s}`));
      }
      if (slugs.length > 0) {
        fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), seo.generateSitemap(site.domain, slugs), 'utf-8');
        fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), seo.generateRobots(site.domain), 'utf-8');
      }
    } catch (seoErr) {
      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] SEO non généré : ${seoErr.message}\n`);
    }
    // Médiathèque : copier dans le dist les images référencées par les pages
    // (URLs /media/… réécrites par le canal interne) — le site publié est autonome.
    try {
      const pagesData = await readSitePages(siteSlug);
      const filenames = media.collectMediaFilenames(pagesData);
      if (filenames.length > 0) {
        const mediaOut = path.join(DIST_DIR, 'media');
        fs.mkdirSync(mediaOut, { recursive: true });
        let copied = 0;
        for (const name of filenames) {
          const src = path.join(UPLOADS_DIR, path.basename(name));
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(mediaOut, path.basename(name)));
            copied++;
          }
        }
        if (copied > 0) fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Médias copiés dans le site : ${copied} fichier(s).\n`);
      }
    } catch (mediaErr) {
      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Copie des médias échouée : ${mediaErr.message}\n`);
    }
    // 1. Copier le nouveau contenu à côté (même volume → rename atomique ensuite)
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.cpSync(DIST_DIR, tmpDir, { recursive: true, force: true });
    // 2. Bascule : écarter l'ancien, promouvoir le nouveau, supprimer l'ancien
    fs.rmSync(oldDir, { recursive: true, force: true });
    if (fs.existsSync(siteDestDir)) fs.renameSync(siteDestDir, oldDir);
    fs.renameSync(tmpDir, siteDestDir);
    fs.rmSync(oldDir, { recursive: true, force: true });

    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] DÉPLOIEMENT LOCAL SUCCÈS : Fichiers synchronisés vers ${siteDestDir} !\n`);

    // Conserver une version horodatée pour le rollback (non bloquant si ça échoue)
    try {
      const releaseId = releases.saveRelease(RELEASES_DIR, siteSlug, DIST_DIR);
      const pruned = releases.pruneReleases(RELEASES_DIR, siteSlug, DEPLOY_KEEP_RELEASES);
      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Release ${releaseId} conservée${pruned.length ? ` (purge : ${pruned.join(', ')})` : ''}.\n`);
    } catch (relErr) {
      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Release non conservée : ${relErr.message}\n`);
    }
  } catch (deployError) {
    console.error(`Erreur de déploiement : ${deployError.message}`);
    // Rollback : si la cible a été écartée mais pas remplacée, la restaurer
    try {
      if (!fs.existsSync(siteDestDir) && fs.existsSync(oldDir)) fs.renameSync(oldDir, siteDestDir);
    } catch (rollbackErr) {
      console.error('Échec du rollback de déploiement :', rollbackErr.message);
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] ERREUR DE DÉPLOIEMENT :\n${deployError.message}\n`);
    buildStatus.status = "error";
    buildStatus.error = deployError.message;
    updateSiteStatus(siteSlug, 'error');
    finalizeBuild(siteSlug, site.name, 'error', deployError.message);
    return;
  }

  // Publication DISTANTE (mode cpanel uniquement ; no-op en simulation) : zip du dist,
  // upload et extraction sur l'hébergement o2switch, puis rafraîchissement du statut
  // SSL réel (AutoSSL). En cas d'échec distant, l'aperçu local reste intact mais le
  // build est marqué en erreur : en mode cpanel, l'intention est la mise en ligne.
  if (hosting.isRemote) {
    try {
      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Publication cPanel vers public_html/${siteSlug}...\n`);
      await hosting.publish(siteSlug, DIST_DIR);
      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] PUBLICATION cPanel SUCCÈS (https://${site.domain}).\n`);
      try {
        const ssl = await hosting.getSslStatus(site.domain);
        await sitesStore.updateSite(siteSlug, { sslStatus: ssl });
        fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Statut SSL (AutoSSL) : ${ssl}.\n`);
      } catch (sslErr) {
        // Non bloquant : le SSL AutoSSL peut mettre du temps, on garde le statut actuel
        fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Statut SSL indisponible : ${sslErr.message}\n`);
      }
    } catch (remoteErr) {
      console.error(`Erreur de publication cPanel : ${remoteErr.message}`);
      fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] ERREUR DE PUBLICATION cPanel :\n${remoteErr.message}\n`);
      buildStatus.status = "error";
      buildStatus.error = `Publication cPanel échouée : ${remoteErr.message}`;
      updateSiteStatus(siteSlug, 'error');
      finalizeBuild(siteSlug, site.name, 'error', remoteErr.message);
      return;
    }
  }

  buildStatus.status = "success";
  buildStatus.lastCompleted = new Date().toLocaleString();
  updateSiteStatus(siteSlug, 'active');
  finalizeBuild(siteSlug, site.name, 'success', stdout);
}

app.post('/webhook/rebuild', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;

  // Décision d'occupation SYNCHRONE (aucun await intercalé) : réserve le créneau
  // immédiatement si le build est libre, fermant la fenêtre TOCTOU. Node étant
  // mono-thread, deux webhooks concurrents ne peuvent plus réserver tous les deux.
  const busy = buildLockHeld || buildStatus.inProgress || fs.existsSync(LOCK_FILE);
  let reserved = false;
  if (!busy) {
    buildLockHeld = true;
    reserved = true;
  }

  const site = await sitesStore.getSiteBySlug(siteSlug);
  if (!site) {
    if (reserved) buildLockHeld = false; // libérer la réservation prise à tort
    return res.status(404).json({ error: "Site non trouvé dans la base cPanel." });
  }

  // Mémoriser le déclencheur pour l'historique et les notifications
  buildTriggers.set(siteSlug, (req.user && req.user.email) || 'système');
  logAudit(req, 'build.declenchement', siteSlug);

  // Créneau réservé : démarrage immédiat (startBuild consomme le verrou déjà posé)
  if (reserved) {
    res.status(202).json({ message: 'Build démarré avec succès.', queued: false });
    startBuild(siteSlug).catch((e) => {
      console.error('Erreur de lancement du build :', e.message);
      buildLockHeld = false;
      drainQueue();
    });
    return;
  }

  // Build déjà en cours pour CE site : rien à faire
  if (buildStatus.buildingSite === siteSlug) {
    return res.status(202).json({ message: 'Build déjà en cours pour ce site.', queued: false, alreadyBuilding: true });
  }

  // Un autre build occupe le verrou : mise en file (dédupliquée)
  const existingIdx = buildQueue.indexOf(siteSlug);
  const position = existingIdx !== -1 ? existingIdx + 1 : buildQueue.push(siteSlug);
  if (existingIdx === -1) {
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] FILE D'ATTENTE : "${siteSlug}" ajouté (position ${position}).\n`);
  }
  return res.status(202).json({ message: `Site ajouté à la file d'attente (position ${position}).`, queued: true, position });
});

function updateSiteStatus(slug, status) {
  sitesStore.updateSiteStatus(slug, status).catch((e) => {
    console.error("Erreur mise à jour statut site", e.message);
  });
}

// Canal interne pour le build Astro : authentifié par le jeton BUILD_TOKEN (jamais exposé au navigateur)
app.get('/internal/site-pages', async (req, res) => {
  if (req.headers['x-build-token'] !== BUILD_TOKEN) {
    return res.status(401).json({ error: "Jeton de build invalide." });
  }
  const siteSlug = req.query.site || activeBuildingSite || await getSiteFromRequest(req);
  try {
    // Les URLs de la médiathèque (/api/media/file/…) sont réécrites en /media/… :
    // le site statique publié est autonome (les fichiers y sont copiés au déploiement).
    res.json(media.rewriteMediaUrls(await readSitePages(siteSlug)));
  } catch (e) {
    sendError(res, "Impossible de lire les pages du site.", e);
  }
});

// Canal interne pour le build Astro : articles PUBLIÉS uniquement (jeton BUILD_TOKEN).
app.get('/internal/site-posts', async (req, res) => {
  if (req.headers['x-build-token'] !== BUILD_TOKEN) {
    return res.status(401).json({ error: "Jeton de build invalide." });
  }
  const siteSlug = req.query.site || activeBuildingSite || await getSiteFromRequest(req);
  try {
    res.json(media.rewriteMediaUrls(await readSitePosts(siteSlug, { publishedOnly: true })));
  } catch (e) {
    sendError(res, "Impossible de lire les articles du site.", e);
  }
});

// Next.js fallback route
app.all('*', (req, res) => {
  return handle(req, res);
});

const PORT = process.env.PORT || 4000;
nextApp.prepare().then(async () => {
  await initPayload();
  app.listen(PORT, () => {
    console.log(`Serveur Meta-Builder démarré sur http://localhost:${PORT}`);
  });

  // Sauvegardes automatiques planifiées (désactivées par défaut : BACKUP_ENABLED=true).
  // Best-effort : un échec est loggé mais ne perturbe jamais le service.
  if (BACKUP_ENABLED) {
    const intervalMs = Math.max(1, BACKUP_INTERVAL_HOURS) * 60 * 60 * 1000;
    console.log(`💾 [Sauvegardes] Planifiées toutes les ${BACKUP_INTERVAL_HOURS} h (rétention ${BACKUP_KEEP}).`);
    const timer = setInterval(() => {
      createBackupArchive()
        .then((name) => name && console.log(`💾 [Sauvegardes] Créée : ${name}`))
        .catch((e) => console.error('💾 [Sauvegardes] Échec :', e.message));
    }, intervalMs);
    if (timer.unref) timer.unref(); // ne bloque pas l'arrêt du process
  }
});
