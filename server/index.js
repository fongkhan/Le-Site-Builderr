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

const ASTRO_PROJECT_DIR = path.resolve(__dirname, '../client-template');
const DIST_DIR = path.join(ASTRO_PROJECT_DIR, 'dist');
const PUBLIC_HTML_DIR = path.resolve(__dirname, '../simulated_public_html');
const LOCK_FILE = path.join(ASTRO_PROJECT_DIR, 'build.lock');

// Initialiser les fichiers si inexistants
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

if (!fs.existsSync(PAGES_FILE)) {
  fs.writeFileSync(PAGES_FILE, JSON.stringify(defaultPages, null, 2), 'utf-8');
}
if (!fs.existsSync(THEME_FILE)) {
  fs.writeFileSync(THEME_FILE, JSON.stringify(defaultTheme, null, 2), 'utf-8');
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

// Premier sync du CSS
writeThemeCss(defaultTheme);

// --- ENDPOINTS CMS ---

// Pages
app.get('/api/pages', (req, res) => {
  const data = fs.readFileSync(PAGES_FILE, 'utf-8');
  res.json(JSON.parse(data));
});

app.post('/api/pages', (req, res) => {
  fs.writeFileSync(PAGES_FILE, JSON.stringify(req.body, null, 2), 'utf-8');
  res.json({ success: true, message: "Pages enregistrées avec succès !" });
});

// Thème
app.get('/api/theme', (req, res) => {
  const data = fs.readFileSync(THEME_FILE, 'utf-8');
  res.json(JSON.parse(data));
});

app.post('/api/theme', (req, res) => {
  fs.writeFileSync(THEME_FILE, JSON.stringify(req.body, null, 2), 'utf-8');
  // Écrit aussi le CSS d'Astro
  writeThemeCss(req.body);
  res.json({ success: true, message: "Thème mis à jour avec succès !" });
});

// --- MOCK AI ENDPOINTS ---

// Assistant d'Onboarding (Routage Stack)
app.post('/api/onboard', async (req, res) => {
  const { prompt, provider } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Le prompt est requis." });
  }

  try {
    const result = await runOnboard(provider, prompt);
    res.json(result);
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
  error: null
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
  // 1. Vérification si un build est déjà en cours (Verrou physique)
  if (fs.existsSync(LOCK_FILE)) {
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] REJET : Tentative de build concurrente détectée (HTTP 429).\n`);
    return res.status(429).json({ message: 'Build déjà en cours. Requête mise de côté.' });
  }

  // 2. Poser le verrou
  fs.writeFileSync(LOCK_FILE, 'locked');
  buildStatus.inProgress = true;
  buildStatus.status = "running";
  buildStatus.error = null;

  fs.writeFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] DÉMARRAGE : Webhook reçu. Début du build Astro...\n`, 'utf-8');

  // Répondre immédiatement au client avec 202
  res.status(202).json({ message: 'Build démarré avec succès.' });

  // 3. Exécuter le build et le déploiement de manière asynchrone
  const isWindows = process.platform === "win32";
  
  // Vérifier si node_modules existe dans client-template, sinon faire npm install
  const needsInstall = !fs.existsSync(path.join(ASTRO_PROJECT_DIR, 'node_modules'));
  const installCmd = needsInstall ? 'npm install && ' : '';
  
  const cmd = isWindows
    ? `cd /d "${ASTRO_PROJECT_DIR}" && ${installCmd}npm run build`
    : `cd "${ASTRO_PROJECT_DIR}" && ${installCmd}npm run build`;

  fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Commande exécutée : ${cmd}\n`);

  exec(cmd, (error, stdout, stderr) => {
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
      return;
    }

    fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] RÉSULTAT DU BUILD ASTRO :\n${stdout}\n`);
    fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] Astro compilé. Copie des fichiers vers simulated_public_html...\n`);

    // 4. Déploiement des fichiers statiques dans le dossier web
    // Utilisation d'une copie Node.js récursive native pour fonctionner partout sans rsync
    try {
      if (!fs.existsSync(PUBLIC_HTML_DIR)) {
        fs.mkdirSync(PUBLIC_HTML_DIR, { recursive: true });
      }

      // Vider le dossier de destination pour simuler rsync --delete
      fs.rmSync(PUBLIC_HTML_DIR, { recursive: true, force: true });
      fs.mkdirSync(PUBLIC_HTML_DIR, { recursive: true });

      // Copier dist/ vers simulated_public_html/
      fs.cpSync(DIST_DIR, PUBLIC_HTML_DIR, { recursive: true, force: true });

      fs.appendFileSync(LOGS_FILE, `[${new Date().toLocaleTimeString()}] DÉPLOIEMENT SUCCÈS : Fichiers synchronisés vers ${PUBLIC_HTML_DIR} !\n`);
      
      buildStatus.status = "success";
      buildStatus.lastCompleted = new Date().toLocaleString();
    } catch (deployError) {
      console.error(`Erreur de déploiement : ${deployError.message}`);
      fs.appendFileSync(LOGS_FILE, `\n[${new Date().toLocaleTimeString()}] ERREUR DE DÉPLOIEMENT :\n${deployError.message}\n`);
      buildStatus.status = "error";
      buildStatus.error = deployError.message;
    } finally {
      // Dans tous les cas, libérer le verrou
      if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
      }
      buildStatus.inProgress = false;
    }
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Serveur Meta-Builder démarré sur http://localhost:${PORT}`);
});
