# Changelog

Toutes les modifications notables apportées à ce projet sont documentées dans ce fichier.

## [1.0.0] - 2026-06-19

### Ajouts

- **Initialisation du projet :**
  - Configuration du dossier racine avec scripts de démarrage automatique.
  - Création de la configuration Git (`.gitignore`, `README.md`).

- **Orchestrateur Frontend (`orchestrator/`) :**
  - Création d'une application React/TypeScript avec Vite.
  - Intégration d'un design sombre haut de gamme avec animations fluides et transitions.
  - Module d'Onboarding IA pour saisir les descriptions de projets et afficher le schéma d'architecture dynamique.
  - Module de Design Prédictif permettant l'extraction de thèmes, la prévisualisation instantanée et la modification en WYSIWYG.
  - Module d'Édition de Pages par Blocs (similaire au mode Blocks de Payload CMS) avec synchronisation en temps réel du site.
  - Module de déploiement affichant les logs de compilation Astro en direct et simulant les limitations de charge o2switch.

- **Serveur API & Webhook (`server/`) :**
  - Création d'un serveur Node.js/Express.
  - Endpoints pour récupérer/enregistrer la configuration des pages et du design du thème.
  - Simulateur IA d'onboarding analysant les requêtes en langage naturel et déduisant la stack technique adaptée.
  - Webhook de déploiement `/webhook/rebuild` implémentant le verrouillage de build par fichier `build.lock` et la distribution du build statique.

- **Template Client Astro (`client-template/`) :**
  - Initialisation du projet Astro.
  - Ajout du Layout global prenant en charge l'injection dynamique des variables CSS (`theme.css`) et le chargement de polices Google Fonts.
  - Création des composants de blocs réutilisables : `Hero.astro`, `Features.astro`, `ProductGrid.astro` et `Gallery.astro`.
  - Mise en place du routeur de blocs dynamique via la route catch-all `[...slug].astro` interrogeant l'API du CMS.
