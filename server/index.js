require('dotenv').config();

// --- MONKEYPATCH FOR ESM / CJS INTEROP IN NEXT 15 ---
try {
  const env = require('@next/env');
  if (env && !env.default) {
    const wrapper = { ...env, default: env };
    require.cache[require.resolve('@next/env')] = { exports: wrapper };
  }
} catch (e) {}

const { runOnboard } = require('./ai');
const auth = require('./auth');
const sitesStore = require('./sites-store');
const aiQuota = require('./ai-quota');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- GESTION DES ERREURS DE CONNEXION BASE DE DONNÉES (ÉVITE LE CRASH) ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [BDD] Rejet de promesse intercepté (PostgreSQL est peut-être hors-ligne) :', reason.message || reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ [BDD] Exception interceptée (PostgreSQL est peut-être hors-ligne) :', err.message || err);
});

const next = require('next');
const { getPayload } = require('payload');

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev, dir: __dirname });
const handle = nextApp.getRequestHandler();

const app = express();
app.use(cors({
  origin: (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map(o => o.trim()),
  credentials: true
}));
// Le parsing JSON ne s'applique QU'AUX routes Express custom : les routes déléguées à
// Next/Payload (login, REST Payload, /admin) doivent recevoir leur flux de requête intact.
const jsonParser = express.json({ limit: '10mb' });
const EXPRESS_ROUTE_PREFIXES = ['/api/sites', '/api/site-pages', '/api/theme', '/api/config', '/api/onboard', '/api/build-status', '/webhook', '/internal'];
app.use((req, res, next) => {
  const handledByExpress = EXPRESS_ROUTE_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'));
  if (!handledByExpress) return next();
  jsonParser(req, res, next);
});

// Jeton interne régénéré à chaque boot : seul le process de build Astro le reçoit (via env)
const BUILD_TOKEN = crypto.randomBytes(24).toString('hex');

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
const LOCK_FILE = path.join(ASTRO_PROJECT_DIR, 'build.lock');

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
  const t = themeData.theme;
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
  return JSON.parse(fs.readFileSync(sitePagesFile, 'utf-8'));
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
    res.status(500).json({ error: "Impossible de lire la liste des sites." });
  }
});

// Create manual site (admin uniquement)
app.post('/api/sites', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { name, domain, stack, documentRoot, repositoryPath } = req.body;
  if (!name) return res.status(400).json({ error: "Le nom du site est requis." });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  try {
    if (await sitesStore.getSiteBySlug(slug)) {
      return res.status(400).json({ error: "Un site avec ce nom/slug existe déjà." });
    }

    const newSite = await sitesStore.createSite({
      slug,
      name,
      domain: domain || `${slug}.o2switch.site`,
      documentRoot: (documentRoot || path.join(PUBLIC_HTML_DIR, slug)).replace(/\\/g, '/'),
      repositoryPath: (repositoryPath || "").replace(/\\/g, '/'),
      stack: stack || "Astro SSG",
      createdWithTool: true,
      status: "draft",
      sslStatus: "active"
    });

    // Provision local files repository without Git
    provisionRepository(newSite.repositoryPath);

    // Initialize config files for this site
    fs.writeFileSync(getSitePagesFile(slug), JSON.stringify(defaultPages, null, 2), 'utf-8');
    fs.writeFileSync(getSiteThemeFile(slug), JSON.stringify(defaultTheme, null, 2), 'utf-8');

    res.json({ success: true, site: newSite });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update manual site metadata (admin uniquement)
app.put('/api/sites/:slug', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug } = req.params;
  const { name, domain, documentRoot, repositoryPath, stack, sslStatus, status } = req.body;

  try {
    const site = await sitesStore.updateSite(slug, {
      name: name || undefined,
      domain: domain || undefined,
      documentRoot: documentRoot ? documentRoot.replace(/\\/g, '/') : undefined,
      repositoryPath: repositoryPath !== undefined ? (repositoryPath ? repositoryPath.replace(/\\/g, '/') : "") : undefined,
      stack: stack || undefined,
      sslStatus: sslStatus || undefined,
      status: status || undefined
    });
    if (!site) return res.status(404).json({ error: "Site non trouvé." });
    res.json({ success: true, site });
  } catch (e) {
    res.status(500).json({ error: e.message });
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

    res.json({ success: true, message: "Site supprimé avec succès." });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: `Erreur lors du scan du répertoire : ${e.message}` });
  }
});

// Import scanned site (admin uniquement)
app.post('/api/sites/import', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { slug, name, domain, stack, documentRoot, repositoryPath } = req.body;
  if (!slug) return res.status(400).json({ error: "Le slug est requis pour l'import." });

  try {
    if (await sitesStore.getSiteBySlug(slug)) {
      return res.status(400).json({ error: "Ce site est déjà enregistré." });
    }

    const newSite = await sitesStore.createSite({
      slug,
      name: name || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      domain: domain || `${slug}.o2switch.site`,
      documentRoot: (documentRoot || path.join(PUBLIC_HTML_DIR, slug)).replace(/\\/g, '/'),
      repositoryPath: (repositoryPath || "").replace(/\\/g, '/'),
      stack: stack || "Plain HTML (Importé)",
      createdWithTool: false,
      status: "active",
      sslStatus: "active"
    });

    // Provision local files repository without Git
    provisionRepository(newSite.repositoryPath);

    res.json({ success: true, site: newSite });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: `Erreur lors de la lecture des fichiers : ${e.message}` });
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
    res.status(500).json({ error: `Impossible de lire le fichier : ${e.message}` });
  }
});

// --- ENDPOINTS CMS ---

// Pages (le paramètre ?site= est obligatoire, l'accès est vérifié par ownership)
app.get('/api/site-pages', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;
  try {
    res.json(await readSitePages(siteSlug));
  } catch (e) {
    res.status(500).json({ error: "Impossible de lire les pages du site." });
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

  const data = fs.readFileSync(siteThemeFile, 'utf-8');
  res.json(JSON.parse(data));
});

app.post('/api/theme', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;
  const themeData = req.body;

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
  // Écrit aussi le CSS d'Astro
  writeThemeCss(themeData);
  res.json({ success: true, message: "Thème mis à jour avec succès !" });
});

// Configuration et clés disponibles (booléens uniquement, jamais les clés elles-mêmes)
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

// Assistant d'Onboarding (Routage Stack, Ébauche & Thème) — accessible aux admins ET aux clients :
// le site créé est automatiquement rattaché au compte de l'utilisateur connecté.
app.post('/api/onboard', auth.authenticate, auth.requireAuth, async (req, res) => {
  const { name, description, features, ambiance, image, inspirationUrl, provider } = req.body;
  if (!description) {
    return res.status(400).json({ error: "La description est requise." });
  }

  // Quota IA journalier (vérifié AVANT tout appel IA — les admins sont illimités)
  const quota = aiQuota.getQuota(req.user);
  if (quota && quota.remaining <= 0) {
    return res.status(429).json({
      error: `Quota IA journalier atteint (${quota.used}/${quota.limit}). Réinitialisation à minuit.`,
      quota
    });
  }

  try {
    const result = await runOnboard(provider, { name, description, features, ambiance, image, inspirationUrl });
    // L'appel IA a réussi : on décompte (jamais décompté sur échec)
    if (quota) {
      aiQuota.increment(req.user.id);
    }
    
    // Generate a new slug for this site
    const siteName = name || result.qualification.site_name || "Nouveau Site";
    const slug = siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    let finalSlug = slug;
    let suffix = 2;
    while (await sitesStore.getSiteBySlug(finalSlug)) {
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }

    const newSite = await sitesStore.createSite({
      slug: finalSlug,
      name: siteName,
      domain: `${finalSlug}.o2switch.site`,
      documentRoot: path.join(PUBLIC_HTML_DIR, finalSlug).replace(/\\/g, '/'),
      repositoryPath: path.join(path.dirname(PUBLIC_HTML_DIR), 'repositories', finalSlug).replace(/\\/g, '/'), // Setup backend repository under repositories/
      stack: result.qualification.stack_requirements.need_medusajs ? "Astro Hybride + Payload + Medusa" :
             result.qualification.stack_requirements.need_payload ? "Astro SSG + Payload CMS" : "Astro SSG",
      createdWithTool: true,
      status: "draft",
      sslStatus: "active"
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
    writeThemeCss(themeData);

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

    res.json({
      qualification: result.qualification,
      pages: result.pages || defaultPages,
      theme: result.theme || defaultTheme.theme,
      site: newSite
    });
  } catch (error) {
    console.error("Erreur lors de l'onboarding IA :", error.message);
    res.status(500).json({ error: error.message });
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

// Vider les logs + nettoyer un verrou orphelin laissé par un crash
fs.writeFileSync(LOGS_FILE, 'Initialisation du système de build...\n', 'utf-8');
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
  if (buildQueue.length === 0 || fs.existsSync(LOCK_FILE)) return;
  const nextSlug = buildQueue.shift();
  fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] FILE D'ATTENTE : lancement du build suivant (${nextSlug}), ${buildQueue.length} restant(s).\n`);
  startBuild(nextSlug).catch((e) => {
    console.error('Erreur de lancement du build en file :', e.message);
    drainQueue();
  });
}

// Lance un build : pose le verrou, exécute astro build, copie vers documentRoot,
// puis libère le verrou et draine la file — quel que soit le résultat.
async function startBuild(siteSlug) {
  const site = await sitesStore.getSiteBySlug(siteSlug);
  if (!site) {
    // Le site a pu être supprimé pendant son attente en file
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] ANNULÉ : le site "${siteSlug}" n'existe plus.\n`);
    drainQueue();
    return;
  }

  // Poser le verrou
  fs.writeFileSync(LOCK_FILE, 'locked');
  buildStatus.inProgress = true;
  buildStatus.status = "running";
  buildStatus.error = null;
  buildStatus.buildingSite = siteSlug;

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
    ORCHESTRATOR_URL: `http://127.0.0.1:${process.env.PORT || 4000}`
  };

  exec(cmd, { env: buildEnv }, (error, stdout, stderr) => {
    activeBuildingSite = null;
    buildStatus.buildingSite = null;

    if (error) {
      console.error(`Erreur de build : ${error.message}`);
      fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] ERREUR DE BUILD :\n${error.message}\n${stderr}\n`);
      buildStatus.status = "error";
      buildStatus.error = error.message;
      updateSiteStatus(siteSlug, 'error');
    } else {
      fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] RÉSULTAT DU BUILD ASTRO :\n${stdout}\n`);
      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Astro compilé. Copie des fichiers vers ${site.documentRoot}...\n`);

      // Déploiement des fichiers statiques dans le dossier web du site
      try {
        const siteDestDir = site.documentRoot;
        // Vider le dossier de destination pour simuler rsync --delete
        fs.rmSync(siteDestDir, { recursive: true, force: true });
        fs.mkdirSync(siteDestDir, { recursive: true });
        fs.cpSync(DIST_DIR, siteDestDir, { recursive: true, force: true });

        fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] DÉPLOIEMENT SUCCÈS : Fichiers synchronisés vers ${siteDestDir} !\n`);
        buildStatus.status = "success";
        buildStatus.lastCompleted = new Date().toLocaleString();
        updateSiteStatus(siteSlug, 'active');
      } catch (deployError) {
        console.error(`Erreur de déploiement : ${deployError.message}`);
        fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] ERREUR DE DÉPLOIEMENT :\n${deployError.message}\n`);
        buildStatus.status = "error";
        buildStatus.error = deployError.message;
        updateSiteStatus(siteSlug, 'error');
      }
    }

    // Point de sortie unique : libérer le verrou puis enchaîner sur la file
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
    buildStatus.inProgress = false;
    drainQueue();
  });
}

app.post('/webhook/rebuild', auth.authenticate, auth.requireAuth, auth.requireSiteAccess(req => req.query.site), async (req, res) => {
  const siteSlug = req.query.site;

  const site = await sitesStore.getSiteBySlug(siteSlug);
  if (!site) {
    return res.status(404).json({ error: "Site non trouvé dans la base cPanel." });
  }

  // Build déjà en cours pour CE site : rien à faire
  if (buildStatus.buildingSite === siteSlug) {
    return res.status(202).json({ message: 'Build déjà en cours pour ce site.', queued: false, alreadyBuilding: true });
  }

  // Un autre build occupe le verrou : mise en file (dédupliquée)
  if (fs.existsSync(LOCK_FILE) || buildStatus.inProgress) {
    const existingIdx = buildQueue.indexOf(siteSlug);
    const position = existingIdx !== -1 ? existingIdx + 1 : buildQueue.push(siteSlug);
    if (existingIdx === -1) {
      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] FILE D'ATTENTE : "${siteSlug}" ajouté (position ${position}).\n`);
    }
    return res.status(202).json({ message: `Site ajouté à la file d'attente (position ${position}).`, queued: true, position });
  }

  // Verrou libre : démarrage immédiat
  res.status(202).json({ message: 'Build démarré avec succès.', queued: false });
  startBuild(siteSlug).catch((e) => {
    console.error('Erreur de lancement du build :', e.message);
  });
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
    res.json(await readSitePages(siteSlug));
  } catch (e) {
    res.status(500).json({ error: "Impossible de lire les pages du site." });
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
});
