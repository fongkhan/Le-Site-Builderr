// Remplacement atomique d'un dossier publié : on ne détruit JAMAIS la version en ligne
// avant qu'une copie complète soit prête (copie à côté, puis bascule par rename sur le
// même volume). En cas d'échec, l'ancienne version est restaurée et l'erreur relancée.
const fs = require('fs');

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

module.exports = { replaceDirAtomically };
