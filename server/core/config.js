// Configuration centrale : variables d'environnement et racines du système de fichiers.
// Aucun effet de bord à l'import : la création des dossiers passe par ensureRuntimeDirs().
const fs = require('fs');
const path = require('path');

// Entier lu dans l'environnement ; valeur absente, invalide ou nulle → valeur par défaut.
function envInt(name, fallback) {
  return Number.parseInt(process.env[name] ?? '', 10) || fallback;
}

const SERVER_DIR = path.resolve(__dirname, '..');
const PROJECT_DIR = path.dirname(SERVER_DIR);

const PORT = process.env.PORT || 4000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim());

// Dossier de données et chemins
const DATA_DIR = path.join(SERVER_DIR, 'data');
const LOGS_FILE = path.join(DATA_DIR, 'build-logs.txt');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');

const ASTRO_PROJECT_DIR = path.join(PROJECT_DIR, 'client-template');
const DIST_DIR = path.join(ASTRO_PROJECT_DIR, 'dist');
const LOCK_FILE = path.join(ASTRO_PROJECT_DIR, 'build.lock');
const PUBLIC_HTML_DIR = path.join(PROJECT_DIR, 'simulated_public_html');
// Racine des dépôts de sources provisionnés (cohérent avec l'onboarding)
const REPOSITORIES_DIR = path.join(PROJECT_DIR, 'repositories');
// Versions de déploiement conservées pour rollback (N dernières par site)
const RELEASES_DIR = path.join(PROJECT_DIR, 'releases');
// Prévisualisations brouillon (build isolé, jamais servi comme site de production)
const DRAFTS_DIR = path.join(PROJECT_DIR, 'drafts');
// Sauvegardes automatiques (contenu des sites : pages/thème/articles)
const BACKUPS_DIR = path.join(PROJECT_DIR, 'backups');
// Fichiers de la médiathèque (collection Payload « media », staticDir)
const UPLOADS_DIR = path.join(SERVER_DIR, 'uploads');

const DEPLOY_KEEP_RELEASES = envInt('DEPLOY_KEEP_RELEASES', 3);
const BACKUP_KEEP = envInt('BACKUP_KEEP', 14);
const BACKUP_INTERVAL_HOURS = envInt('BACKUP_INTERVAL_HOURS', 24);
const BACKUP_ENABLED = process.env.BACKUP_ENABLED === 'true';

// Dossiers qui doivent exister dès le boot : données, production simulée (cible du scan
// par défaut, créée par aucun autre chemin avant le premier déploiement) et brouillons
// (servis statiquement sous /draft).
function ensureRuntimeDirs() {
  for (const dir of [DATA_DIR, PUBLIC_HTML_DIR, DRAFTS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// Fichiers de données par site (fallback JSON de Payload + compteurs de visites)
function getSitePagesFile(slug) {
  return path.join(DATA_DIR, `site_${slug}_pages.json`);
}

function getSiteThemeFile(slug) {
  return path.join(DATA_DIR, `site_${slug}_theme.json`);
}

function getSitePostsFile(slug) {
  return path.join(DATA_DIR, `posts_${slug}.json`);
}

function getSiteStatsFile(slug) {
  return path.join(DATA_DIR, `stats_${slug}.json`);
}

module.exports = {
  envInt,
  SERVER_DIR,
  PROJECT_DIR,
  PORT,
  IS_PRODUCTION,
  FRONTEND_ORIGINS,
  DATA_DIR,
  LOGS_FILE,
  SITES_FILE,
  ASTRO_PROJECT_DIR,
  DIST_DIR,
  LOCK_FILE,
  PUBLIC_HTML_DIR,
  REPOSITORIES_DIR,
  RELEASES_DIR,
  DRAFTS_DIR,
  BACKUPS_DIR,
  UPLOADS_DIR,
  DEPLOY_KEEP_RELEASES,
  BACKUP_KEEP,
  BACKUP_INTERVAL_HOURS,
  BACKUP_ENABLED,
  ensureRuntimeDirs,
  getSitePagesFile,
  getSiteThemeFile,
  getSitePostsFile,
  getSiteStatsFile,
};
