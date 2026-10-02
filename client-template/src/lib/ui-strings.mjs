// Libellés d'interface du site public (hors contenu saisi dans le CMS), par langue.
// Volontairement séparé de i18n.mjs (règle de chemins partagée avec le serveur et
// vérifiée par un test de parité). Toute clé doit exister dans chaque langue (test
// unitaire server/tests/unit/ui-strings.test.mjs) ; le français sert de repli.

export const UI_STRINGS = {
  fr: {
    skipLink: 'Aller au contenu',
    mainNav: 'Navigation principale',
    socialLinks: 'Réseaux sociaux',
    consentLabel: 'Gestion des cookies',
    consentText: "Ce site souhaite utiliser des cookies de mesure d'audience pour améliorer votre expérience. Votre choix est conservé 6 mois et modifiable à tout moment.",
    consentAccept: 'Accepter',
    consentRefuse: 'Continuer sans accepter',
    consentReopen: 'Gérer les cookies',
    consentReopenButton: 'Cookies',
    popular: 'Populaire',
    order: 'Commander',
    orderProduct: 'Commander « {name} »',
    infoTitle: 'Infos pratiques',
    googleListing: 'Voir notre fiche Google',
    contactTitle: 'Contactez-nous',
    contactCta: 'Envoyer le message',
    appointmentTitle: 'Prendre rendez-vous',
    appointmentCta: 'Demander un rendez-vous',
    formName: 'Votre nom',
    formEmail: 'Votre email',
    formPhone: 'Votre téléphone',
    formService: 'Prestation souhaitée',
    formServicePlaceholder: 'Prestation souhaitée…',
    formSlot: 'Créneau souhaité',
    formSlotPlaceholder: 'Créneau souhaité (ex. mardi après-midi)',
    formDetails: 'Précisions (facultatif)',
    formDetailsPlaceholder: 'Précisions (facultatif)…',
    formMessage: 'Votre message',
    formMessagePlaceholder: 'Votre message…',
    formHoneypot: 'Société (ne pas remplir)',
    formSending: 'Envoi en cours…',
    contactOk: 'Merci, votre message a bien été envoyé !',
    contactError: "Impossible d'envoyer le message pour le moment.",
    appointmentOk: 'Merci ! Votre demande de rendez-vous a bien été envoyée.',
    appointmentError: "Impossible d'envoyer la demande pour le moment.",
    formInvalid: 'Vérifiez votre nom, votre email et votre message.',
    formRateLimited: "Trop d'envois en peu de temps : réessayez dans quelques minutes.",
    notFoundTitle: 'Page introuvable',
    notFoundText: "La page demandée n'existe pas ou a été déplacée.",
    notFoundHome: "Retour à l'accueil",
    notFoundBlog: 'Voir les actualités',
  },
  en: {
    skipLink: 'Skip to content',
    mainNav: 'Main navigation',
    socialLinks: 'Social media',
    consentLabel: 'Cookie settings',
    consentText: 'This site would like to use audience measurement cookies to improve your experience. Your choice is kept for 6 months and can be changed at any time.',
    consentAccept: 'Accept',
    consentRefuse: 'Continue without accepting',
    consentReopen: 'Manage cookies',
    consentReopenButton: 'Cookies',
    popular: 'Popular',
    order: 'Order',
    orderProduct: 'Order “{name}”',
    infoTitle: 'Practical information',
    googleListing: 'See our Google listing',
    contactTitle: 'Contact us',
    contactCta: 'Send message',
    appointmentTitle: 'Book an appointment',
    appointmentCta: 'Request an appointment',
    formName: 'Your name',
    formEmail: 'Your email',
    formPhone: 'Your phone number',
    formService: 'Desired service',
    formServicePlaceholder: 'Desired service…',
    formSlot: 'Preferred time',
    formSlotPlaceholder: 'Preferred time (e.g. Tuesday afternoon)',
    formDetails: 'Details (optional)',
    formDetailsPlaceholder: 'Details (optional)…',
    formMessage: 'Your message',
    formMessagePlaceholder: 'Your message…',
    formHoneypot: 'Company (leave blank)',
    formSending: 'Sending…',
    contactOk: 'Thank you, your message has been sent!',
    contactError: 'Unable to send the message right now.',
    appointmentOk: 'Thank you! Your appointment request has been sent.',
    appointmentError: 'Unable to send the request right now.',
    formInvalid: 'Please check your name, email address and message.',
    formRateLimited: 'Too many submissions in a short time: please try again in a few minutes.',
    notFoundTitle: 'Page not found',
    notFoundText: 'The page you are looking for does not exist or has been moved.',
    notFoundHome: 'Back to home',
    notFoundBlog: 'Read the news',
  },
};

/**
 * Libellé `key` dans la langue `locale` (repli sur le français, puis sur la clé).
 * `vars` remplace les marqueurs {nom} (texte brut : Astro échappe au rendu).
 */
export function t(locale, key, vars) {
  const dict = Object.hasOwn(UI_STRINGS, locale) ? UI_STRINGS[locale] : UI_STRINGS.fr;
  let text = Object.hasOwn(dict, key) ? dict[key] : Object.hasOwn(UI_STRINGS.fr, key) ? UI_STRINGS.fr[key] : key;
  if (vars) text = text.replace(/\{(\w+)\}/g, (m, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
  return text;
}
