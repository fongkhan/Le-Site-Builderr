# Changelog

Toutes les modifications notables apportées à ce projet sont documentées dans ce fichier.

## [1.2.0] - 2026-06-23

### Ajouts

- **Intégration de Payload CMS réel (avec fallback)** :
  - Ajout d'une configuration Payload CMS complète [payload.config.js](file:///e:/Program%20Files/git/Le-Site-Builderr/server/payload.config.js) avec collections `sites`, `pages` (champs Blocks flexibles), `themes` et `users`.
  - Lancement conditionnel de Payload au boot du serveur Express ([server/index.js](file:///e:/Program%20Files/git/Le-Site-Builderr/server/index.js)) : si aucune base de données n'est configurée dans le fichier `.env` via `DATABASE_URI`, le serveur affiche un avertissement et bascule de manière transparente sur le mode simulation JSON.
  - Lecture et écriture dynamiques des pages et du thème sur la base de données locale (PostgreSQL ou MongoDB) si connectée.
  
- **Provisioning de code sans Git (Copie locale)** :
  - Remplacement de la stratégie Git par de la copie locale (`fs.cpSync`) via la fonction `provisionRepository`.
  - Duplication propre du template Astro client vers le dossier source configuré sans le dossier `.git`, `node_modules`, `.astro` ou `dist`.
  - Gain drastique en rapidité, bande passante et sobriété énergétique, idéal pour l'hébergement mutualisé.

## [1.1.0] - 2026-06-20

### Modifié

- **Relocalisation de l'Inspiration Visuelle (Images & URLs) :**
  - Déplacement du téléversement d'image/logo (Vision) et du champ URL d'inspiration de l'onglet **Design** vers l'onglet **Onboarding**.
  - Simplification de l'onglet **Design** (rebaptisé "Personnalisation du Design & Thème") qui sert exclusivement au peaufinage manuel de la charte graphique en WYSIWYG, sans distraction ou redondance.

- **Intégration d'un Appel IA Unifié :**
  - Refonte du service `/api/onboard` et de `runOnboard` (`server/ai.js`) pour traiter de concert l'activité, l'ambiance choisie, l'image/logo importé (Vision) et l'URL d'inspiration.
  - L'IA génère en une seule requête l'architecture de la stack, l'ébauche des blocs de la page d'accueil et la charte de couleurs/typos initiale correspondante.

- **Mise à jour du Modèle et Résolution de Quotas :**
  - Migration de `gemini-2.5-flash` vers `gemini-3.5-flash` dans le backend et le frontend pour éliminer les erreurs HTTP 429 et stabiliser le service.
  - Sélection dynamique du modèle d'IA dans l'interface en fonction des clés configurées dans le `.env`.

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
