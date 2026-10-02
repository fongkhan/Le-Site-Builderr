import type { Block } from '../../../types';
import { withClientId, type EditorBlock } from '../lib/editorModel';

// Données des types de blocs (sans composant) : libellé, valeurs par défaut, gabarit d'un
// nouvel élément de liste. Le registre (registry.ts) y associe éditeur et aperçu.
// Les 11 types et leurs champs suivent server/payload.config.ts (collection pages, layout).

export const BLOCK_TYPES = [
  'hero',
  'features',
  'product-grid',
  'gallery',
  'testimonials',
  'faq',
  'pricing',
  'contact',
  'appointment',
  'info',
  'footer',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export interface BlockData {
  label: string;
  icon: string;
  /** Aide affichée au survol du bouton d'ajout */
  description: string;
  /** Contenu d'un bloc ajouté dans l'éditeur */
  defaults: Block;
  /** Gabarit d'un nouvel élément de la liste principale (blocs à liste uniquement) */
  newItem?: unknown;
}

// Gabarits des nouveaux éléments de liste (bouton « + Ajouter … »)
export const NEW_ITEMS = {
  features: { title: 'Nouveau service', description: 'Description.' },
  'product-grid': { name: 'Nouveau produit', price: '0.00 €', image: '' },
  gallery: '',
  testimonials: { quote: 'Un retour client.', author: 'Prénom Nom', role: 'Client', avatar: '', rating: 5 },
  faq: { question: 'Nouvelle question ?', answer: 'Réponse.' },
  pricing: { name: 'Nouvelle formule', price: '0.00 €', description: '', features: [] as { feature: string }[], ctaText: 'Choisir', isPopular: false },
  appointment: { name: 'Nouvelle prestation' },
} satisfies Partial<Record<BlockType, unknown>>;

/** Nouvelle caractéristique d'une formule (bloc Tarifs) */
export const NEW_PLAN_FEATURE = { feature: '' };

export const BLOCK_DATA: Record<BlockType, BlockData> = {
  hero: {
    label: 'Bannière',
    icon: '🎯',
    description: "Grand titre d'accroche avec sous-titre, bouton et image de fond.",
    defaults: {
      blockType: 'hero',
      title: 'Nouveau titre Hero',
      subtitle: 'Une description intéressante ici.',
      ctaText: "Bouton d'action",
      backgroundImage: '',
    },
  },
  features: {
    label: 'Services',
    icon: '✨',
    description: 'Liste de services ou d’atouts (titre + description).',
    defaults: {
      blockType: 'features',
      title: 'Nos Services',
      items: [
        { title: 'Service 1', description: 'Description du service 1.' },
        { title: 'Service 2', description: 'Description du service 2.' },
      ],
    },
    newItem: NEW_ITEMS.features,
  },
  'product-grid': {
    label: 'Produits',
    icon: '🛍️',
    description: 'Grille de produits avec prix et photo.',
    defaults: {
      blockType: 'product-grid',
      title: 'Produits Disponibles',
      products: [
        { name: 'Produit A', price: '10.00 €', image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=300' },
      ],
    },
    newItem: NEW_ITEMS['product-grid'],
  },
  gallery: {
    label: 'Galerie',
    icon: '🖼️',
    description: 'Mosaïque de photos.',
    defaults: {
      blockType: 'gallery',
      title: 'Galerie Photos',
      images: [
        'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=300',
        'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=300',
      ],
    },
    newItem: NEW_ITEMS.gallery,
  },
  testimonials: {
    label: 'Témoignages',
    icon: '💬',
    description: 'Avis de clients avec note et photo.',
    defaults: {
      blockType: 'testimonials',
      title: 'Ce que nos clients disent',
      testimonials: [
        { quote: 'Un service exceptionnel, je recommande !', author: 'Marie Dupont', role: 'Cliente régulière', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150', rating: 5 },
        { quote: "Une équipe à l'écoute et professionnelle.", author: 'Jean Martin', role: 'Client', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150', rating: 5 },
      ],
    },
    newItem: NEW_ITEMS.testimonials,
  },
  faq: {
    label: 'FAQ',
    icon: '❓',
    description: 'Questions fréquentes et leurs réponses.',
    defaults: {
      blockType: 'faq',
      title: 'Questions Fréquentes',
      items: [
        { question: 'Comment vous contacter ?', answer: 'Par téléphone, email ou via le formulaire de contact.' },
        { question: 'Quels sont vos horaires ?', answer: 'Du lundi au samedi, de 9h à 19h.' },
      ],
    },
    newItem: NEW_ITEMS.faq,
  },
  pricing: {
    label: 'Tarifs',
    icon: '💶',
    description: 'Formules tarifaires comparées (prix, caractéristiques).',
    defaults: {
      blockType: 'pricing',
      title: 'Nos Formules',
      plans: [
        { name: 'Essentiel', price: '9.90 €', description: 'Pour démarrer.', features: [{ feature: 'Avantage 1' }, { feature: 'Avantage 2' }], ctaText: 'Choisir', isPopular: false },
        { name: 'Premium', price: '19.90 €', description: 'Le plus complet.', features: [{ feature: 'Avantage 1' }, { feature: 'Avantage 2' }, { feature: 'Avantage 3' }], ctaText: 'Choisir', isPopular: true },
      ],
    },
    newItem: NEW_ITEMS.pricing,
  },
  contact: {
    label: 'Contact',
    icon: '✉️',
    description: 'Formulaire de contact (messages reçus par email).',
    defaults: {
      blockType: 'contact',
      title: 'Contactez-nous',
      subtitle: 'Une question, un projet ? Écrivez-nous, nous répondons rapidement.',
      ctaText: 'Envoyer le message',
    },
  },
  appointment: {
    label: 'Prise de RDV',
    icon: '📅',
    description: 'Demande de rendez-vous avec choix de la prestation.',
    defaults: {
      blockType: 'appointment',
      title: 'Prendre rendez-vous',
      subtitle: 'Choisissez une prestation et proposez un créneau : nous vous confirmons rapidement.',
      ctaText: 'Demander un rendez-vous',
      services: [{ name: 'Prestation 1' }, { name: 'Prestation 2' }],
    },
    newItem: NEW_ITEMS.appointment,
  },
  info: {
    label: 'Infos pratiques',
    icon: '📍',
    description: 'Adresse, téléphone, email et horaires.',
    defaults: {
      blockType: 'info',
      title: 'Infos pratiques',
      address: '12 rue de la République, 92140 Clamart',
      phone: '01 23 45 67 89',
      email: 'contact@exemple.fr',
      hours: 'Lun–Ven : 9h–19h\nSam : 9h–13h\nDim : fermé',
      googleBusinessUrl: '',
    },
  },
  footer: {
    label: 'Pied de page',
    icon: '🔻',
    description: 'Mentions de bas de page et réseaux sociaux.',
    defaults: {
      blockType: 'footer',
      text: '© Mon entreprise — Tous droits réservés',
      socials: { facebook: '', instagram: '', linkedin: '', x: '' },
    },
  },
};

export function isBlockType(type: string): type is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(type);
}

// Libellé lisible d'un type de bloc (« Produits » plutôt que « product-grid »).
export function blockLabel(type: string): string {
  return isBlockType(type) ? BLOCK_DATA[type].label : type;
}

// Nouveau bloc prêt à insérer : copie des valeurs par défaut + identifiant client.
export function createBlock(type: BlockType): EditorBlock {
  return withClientId(structuredClone(BLOCK_DATA[type].defaults));
}
