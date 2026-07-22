import type { Block } from '../../types';

// Contenus par défaut lors de l'ajout d'un bloc dans l'éditeur
export const BLOCK_DEFAULTS: Record<string, Block> = {
  hero: {
    blockType: 'hero',
    title: 'Nouveau titre Hero',
    subtitle: 'Une description intéressante ici.',
    ctaText: "Bouton d'action",
    backgroundImage: '',
  },
  features: {
    blockType: 'features',
    title: 'Nos Services',
    items: [
      { title: 'Service 1', description: 'Description du service 1.' },
      { title: 'Service 2', description: 'Description du service 2.' },
    ],
  },
  'product-grid': {
    blockType: 'product-grid',
    title: 'Produits Disponibles',
    products: [
      { name: 'Produit A', price: '10.00 €', image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=300' },
    ],
  },
  gallery: {
    blockType: 'gallery',
    title: 'Galerie Photos',
    images: [
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=300',
      'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=300',
    ],
  },
  testimonials: {
    blockType: 'testimonials',
    title: 'Ce que nos clients disent',
    testimonials: [
      { quote: 'Un service exceptionnel, je recommande !', author: 'Marie Dupont', role: 'Cliente régulière', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150' },
      { quote: 'Une équipe à l\'écoute et professionnelle.', author: 'Jean Martin', role: 'Client', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150' },
    ],
  },
  faq: {
    blockType: 'faq',
    title: 'Questions Fréquentes',
    items: [
      { question: 'Comment vous contacter ?', answer: 'Par téléphone, email ou via le formulaire de contact.' },
      { question: 'Quels sont vos horaires ?', answer: 'Du lundi au samedi, de 9h à 19h.' },
    ],
  },
  pricing: {
    blockType: 'pricing',
    title: 'Nos Formules',
    plans: [
      { name: 'Essentiel', price: '9.90 €', description: 'Pour démarrer.', features: [{ feature: 'Avantage 1' }, { feature: 'Avantage 2' }], ctaText: 'Choisir', isPopular: false },
      { name: 'Premium', price: '19.90 €', description: 'Le plus complet.', features: [{ feature: 'Avantage 1' }, { feature: 'Avantage 2' }, { feature: 'Avantage 3' }], ctaText: 'Choisir', isPopular: true },
    ],
  },
  contact: {
    blockType: 'contact',
    title: 'Contactez-nous',
    subtitle: 'Une question, un projet ? Écrivez-nous, nous répondons rapidement.',
    ctaText: 'Envoyer le message',
  },
  appointment: {
    blockType: 'appointment',
    title: 'Prendre rendez-vous',
    subtitle: 'Choisissez une prestation et proposez un créneau : nous vous confirmons rapidement.',
    ctaText: 'Demander un rendez-vous',
    services: [
      { name: 'Prestation 1' },
      { name: 'Prestation 2' },
    ],
  },
  info: {
    blockType: 'info',
    title: 'Infos pratiques',
    address: '12 rue de la République, 92140 Clamart',
    phone: '01 23 45 67 89',
    email: 'contact@exemple.fr',
    hours: 'Lun–Ven : 9h–19h\nSam : 9h–13h\nDim : fermé',
  },
  footer: {
    blockType: 'footer',
    text: '© Mon entreprise — Tous droits réservés',
    socials: { facebook: '', instagram: '', linkedin: '', x: '' },
  },
};

export const BLOCK_LABELS: Record<string, string> = {
  hero: 'Hero',
  features: 'Features',
  'product-grid': 'ProductGrid',
  gallery: 'Gallery',
  testimonials: 'Témoignages',
  faq: 'FAQ',
  pricing: 'Tarifs',
  contact: 'Contact',
  appointment: 'Prise de RDV',
  info: 'Infos pratiques',
  footer: 'Pied de page',
};
