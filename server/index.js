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
app.post('/api/onboard', (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Le prompt est requis." });
  }

  const text = prompt.toLowerCase();
  const features = {
    blog_or_news: false,
    e_commerce: false,
    multi_store: false
  };

  const stack = {
    astro_mode: "ssg",
    need_payload: false,
    need_medusajs: false,
    need_stripe: false
  };

  // Logique de routage dynamique basée sur les mots-clés
  if (text.includes("vend") || text.includes("boutique") || text.includes("e-commerce") || text.includes("achat") || text.includes("panier") || text.includes("commerce")) {
    features.e_commerce = true;
    stack.need_stripe = true;
    if (text.includes("multi-boutique") || text.includes("stocks") || text.includes("complexe")) {
      features.multi_store = true;
      stack.need_payload = true;
      stack.need_medusajs = true;
      stack.astro_mode = "hybrid";
    } else {
      stack.need_payload = true;
      stack.astro_mode = "ssg"; // SSG + Stripe Checkout
    }
  }

  if (text.includes("blog") || text.includes("nouvelles") || text.includes("actualités") || text.includes("articles") || text.includes("portfolio")) {
    features.blog_or_news = true;
    stack.need_payload = true;
  }

  // Si aucun besoin dynamique spécifique mais demande modifiable
  if (text.includes("modifier") || text.includes("cms") || text.includes("administrer") || text.includes("gestion")) {
    stack.need_payload = true;
  }

  // Déduire un nom de site
  let siteName = "Mon Site Composable";
  const matchBoulangerie = prompt.match(/(?:pour ma|de la|nommé)\s+([^,.]+)/i);
  if (matchBoulangerie && matchBoulangerie[1]) {
    siteName = matchBoulangerie[1].trim();
  } else if (text.includes("boulangerie")) {
    siteName = "La Boulangerie de Clamart";
  }

  res.json({
    site_name: siteName,
    features,
    stack_requirements: stack
  });
});

// Extraction de thème depuis une image/logo
app.post('/api/extract-design', (req, res) => {
  // Simule une extraction à partir d'un type d'ambiance envoyé
  const { ambiance } = req.body; // 'nature', 'chaleureux', 'techno', 'minimal'
  
  let palette = {
    primary: "#3B2F2F",
    secondary: "#F5E6CC",
    background: "#FFFFFF",
    text: "#1A1A1A",
    fonts: { heading: "Playfair Display", body: "Inter" },
    radius: "8px"
  };

  if (ambiance === 'nature') {
    palette = {
      primary: "#2E5A44",
      secondary: "#EAE7DC",
      background: "#F9F8F6",
      text: "#1E2F23",
      fonts: { heading: "Outfit", body: "Plus Jakarta Sans" },
      radius: "16px"
    };
  } else if (ambiance === 'techno') {
    palette = {
      primary: "#6366F1",
      secondary: "#312E81",
      background: "#0F172A",
      text: "#F8FAFC",
      fonts: { heading: "Space Grotesk", body: "DM Sans" },
      radius: "6px"
    };
  } else if (ambiance === 'chaleureux') {
    palette = {
      primary: "#D97706",
      secondary: "#FEF3C7",
      background: "#FFFBEB",
      text: "#78350F",
      fonts: { heading: "Lora", body: "Karla" },
      radius: "20px"
    };
  } else if (ambiance === 'minimal') {
    palette = {
      primary: "#000000",
      secondary: "#E5E5E5",
      background: "#FFFFFF",
      text: "#111111",
      fonts: { heading: "Syncopate", body: "Cabinet Grotesk" },
      radius: "0px"
    };
  }

  res.json({
    theme: {
      colors: {
        primary: palette.primary,
        secondary: palette.secondary,
        background: palette.background,
        text: palette.text
      },
      fonts: palette.fonts,
      radius: palette.radius
    }
  });
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

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Serveur Meta-Builder démarré sur http://localhost:${PORT}`);
});
