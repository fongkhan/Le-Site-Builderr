require('dotenv').config();
const { runOnboard, runExtractDesign } = require('./ai');
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Dossier de données et chemins
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const PAGES_FILE = path.join(DATA_DIR, 'pages.json');
const THEME_FILE = path.join(DATA_DIR, 'theme.json');
const LOGS_FILE = path.join(DATA_DIR, 'build-logs.txt');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');

const ASTRO_PROJECT_DIR = path.resolve(__dirname, '../client-template');
const DIST_DIR = path.join(ASTRO_PROJECT_DIR, 'dist');
const PUBLIC_HTML_DIR = path.resolve(__dirname, '../simulated_public_html');
const LOCK_FILE = path.join(ASTRO_PROJECT_DIR, 'build.lock');

// Serve generated websites statically under /sites/<slug>/
app.use('/sites', express.static(PUBLIC_HTML_DIR));

// Helper functions for dynamic multi-site path handling
function getSitePagesFile(slug) {
  return path.join(DATA_DIR, `site_${slug}_pages.json`);
}

function getSiteThemeFile(slug) {
  return path.join(DATA_DIR, `site_${slug}_theme.json`);
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

// Seeding and migration logic for multi-site database
if (!fs.existsSync(SITES_FILE)) {
  const seededSites = [
    {
      slug: "boulangerie-artisanale",
      name: "Boulangerie Artisanale Clamart",
      domain: "boulangerie-clamart.o2switch.site",
      documentRoot: path.join(PUBLIC_HTML_DIR, 'boulangerie-artisanale').replace(/\\/g, '/'),
      stack: "Astro SSG + Payload CMS",
      createdWithTool: true,
      status: "active",
      sslStatus: "active"
    }
  ];
  fs.writeFileSync(SITES_FILE, JSON.stringify(seededSites, null, 2), 'utf-8');

  // Migrate or write default pages for seeded site
  let pagesVal = defaultPages;
  if (fs.existsSync(PAGES_FILE)) {
    try {
      pagesVal = JSON.parse(fs.readFileSync(PAGES_FILE, 'utf-8'));
    } catch (e) {}
  }
  fs.writeFileSync(getSitePagesFile('boulangerie-artisanale'), JSON.stringify(pagesVal, null, 2), 'utf-8');

  // Migrate or write default theme for seeded site
  let themeVal = defaultTheme;
  if (fs.existsSync(THEME_FILE)) {
    try {
      themeVal = JSON.parse(fs.readFileSync(THEME_FILE, 'utf-8'));
    } catch (e) {}
  }
  fs.writeFileSync(getSiteThemeFile('boulangerie-artisanale'), JSON.stringify(themeVal, null, 2), 'utf-8');
}

// Global variable to track active build site slug (for dynamic pages routing fallback during Astro build)
let activeBuildingSite = null;

function getSiteFromRequest(req) {
  if (req.query.site) return req.query.site;
  if (activeBuildingSite) return activeBuildingSite;
  // Fallback to first site in database
  try {
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    if (sites && sites.length > 0) return sites[0].slug;
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

// --- MULTI-SITE CPANEL ENDPOINTS ---

// List all sites
app.get('/api/sites', (req, res) => {
  try {
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    res.json(sites);
  } catch (e) {
    res.status(500).json({ error: "Impossible de lire la liste des sites." });
  }
});

// Create manual site
app.post('/api/sites', (req, res) => {
  const { name, domain, stack } = req.body;
  if (!name) return res.status(400).json({ error: "Le nom du site est requis." });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  
  try {
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    if (sites.some(s => s.slug === slug)) {
      return res.status(400).json({ error: "Un site avec ce nom/slug existe déjà." });
    }

    const newSite = {
      slug,
      name,
      domain: domain || `${slug}.o2switch.site`,
      documentRoot: path.join(PUBLIC_HTML_DIR, slug).replace(/\\/g, '/'),
      stack: stack || "Astro SSG",
      createdWithTool: true,
      status: "draft",
      sslStatus: "active"
    };

    sites.push(newSite);
    fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), 'utf-8');

    // Initialize files for this site
    fs.writeFileSync(getSitePagesFile(slug), JSON.stringify(defaultPages, null, 2), 'utf-8');
    fs.writeFileSync(getSiteThemeFile(slug), JSON.stringify(defaultTheme, null, 2), 'utf-8');

    res.json({ success: true, site: newSite });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete site
app.delete('/api/sites/:slug', (req, res) => {
  const { slug } = req.params;
  const deleteFiles = req.query.deleteFiles === 'true';

  try {
    let sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    const siteIndex = sites.findIndex(s => s.slug === slug);
    if (siteIndex === -1) {
      return res.status(404).json({ error: "Site non trouvé." });
    }

    const site = sites[siteIndex];
    sites.splice(siteIndex, 1);
    fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), 'utf-8');

    // Delete site configurations
    const pagesFile = getSitePagesFile(slug);
    const themeFile = getSiteThemeFile(slug);
    if (fs.existsSync(pagesFile)) fs.unlinkSync(pagesFile);
    if (fs.existsSync(themeFile)) fs.unlinkSync(themeFile);

    // Delete site build directory
    if (deleteFiles && fs.existsSync(site.documentRoot)) {
      fs.rmSync(site.documentRoot, { recursive: true, force: true });
    }

    res.json({ success: true, message: "Site supprimé avec succès." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Scan folder for unregistered sites
app.post('/api/sites/scan', (req, res) => {
  try {
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    const registeredSlugs = sites.map(s => s.slug);

    if (!fs.existsSync(PUBLIC_HTML_DIR)) {
      fs.mkdirSync(PUBLIC_HTML_DIR, { recursive: true });
    }

    const dirs = fs.readdirSync(PUBLIC_HTML_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const scanned = [];
    for (const dirName of dirs) {
      if (!registeredSlugs.includes(dirName)) {
        const dirPath = path.join(PUBLIC_HTML_DIR, dirName);
        const hasIndex = fs.existsSync(path.join(dirPath, 'index.html'));
        if (hasIndex) {
          scanned.push({
            slug: dirName,
            name: dirName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            documentRoot: dirPath.replace(/\\/g, '/'),
            domain: `${dirName}.o2switch.site`
          });
        }
      }
    }
    res.json(scanned);
  } catch (e) {
    res.status(500).json({ error: "Erreur lors du scan du répertoire." });
  }
});

// Import scanned site
app.post('/api/sites/import', (req, res) => {
  const { slug, name, domain, stack } = req.body;
  if (!slug) return res.status(400).json({ error: "Le slug est requis pour l'import." });

  try {
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    if (sites.some(s => s.slug === slug)) {
      return res.status(400).json({ error: "Ce site est déjà enregistré." });
    }

    const newSite = {
      slug,
      name: name || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      domain: domain || `${slug}.o2switch.site`,
      documentRoot: path.join(PUBLIC_HTML_DIR, slug).replace(/\\/g, '/'),
      stack: stack || "Plain HTML (Importé)",
      createdWithTool: false,
      status: "active",
      sslStatus: "active"
    };

    sites.push(newSite);
    fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), 'utf-8');
    res.json({ success: true, site: newSite });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List files of a specific site for file manager
app.get('/api/sites/:slug/files', (req, res) => {
  const { slug } = req.params;
  try {
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    const site = sites.find(s => s.slug === slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const rootDir = site.documentRoot;
    if (!fs.existsSync(rootDir)) {
      return res.json([]);
    }

    function walkDir(dir, baseDir = rootDir) {
      let results = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
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
    res.status(500).json({ error: "Erreur lors de la lecture des fichiers." });
  }
});

// View text file content of a specific site
app.get('/api/sites/:slug/files/view', (req, res) => {
  const { slug } = req.params;
  const relativePath = req.query.path;
  if (!relativePath) return res.status(400).json({ error: "Le chemin du fichier est requis." });

  try {
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    const site = sites.find(s => s.slug === slug);
    if (!site) return res.status(404).json({ error: "Site non trouvé." });

    const filePath = path.join(site.documentRoot, relativePath);
    // Security check to avoid path traversal
    const rel = path.relative(site.documentRoot, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(403).json({ error: "Accès interdit." });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: "Fichier non trouvé." });
    }

    const stats = fs.statSync(filePath);
    if (stats.size > 150 * 1024) {
      return res.status(400).json({ error: "Fichier trop volumineux pour l'affichage." });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (e) {
    res.status(500).json({ error: "Impossible de lire le fichier." });
  }
});

// --- ENDPOINTS CMS ---

// Pages
app.get('/api/pages', (req, res) => {
  const siteSlug = getSiteFromRequest(req);
  const sitePagesFile = getSitePagesFile(siteSlug);

  if (!fs.existsSync(sitePagesFile)) {
    return res.json(defaultPages);
  }

  const data = fs.readFileSync(sitePagesFile, 'utf-8');
  res.json(JSON.parse(data));
});

app.post('/api/pages', (req, res) => {
  const siteSlug = getSiteFromRequest(req);
  const sitePagesFile = getSitePagesFile(siteSlug);

  fs.writeFileSync(sitePagesFile, JSON.stringify(req.body, null, 2), 'utf-8');
  res.json({ success: true, message: "Pages enregistrées avec succès !" });
});

// Thème
app.get('/api/theme', (req, res) => {
  const siteSlug = getSiteFromRequest(req);
  const siteThemeFile = getSiteThemeFile(siteSlug);

  if (!fs.existsSync(siteThemeFile)) {
    return res.json(defaultTheme);
  }

  const data = fs.readFileSync(siteThemeFile, 'utf-8');
  res.json(JSON.parse(data));
});

app.post('/api/theme', (req, res) => {
  const siteSlug = getSiteFromRequest(req);
  const siteThemeFile = getSiteThemeFile(siteSlug);

  fs.writeFileSync(siteThemeFile, JSON.stringify(req.body, null, 2), 'utf-8');
  // Écrit aussi le CSS d'Astro
  writeThemeCss(req.body);
  res.json({ success: true, message: "Thème mis à jour avec succès !" });
});

// Configuration et clés disponibles
app.get('/api/config', (req, res) => {
  res.json({
    availableProviders: {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY
    },
    defaultProvider: process.env.DEFAULT_PROVIDER || 'openai'
  });
});

// --- MOCK AI ENDPOINTS ---

// Assistant d'Onboarding (Routage Stack, Ébauche & Thème)
app.post('/api/onboard', async (req, res) => {
  const { name, description, features, ambiance, image, inspirationUrl, provider } = req.body;
  if (!description) {
    return res.status(400).json({ error: "La description est requise." });
  }

  try {
    const result = await runOnboard(provider, { name, description, features, ambiance, image, inspirationUrl });
    
    // Generate a new slug for this site
    const siteName = name || result.qualification.site_name || "Nouveau Site";
    const slug = siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    let finalSlug = slug;
    let suffix = 2;
    while (sites.some(s => s.slug === finalSlug)) {
      finalSlug = `${slug}-${suffix}`;
      suffix++;
    }

    const newSite = {
      slug: finalSlug,
      name: siteName,
      domain: `${finalSlug}.o2switch.site`,
      documentRoot: path.join(PUBLIC_HTML_DIR, finalSlug).replace(/\\/g, '/'),
      stack: result.qualification.stack_requirements.need_medusajs ? "Astro Hybride + Payload + Medusa" :
             result.qualification.stack_requirements.need_payload ? "Astro SSG + Payload CMS" : "Astro SSG",
      createdWithTool: true,
      status: "draft",
      sslStatus: "active"
    };

    sites.push(newSite);
    fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), 'utf-8');

    // Save pages and theme specifically for this site
    if (result.pages && result.pages.docs) {
      fs.writeFileSync(getSitePagesFile(finalSlug), JSON.stringify(result.pages, null, 2), 'utf-8');
    } else {
      fs.writeFileSync(getSitePagesFile(finalSlug), JSON.stringify(defaultPages, null, 2), 'utf-8');
    }

    const themeData = { theme: result.theme || defaultTheme.theme };
    fs.writeFileSync(getSiteThemeFile(finalSlug), JSON.stringify(themeData, null, 2), 'utf-8');
    writeThemeCss(themeData);

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

// Extraction de thème depuis une image/logo
app.post('/api/extract-design', async (req, res) => {
  const { provider, image, ambiance } = req.body;

  try {
    const result = await runExtractDesign(provider, image, ambiance);
    res.json(result);
  } catch (error) {
    console.error("Erreur lors de l'extraction de design IA :", error.message);
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

// Vider les logs
fs.writeFileSync(LOGS_FILE, 'Initialisation du système de build...\n', 'utf-8');

app.get('/api/build-status', (req, res) => {
  const logs = fs.existsSync(LOGS_FILE) ? fs.readFileSync(LOGS_FILE, 'utf-8') : '';
  res.json({
    ...buildStatus,
    lockExists: fs.existsSync(LOCK_FILE),
    logs: logs
  });
});

app.post('/webhook/rebuild', (req, res) => {
  const siteSlug = req.query.site || getSiteFromRequest(req);

  // 1. Vérification si un build est déjà en cours (Verrou physique)
  if (fs.existsSync(LOCK_FILE)) {
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] REJET : Tentative de build concurrente détectée (HTTP 429).\n`);
    return res.status(429).json({ message: 'Build déjà en cours. Requête mise de côté.' });
  }

  const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
  const site = sites.find(s => s.slug === siteSlug);
  if (!site) {
    return res.status(404).json({ error: "Site non trouvé dans la base cPanel." });
  }

  // 2. Poser le verrou
  fs.writeFileSync(LOCK_FILE, 'locked');
  buildStatus.inProgress = true;
  buildStatus.status = "running";
  buildStatus.error = null;
  buildStatus.buildingSite = siteSlug;

  fs.writeFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] DÉMARRAGE : Webhook reçu pour le site "${site.name}" (${siteSlug}). Début du build Astro...\n`, 'utf-8');

  // Répondre immédiatement au client avec 202
  res.status(202).json({ message: 'Build démarré avec succès.' });

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

  // 3. Exécuter le build et le déploiement de manière asynchrone
  const isWindows = process.platform === "win32";
  
  // Vérifier si node_modules existe dans client-template, sinon faire npm install
  const needsInstall = !fs.existsSync(path.join(ASTRO_PROJECT_DIR, 'node_modules'));
  const installCmd = needsInstall ? 'npm install && ' : '';
  
  const buildEnvCmd = isWindows
    ? `set ACTIVE_SITE_SLUG=${siteSlug}&& `
    : `export ACTIVE_SITE_SLUG=${siteSlug} && `;

  const cmd = isWindows
    ? `cd /d "${ASTRO_PROJECT_DIR}" && ${buildEnvCmd}${installCmd}npm run build`
    : `cd "${ASTRO_PROJECT_DIR}" && ${buildEnvCmd}${installCmd}npm run build`;

  fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Commande exécutée : ${cmd}\n`);

  exec(cmd, (error, stdout, stderr) => {
    // Clear build site
    activeBuildingSite = null;
    buildStatus.buildingSite = null;

    if (error) {
      console.error(`Erreur de build : ${error.message}`);
      fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] ERREUR DE BUILD :\n${error.message}\n${stderr}\n`);
      
      // Libérer le verrou
      if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
      }
      buildStatus.inProgress = false;
      buildStatus.status = "error";
      buildStatus.error = error.message;

      updateSiteStatus(siteSlug, 'error');
      return;
    }

    fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] RÉSULTAT DU BUILD ASTRO :\n${stdout}\n`);
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Astro compilé. Copie des fichiers vers simulated_public_html/${siteSlug}...\n`);

    // 4. Déploiement des fichiers statiques dans le dossier web du site
    try {
      const siteDestDir = site.documentRoot;
      if (!fs.existsSync(siteDestDir)) {
        fs.mkdirSync(siteDestDir, { recursive: true });
      }

      // Vider le dossier de destination pour simuler rsync --delete
      fs.rmSync(siteDestDir, { recursive: true, force: true });
      fs.mkdirSync(siteDestDir, { recursive: true });

      // Copier dist/ vers simulated_public_html/<siteSlug>/
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
    } finally {
      // Dans tous les cas, libérer le verrou
      if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
      }
      buildStatus.inProgress = false;
    }
  });
});

function updateSiteStatus(slug, status) {
  try {
    const sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf-8'));
    const site = sites.find(s => s.slug === slug);
    if (site) {
      site.status = status;
      fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), 'utf-8');
    }
  } catch (e) {
    console.error("Erreur mise à jour statut site", e);
  }
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Serveur Meta-Builder démarré sur http://localhost:${PORT}`);
});
