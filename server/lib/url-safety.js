// Liens saisis dans le contenu des sites (images, réseaux sociaux, lien des boutons…) :
// détection des schémas exécutables. Module pur, partagé par la validation des pages du
// CMS (services/content.js) et par Payload (payload.config.ts : champ ctaLink), pour que
// l'API REST de Payload refuse les mêmes liens que l'éditeur.

// Schémas d'URL exécutables : jamais acceptés dans un champ d'URL de bloc (image, avatar,
// lien Google, réseaux sociaux, lien des boutons), qui finit en href/src sur le site
// publié. Les champs de texte ne sont pas concernés : « JavaScript & TypeScript » est un
// intitulé légitime.
const DANGEROUS_URL = /^(?:javascript|vbscript)\s*:|^data\s*:\s*text\/html/i;

const UNSAFE_LINK_MESSAGE = 'Lien non autorisé (javascript:, vbscript: ou data:text/html).';

// Les navigateurs ignorent blancs et caractères de contrôle dans un schéma (« java\tscript: »).
// eslint-disable-next-line no-control-regex -- caractères de contrôle retirés volontairement
const isDangerousUrl = (value) => typeof value === 'string' && DANGEROUS_URL.test(value.replace(/[\u0000- ]/g, ''));

// Validateur au format Payload : true si accepté, sinon le message d'erreur. Seuls les
// schémas exécutables sont refusés : la sauvegarde automatique envoie des saisies
// partielles (« https:/ ») que le template ignore de lui-même.
const validateSafeUrl = (value) => (isDangerousUrl(value) ? UNSAFE_LINK_MESSAGE : true);

module.exports = { DANGEROUS_URL, isDangerousUrl, validateSafeUrl, UNSAFE_LINK_MESSAGE };
