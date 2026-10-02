// Remplacement atomique d'un dossier publié : on ne détruit JAMAIS la version en ligne
// avant qu'une copie complète soit prête (copie à côté, puis bascule par rename sur le
// même volume). En cas d'échec, l'ancienne version est restaurée et l'erreur relancée.
const fs = require('fs');
const path = require('path');

function replaceDirAtomically(srcDir, destDir, suffix) {
  const tmpDir = `${destDir}.tmp-${suffix}`;
  const oldDir = `${destDir}.old-${suffix}`;
  try {
    // 1. Copier le nouveau contenu à côté
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.cpSync(srcDir, tmpDir, { recursive: true, force: true });
    // 2. Bascule : écarter l'ancien, promouvoir le nouveau, supprimer l'ancien
    fs.rmSync(oldDir, { recursive: true, force: true });
    if (fs.existsSync(destDir)) fs.renameSync(destDir, oldDir);
    fs.renameSync(tmpDir, destDir);
    fs.rmSync(oldDir, { recursive: true, force: true });
  } catch (err) {
    // Si la cible a été écartée mais pas remplacée, la restaurer
    try {
      if (!fs.existsSync(destDir) && fs.existsSync(oldDir)) fs.renameSync(oldDir, destDir);
    } catch (restoreErr) {
      console.error('Échec de restauration après une bascule de dossier ratée :', restoreErr.message);
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

// Dossiers laissés par une bascule interrompue (crash, kill -9) : `X.tmp-S` (copie
// partielle) et `X.old-S` (ancienne version écartée). Suffixes réels : <slug>, 'draft',
// 'rollback'.
const SWAP_LEFTOVER = /\.(tmp|old)-[A-Za-z0-9_-]+$/;

// Reprise au boot : un `X.old-S` est restauré en X si X est absent (le site revient en
// ligne), sinon supprimé ; un `X.tmp-S` est toujours supprimé. Un X existant n'est
// JAMAIS écrasé. Renvoie la liste des actions effectuées (journal).
function recoverInterruptedSwaps(rootDir) {
  const actions = [];
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return actions; // racine absente : rien à reprendre
  }
  const leftovers = entries
    .filter((e) => e.isDirectory() && SWAP_LEFTOVER.test(e.name))
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

module.exports = { replaceDirAtomically, recoverInterruptedSwaps, SWAP_LEFTOVER };
