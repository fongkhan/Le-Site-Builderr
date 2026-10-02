// Politique de mot de passe des comptes (création, modification, réinitialisation).
// Fonction pure, sans appel réseau : longueur, différence avec l'email, liste noire.
const MIN_LENGTH = 12;
const MAX_LENGTH = 256;

// Mots de passe courants (comparaison insensible à la casse). Liste volontairement
// courte : la longueur minimale écarte déjà l'essentiel des mots de passe faibles.
const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', 'password12345', 'passwordpassword',
  'motdepasse123', 'motdepasse1234', 'motdepassemotdepasse', 'motdepasse!!',
  'azertyuiop12', 'azertyuiop123', 'azertyuiop1234', 'qwertyuiop12', 'qwertyuiop123',
  '123456789012', '1234567890123', '000000000000', '111111111111',
  'aaaaaaaaaaaa', 'abcdefghijkl', 'abc123abc123', 'iloveyou1234',
  'administrateur', 'administrator', 'admin1234567', 'adminadmin12', 'bienvenue123',
  'soleil123456', 'changeme1234', 'welcome12345', 'letmein12345',
]);

// null si le mot de passe est accepté, sinon un message en français.
function checkPassword(pwd, { email } = {}) {
  if (typeof pwd !== 'string' || pwd.length < MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_LENGTH} caractères.`;
  }
  if (pwd.length > MAX_LENGTH) {
    return `Le mot de passe ne doit pas dépasser ${MAX_LENGTH} caractères.`;
  }
  const lower = pwd.toLowerCase();
  const mail = String(email || '').trim().toLowerCase();
  if (mail) {
    const local = mail.split('@')[0];
    if (lower === mail || (local && lower === local)) {
      return "Le mot de passe ne doit pas être identique à l'adresse email.";
    }
  }
  if (COMMON_PASSWORDS.has(lower)) {
    return 'Ce mot de passe est trop courant : choisissez-en un autre.';
  }
  return null;
}

module.exports = { checkPassword, MIN_LENGTH, MAX_LENGTH };
