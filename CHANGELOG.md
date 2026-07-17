# Changelog

Toutes les modifications notables apportées à ce projet sont documentées dans ce fichier.

## [2.1.0] - 2026-07-17

### Ajouts

- **Persistance unifiée** : Payload CMS devient la source de vérité de tous les sites via la couche `server/sites-store.js`. La collection `payload_sites` est enrichie (`status`, `sslStatus`, `createdWithTool`) et `sites.json` n'est plus qu'un fallback en mode sans base de données, importé automatiquement au boot (migration idempotente).
- **File d'attente de builds** : un déploiement demandé pendant un build en cours est mis en file (au lieu d'un rejet 429) et lancé automatiquement à la fin, avec position visible dans l'interface. Verrou `build.lock` orphelin nettoyé au démarrage.
- **Quotas IA par compte** : limite journalière de générations IA (`AI_DAILY_QUOTA`, défaut 10, surchargeable par compte via `users.aiDailyQuota` dans le panel Payload) ; admins illimités. Solde restant affiché à l'onboarding, 429 explicite quand épuisé.
- **Réinitialisation de mot de passe par email** : pages `/forgot-password` et `/reset-password`, adaptateur nodemailer conditionnel (`SMTP_*`) ; sans SMTP, le lien est écrit dans la console (mode dev). Réponses anti-énumération.

### Vérification

- Suite `server/tests/security-check.mjs` étendue (~12 contrôles) : preuve que Payload porte le statut des sites, exposition de la file de build (admin vs client), quota IA (429 client / illimité admin / anti-escalade `aiDailyQuota`), réinitialisation (anti-énumération, token invalide en 4xx). Le job CI `security` exporte `AI_DAILY_QUOTA=0`.

## [2.0.0] - 2026-07-17

### Sécurité par compte (breaking)

- **Authentification obligatoire sur toute l'API et l'interface** : login via l'auth Payload (cookie httpOnly `payload-token`), nouveau middleware `server/auth.js` (`authenticate`, `requireAuth`, `requireAdmin`, `requireSiteAccess`).
- **Rôles** : `admin` = accès total (panel d'administration, panel Payload `/admin`, gestion des comptes) ; `client` = uniquement ses sites (design/contenu/déploiement) + onboarding. Le site créé à l'onboarding est automatiquement rattaché au compte (`users.sites`).
- **Matrice de protection Express** : CRUD sites, scan, import et gestionnaire de fichiers réservés aux admins ; `site-pages`/`theme`/`rebuild` scopés par ownership (`?site=` obligatoire) ; `/api/sites` filtré par compte ; logs de build masqués pour les builds d'autres clients ; CORS restreint à `FRONTEND_ORIGIN`.
- **Verrouillage Payload** : panel `/admin` réservé aux admins, collection `users` en lecture/écriture admin-ou-soi-même, hook anti-escalade (un client ne peut pas modifier `roles`/`sites`).
- **Canal de build interne** : le build Astro consomme `/internal/site-pages` authentifié par un jeton `BUILD_TOKEN` régénéré à chaque boot (transmis via l'environnement du webhook).
- **Secrets** : suppression des fallbacks en dur (`PAYLOAD_SECRET`, credentials DB) avec fail-fast, `.env.example` en placeholders, mots de passe seed non réécrits à chaque boot et personnalisables (`SEED_*_PASSWORD`). Mode explicite `DEV_NO_AUTH=true` (dev local uniquement, bannière d'avertissement dans l'UI).

### Refonte UX de l'orchestrateur

- **Routing par URL** (`react-router` v7) : `/login`, `/sites` (dashboard), `/onboarding`, `/sites/:slug/design|cms|deploy`, `/admin-panel` (admins) — deep-links partageables, gardes par rôle, redirection automatique d'un client sans site vers l'onboarding.
- **Découpage d'`App.tsx` (2740 lignes)** en modules : `api/` (client HTTP avec gestion 401/erreurs), `auth/` (contexte + gardes), `components/` (layouts, Modal, ConfirmDialog, Toasts, EmptyState), `features/` (pages par domaine), `hooks/`, `state/`.
- **Fin des `alert()`/`confirm()`/`prompt()`** : système de toasts, dialogues de confirmation (suppression de site), modal d'import de site avec formulaire.
- **Parcours guidé** : stepper Design → Contenu → Déploiement par site, en-tête de site avec statut de publication, lien de prévisualisation affiché uniquement après un premier déploiement (badge « Jamais déployé » sinon), empty states explicites (aucun site, aucun provider IA configuré).
- **Prévisualisation** : les sites déployés sont servis sous `/preview/<slug>/` (le préfixe `/sites` est désormais réservé au dashboard) ; proxy Vite same-origin pour `/api`, `/webhook`, `/preview`, `/admin`, `/_next`.

### Corrections

- **Routes REST Payload réparées** : le catch-all `app/api/[...payload]` est renommé `[...slug]` (Payload lit `params.slug`) — l'ancien nom cassait toutes les routes REST (login inclus) en erreur 500.
- Le parsing JSON d'Express ne s'applique plus aux requêtes déléguées à Next/Payload (le corps de la requête de login restait consommé → 500).
- `graphql` épinglé en `^16` et `next` en `~15.4` (plages compatibles Payload 3.86) — l'installation échouait.
- Modèle Gemini corrigé : `gemini-3.5-flash` (inexistant) → `gemini-2.5-flash` ; libellé UI aligné.
- Schéma Drizzle poussé automatiquement en dev (`push: false` sans migrations laissait la base vide).
- Chemins relatifs du scan résolus depuis la racine du projet (et non `server/`).
- Limite `express.json` portée à 10 Mo (upload d'image d'onboarding).
- Seed cohérent : site de démonstration en statut `draft` tant qu'il n'a jamais été déployé, fichiers de pages/thème réécrits s'ils sont vides ou corrompus, rattachement du client seedé par slug (plus d'ID en dur).
- Nettoyage : `App.css` orphelin, endpoint mort `/api/extract-design`, fichiers data legacy, assets Vite inutilisés, `server/.next/` retiré du versionnement, `lang="fr"`.

## [1.3.0] - 2026-06-30

### Ajouts

- **Migration vers Payload CMS v3 & Next.js 15** :
  - Mise à niveau des dépendances vers `payload^3.2.0`, `next^15.1.0` et `react^19.0.0` dans [package.json](file:///e:/Program%20Files/git/Le-Site-Builderr/server/package.json).
  - Refondation de la configuration vers TypeScript dans [payload.config.ts](file:///e:/Program%20Files/git/Le-Site-Builderr/server/payload.config.ts) en utilisant le Lexical Editor (`@payloadcms/richtext-lexical`) et l'adaptateur Postgres (`@payloadcms/db-postgres`).
  - Configuration de l'App Router Next.js sous `server/app/(payload)` avec [layout.tsx](file:///e:/Program%20Files/git/Le-Site-Builderr/server/app/\(payload\)/layout.tsx) (intégrant `RootLayout` et un handler de `serverFunction`), [page.tsx](file:///e:/Program%20Files/git/Le-Site-Builderr/server/app/\(payload\)/admin/%5B%5B...segments%5D%5D/page.tsx) et l'API catch-all [route.ts](file:///e:/Program%20Files/git/Le-Site-Builderr/server/app/api/%5B...payload%5D/route.ts).
  - Intégration de Next.js dans le serveur Express personnalisé ([server/index.js](file:///e:/Program%20Files/git/Le-Site-Builderr/server/index.js)) avec initialisation `nextApp.prepare()` et redirection catch-all.
  - Ajout d'un monkeypatch au boot pour corriger les conflits CJS/ESM liés à l'import de `@next/env` sous Node.js 22.

- **Système de restriction d'accès client (Multi-tenant)** :
  - Ajout de champs de contrôle (`roles` et `sites`) à la collection `users`.
  - Implémentation de fonctions de filtrage d'accès (`isAdminOrSiteClient`, `isAdminOrOwnSite`, `canCreatePage`, `canCreateTheme`) pour restreindre les opérations de lecture, modification et suppression des pages/thèmes aux seuls sites associés au client.
  - Seeding automatique au démarrage du serveur : création de `admin@admin.com` (Super Admin) et de `client@client.com` (Client restreint au site ID `1` `boulangerie-artisanale`).

### Modifié

- **Résolution du conflit d'API `/api/pages`** :
  - Renommage des routes d'API personnalisées de l'orchestrateur vers `/api/site-pages` pour éviter d'écraser les endpoints natifs de Payload CMS.

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
