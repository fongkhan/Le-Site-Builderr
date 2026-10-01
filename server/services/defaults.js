// Contenu par défaut : pages de démonstration (site seedé) et thème de base.
// Figés (deep-freeze) : ces objets sont partagés, aucun appelant ne doit les muter.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const DEFAULT_PAGES = deepFreeze({
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
        },
        {
          blockType: "testimonials",
          title: "Ce que nos clients disent",
          testimonials: [
            { quote: "Le meilleur pain de la région ! Croustillant et savoureux.", author: "Marie Dupont", role: "Cliente régulière", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150" },
            { quote: "Des viennoiseries au vrai goût de beurre. Un régal chaque matin.", author: "Jean Martin", role: "Habitant de Clamart", avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150" }
          ]
        },
        {
          blockType: "faq",
          title: "Questions Fréquentes",
          items: [
            { question: "Proposez-vous des produits sans gluten ?", answer: "Nous fabriquons principalement des pains au levain traditionnel contenant du gluten, mais nous avons une gamme de gâteaux sans farine de blé." },
            { question: "Quels sont vos horaires de cuisson ?", answer: "Nos fournées ont lieu à 7h00, 11h30 et 16h30 pour vous garantir du pain chaud toute la journée." }
          ]
        },
        {
          blockType: "pricing",
          title: "Nos Formules Petit-Déjeuner",
          plans: [
            { name: "Formule Matin", price: "4.50 €", description: "Pour bien commencer la journée.", features: [{ feature: "1 Viennoiserie" }, { feature: "1 Café ou Thé" }, { feature: "1/2 Baguette beurre" }], ctaText: "Commander", isPopular: false },
            { name: "Formule Brunch", price: "12.50 €", description: "Le week-end ou pour les gourmands.", features: [{ feature: "2 Viennoiseries" }, { feature: "1 Jus de fruits frais" }, { feature: "1 Pain chaud au choix" }, { feature: "Assiette jambon-fromage" }], ctaText: "Réserver", isPopular: true }
          ]
        }
      ]
    }
  ]
});

const DEFAULT_THEME = deepFreeze({
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
});

// Pages de départ d'un NOUVEAU site : neutres et au nom du site (le contenu de
// démonstration de la boulangerie n'est réservé qu'au site seedé).
function starterPages(siteName, tagline) {
  const name = String(siteName || '').trim().slice(0, 120) || 'Mon site';
  const subtitle = String(tagline || '').trim().slice(0, 300) || 'Bienvenue ! Présentez ici votre activité en une phrase.';
  return {
    docs: [
      {
        title: "Accueil",
        slug: "home",
        layout: [
          { blockType: "hero", title: name, subtitle, ctaText: "Nous contacter" },
          {
            blockType: "features",
            title: "Ce que nous proposons",
            items: [
              { title: "Notre savoir-faire", description: "Décrivez ce qui fait la qualité de votre travail." },
              { title: "Nos services", description: "Listez vos principales prestations ou produits." },
              { title: "Notre engagement", description: "Expliquez pourquoi vos clients vous font confiance." }
            ]
          },
          { blockType: "contact", title: "Contactez-nous", subtitle: "Une question ? Écrivez-nous, nous vous répondrons rapidement.", ctaText: "Envoyer" }
        ]
      }
    ]
  };
}

module.exports = { DEFAULT_PAGES, DEFAULT_THEME, deepFreeze, starterPages };
