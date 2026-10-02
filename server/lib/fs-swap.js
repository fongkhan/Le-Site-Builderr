// Remplacement atomique d'un dossier publié : on ne détruit JAMAIS la version en ligne
// avant qu'une copie complète soit prête (copie à côté, puis bascule par rename sur le
// même volume). En cas d'échec, l'ancienne version est restaurée et l'erreur relancée.
const fs = require('fs');
const path = require('path');

// Marqueur déposé dans les dossiers de bascule (`X.tmp-S`, `X.old-S`) : la reprise au
// boot n'agit QUE sur les dossiers qui le portent. Un dossier qui ressemble seulement à
// un reste de bascule (documentRoot « boutique.old-2024 », dossier caché « .tmp-cache »)
// n'est jamais touché.
const SWAP_MARKER = '.swap-marker';

function writeMarker(dir) {
  fs.writeFileSync(path.join(dir, SWAP_MARKER), `bascule interrompue ${new Date().toISOString()}\n`);
}

function removeMarker(dir) {
  fs.rmSync(path.join(dir, SWAP_MARKER), { force: true });
}

function hasMarker(dir) {
  try {
    return fs.lstatSync(path.join(dir, SWAP_MARKER)).isFile();
  } catch {
    return false;
  }
}

function replaceDirAtomically(srcDir, destDir, suffix) {
  const tmpDir = `${destDir}.tmp-${suffix}`;
  const oldDir = `${destDir}.old-${suffix}`;
  try {
    // 1. Copier le nouveau contenu à côté (marqué : une copie partielle sera jetée au boot)
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    writeMarker(tmpDir);
    fs.cpSync(srcDir, tmpDir, { recursive: true, force: true });
    // 2. Bascule : écarter l'ancien (marqué : restauré au boot si la cible manque),
    //    promouvoir le nouveau (démarqué AVANT : un dossier en ligne ne porte jamais le
    //    marqueur), supprimer l'ancien
    fs.rmSync(oldDir, { recursive: true, force: true });
    if (fs.existsSync(destDir)) {
      fs.renameSync(destDir, oldDir);
      writeMarker(oldDir);
    }
    removeMarker(tmpDir);
    fs.renameSync(tmpDir, destDir);
    fs.rmSync(oldDir, { recursive: true, force: true });
  } catch (err) {
    // Si la cible a été écartée mais pas remplacée, la restaurer
    try {
      if (!fs.existsSync(destDir) && fs.existsSync(oldDir)) {
        fs.renameSync(oldDir, destDir);
        removeMarker(destDir);
      }
    } catch (restoreErr) {
      console.error('Échec de restauration après une bascule de dossier ratée :', restoreErr.message);
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

// Dossiers laissés par une bascule interrompue (crash, kill -9) : `X.tmp-S` (copie
// partielle) et `X.old-S` (ancienne version écartée). Suffixes réels : <slug>, 'draft',
// 'rollback'. Le nom seul ne suffit pas : il faut aussi le marqueur.
const SWAP_LEFTOVER = /\.(tmp|old)-[A-Za-z0-9_-]+$/;

// Reprise au boot : un `X.old-S` marqué est restauré en X si X est absent (le site
// revient en ligne), sinon supprimé ; un `X.tmp-S` marqué est toujours supprimé. Un X
// existant n'est JAMAIS écrasé, un dossier sans marqueur JAMAIS touché. Renvoie la liste
// des actions effectuées (journal).
function recoverInterruptedSwaps(rootDir) {
  const actions = [];
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return actions; // racine absente : rien à reprendre
  }
  const leftovers = entries
    .filter((e) => e.isDirectory() && SWAP_LEFTOVER.test(e.name) && hasMarker(path.join(rootDir, e.name)))
    .map((e) => {
      const match = e.name.match(SWAP_LEFTOVER);
      return { name: e.name, kind: match[1], base: e.name.slice(0, match.index) };
    });
  // Les .old d'abord (restauration), puis les .tmp (copies partielles à jeter).
  for (const kind of ['old', 'tmp']) {
    for (const item of leftovers.filter((l) => l.kind === kind)) {
      const leftoverPath = path.join(rootDir, item.name);
      try {
        if (kind === 'old' && item.base && !fs.existsSync(path.join(rootDir, item.base))) {
          fs.renameSync(leftoverPath, path.join(rootDir, item.base));
          removeMarker(path.join(rootDir, item.base));
          actions.push(`restauré : ${item.name} → ${item.base}`);
        } else {
          fs.rmSync(leftoverPath, { recursive: true, force: true });
          actions.push(`supprimé : ${item.name}`);
        }
      } catch (err) {
        actions.push(`échec sur ${item.name} : ${err.message}`);
      }
    }
  }
  return actions;
}

// Requête statique (/preview, /draft) visant un dossier de bascule : seul le PREMIER
// segment compte (les dossiers de bascule sont frères des sites), après décodage et
// normalisation (« /a/../site.old-x/ » vise bien « site.old-x »). Un fichier
// « media/affiche.old-2023.png » reste servi.
const SWAP_DIR_SEGMENT = /\.(tmp|old)-/;
function isSwapDirRequest(reqPath) {
  const raw = String(reqPath || '');
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* chemin brut */ }
  return [raw, decoded].some((p) => {
    const normalized = path.posix.normalize(`/${p.replace(/\\/g, '/')}`);
    const first = normalized.split('/').find(Boolean) || '';
    return SWAP_DIR_SEGMENT.test(first);
  });
}

module.exports = { replaceDirAtomically, recoverInterruptedSwaps, isSwapDirRequest, SWAP_LEFTOVER, SWAP_MARKER };
