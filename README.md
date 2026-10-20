# Meta-Builder de Sites Web Composables Intelligents (AI-Driven)

Plateforme d'industrialisation et de génération automatique de sites web composables : onboarding IA, design prédictif, CMS par blocs (Payload), pipeline de build avec verrou, et **sécurité par compte** (admin / client).

---

## 🏗️ Architecture Technique

Le projet est conçu en trois couches :

1. **L'Orchestrateur (SaaS UI)** — Application React 19 / Vite (port 5173), routée par URL (`react-router`), **protégée par login**. C'est le tableau de bord : liste de sites, onboarding IA, design, contenu, déploiement, et panel d'administration (admins uniquement).
2. **Le Serveur (Backend)** — Node.js / Express + Next.js 15 + Payload CMS v3 (port 4000). Gère les données (PostgreSQL via Drizzle), l'**authentification et les rôles**, l'API sites/pages/thèmes, les appels IA et le webhook de build avec verrou.
3. **Le Template Client (Astro)** — Projet Astro (SSG) injectant les tokens de design et les blocs de contenu au moment du build.

Organisation du serveur (`server/`) :

| Dossier / fichier | Rôle |
| --- | --- |
| `index.js` | Point d'entrée : chargement de l'environnement, garde-fous de démarrage, Next + Payload, écoute du port |
| `express-app.js` | Assemblage d'Express dans l'ordre de montage (CORS, en-têtes, limiteurs, JSON, statiques, routes, Next, erreurs) |
| `core/` | Socle transverse : configuration et chemins, instance Payload et comptes initiaux, driver d'hébergement, HTTP (erreurs, limiteurs, routeurs protégés), audit, email, journal de build |
| `services/` | Règles métier sans Express : contenu (pages, articles, thème), sites (domaine, confinement, propriétaires), pipeline de build (verrou, file, déploiement atomique), sauvegardes |
| `routes/` | Endpoints HTTP par domaine : `sites`, `admin`, `content`, `domains`, `public` (contact, statistiques), `ai`, `build` |
| `lib/` | Fonctions pures testées unitairement (slugs, chemins, thème, SEO, i18n, médias, domaines, offres…) |

---

## 🔐 Sécurité par compte

Toute l'API et l'interface sont authentifiées via **Payload CMS** (cookie httpOnly `payload-token`).

| Rôle | Accès |
|---|---|
| **admin** | Tout : panel d'administration (création/import/scan/suppression de sites, gestionnaire de fichiers), panel Payload `/admin`, gestion des comptes utilisateurs, tous les sites. |
| **client** | Uniquement **ses** sites (design, contenu, déploiement) et l'**onboarding** (chaque site créé est automatiquement rattaché à son compte). |

Règles clés :
- Les comptes clients sont **créés par un admin** (panel Payload → collection Users, champ `sites` pour rattacher les sites). Pas d'auto-inscription.
- Un client ne peut ni lister les autres comptes, ni modifier ses propres `roles`/`sites` (hook anti-escalade).
- Le panel Payload `/admin` est réservé aux admins.
- Tous les endpoints Express vérifient le rôle et l'ownership du site (`?site=<slug>` obligatoire sur les routes scopées).
- Le build Astro accède aux données via un canal interne authentifié par jeton (`BUILD_TOKEN`, régénéré à chaque boot).

**Comptes de démonstration** (seedés au premier boot hors production, mots de passe personnalisables via `SEED_ADMIN_PASSWORD` / `SEED_CLIENT_PASSWORD`) :
- `admin@admin.com` / `password123` — Super Admin
- `client@client.com` / `password123` — Client (rattaché au site « boulangerie-artisanale »)

En production, l'email de l'admin initial est **obligatoire** (`SEED_ADMIN_EMAIL`) : sans lui, aucun admin n'est créé et le serveur le signale au démarrage. Un email non devinable limite le verrouillage volontaire du compte admin par des échecs de connexion répétés ; ce risque est seulement **atténué** (verrouillage temporaire de Payload après 5 échecs, limiteur par IP), pas supprimé. Le déverrouillage d'un compte (`POST /api/users/unlock`) est réservé aux admins.

**Comptes et sessions** :
- Mots de passe de 12 à 256 caractères, différents de l'email et absents d'une liste de mots de passe courants (création, modification, réinitialisation via l'API ; le seed de développement en est exempté).
- Un échec de connexion renvoie toujours le même message, que le compte existe, que le mot de passe soit faux ou que le compte soit verrouillé.
- Changer de mot de passe révoque les autres sessions ouvertes (la session courante est conservée si l'utilisateur modifie son propre compte) ; une réinitialisation les révoque toutes.
- Cookie de session `Secure` en production (`COOKIE_SECURE=true|false` pour forcer).
- Les chemins serveur d'un site (`documentRoot`, `repositoryPath`) et le jeton de vérification de domaine ne sont lisibles que par un admin.

### Journal d'audit

Le panneau d'administration (« 🧾 Journal d'audit ») liste les actions sensibles, des plus récentes aux plus anciennes :
- **Comptes** : création, modification (email, rôles, offre, quota IA, sites rattachés, mot de passe — mention « modifié », jamais la valeur), suppression, déverrouillage ; demande et réalisation d'une réinitialisation de mot de passe.
- **Connexions** : chaque échec (email **masqué**, ex. `je***@exemple.fr`, et motif : identifiants refusés ou compte verrouillé) ; les connexions réussies des admins (de tous les comptes avec `AUDIT_LOGINS=true`).
- **Sites et contenus** : sites (création, suppression, duplication, domaine…), pages créées ou supprimées, modifications du thème, articles, médias téléversés ou supprimés, publications, sauvegardes.

Aucun secret, jeton, mot de passe ni adresse IP n'y est écrit. Le panneau filtre par catégorie et par cible exacte (slug d'un site ou email) et charge les entrées par pages (« Charger plus »). Les entrées ne sont ni modifiables ni supprimables, ni par l'API ni par le panel Payload : seule la purge de rétention du serveur les retire, une fois par jour, au-delà de `AUDIT_RETENTION_DAYS` jours (365 par défaut, `0` = jamais) ; chaque purge est elle-même tracée (`journal.purge`). L'historique des builds suit la même règle avec `BUILDS_RETENTION_DAYS`.

Les limiteurs de connexion et de réinitialisation de mot de passe s'appliquent quelle que soit la forme du chemin (casse, caractères encodés, `/` final), comme le message d'échec unifié. L'API GraphQL de Payload est désactivée (l'orchestrateur et le panel n'utilisent que l'API REST). En CI, `npx tsx tests/auth-empty-db-check.mjs` vérifie sur une base vide temporaire qu'aucun premier compte ne peut être créé anonymement.

---

## 🚀 Démarrage Rapide

### Étape 1 — Prérequis

* [Node.js](https://nodejs.org/) **v22.12 ou plus** — vérifiez avec `node -v`. Une version plus ancienne (18/20) fera échouer Vite et Astro avec des erreurs cryptiques (voir Dépannage).
* npm v10+ (fourni avec Node 22).
* Une base **PostgreSQL** (étape 2 — Docker recommandé, aucune installation manuelle).

### Étape 2 — Base de données PostgreSQL

**Option A (recommandée) — Docker :**

```bash
docker compose up -d
```

C'est tout : la base `metabuilder_db` est créée automatiquement avec les identifiants attendus par `server/.env.example` (`postgres` / `postgrespassword`, port 5432).

**Option B — PostgreSQL installé nativement :** créez la base vous-même (elle n'est **pas** créée automatiquement) :

```bash
# macOS / Linux
createdb -U postgres metabuilder_db
# ou depuis psql (toutes plateformes, y compris Windows via pgAdmin ou psql) :
psql -U postgres -c "CREATE DATABASE metabuilder_db;"
```

Puis adaptez `DATABASE_URI` dans `server/.env` à vos identifiants.

### Étape 3 — Configuration

```bash
cp server/.env.example server/.env        # Windows : copy server\.env.example server\.env
```

Puis éditez `server/.env` :
* `DATABASE_URI` — déjà correct si vous utilisez Docker (option A).
* `PAYLOAD_SECRET` — remplacez par une valeur aléatoire de 32+ caractères (ex. `openssl rand -hex 32`).
* Au moins une clé IA pour l'onboarding : `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ou `GEMINI_API_KEY` (facultatif pour explorer l'interface — sans clé, seul l'assistant IA est indisponible).

Options facultatives : `AI_DAILY_QUOTA` (générations IA/jour par client, 0 = bloqué), `SMTP_*` (emails de réinitialisation ; vide = lien loggé en console en dev).

### Étape 4 — Installation des dépendances

```bash
npm install
cd server && npm install
cd ../orchestrator && npm install
cd ../client-template && npm install
cd ..
```

### Étape 5 — Lancement

```bash
npm start
```

Le lanceur vérifie d'abord les prérequis (version de Node, `.env`, dépendances, PostgreSQL joignable) et affiche la commande corrective si quelque chose manque. **Le premier démarrage prend environ une minute** (Payload pousse son schéma en base et crée les comptes de démonstration).

* **Orchestrateur (SaaS UI)** : `http://localhost:5173` → page de connexion
* **Serveur API & Webhook** : `http://localhost:4000`
* **Panel Payload (admins)** : `http://localhost:5173/admin` (proxifié) ou `http://localhost:4000/admin`
* **Prévisualisation des sites déployés** : `http://localhost:5173/preview/<slug>/index.html`

Connectez-vous avec les comptes de démonstration (section « Sécurité par compte » ci-dessus) : `admin@admin.com` / `password123`.

En dev, le front proxifie `/api`, `/webhook`, `/preview`, `/admin` et `/_next` vers le port 4000 (cookies same-origin, aucun réglage CORS côté navigateur).

> **Mode sans base de données** : sans `DATABASE_URI`, le serveur démarre en mode simulation JSON mais **toutes les routes protégées répondent 503** (pas d'authentification possible). Pour du développement local uniquement, `DEV_NO_AUTH=true` désactive l'authentification (toutes les requêtes sont admin) — une bannière d'avertissement s'affiche alors dans l'interface. **À ne jamais utiliser en production.**
>
> **Source de vérité** : quand la base est disponible, **Payload CMS est la source de vérité** de tous les sites (le fichier `sites.json` ne sert plus que de fallback en mode sans DB, et est importé automatiquement au premier démarrage).

### 🛟 Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Le login échoue avec une erreur **503** | PostgreSQL injoignable ou `server/.env` absent/incomplet | `docker compose up -d`, puis vérifiez `DATABASE_URI` dans `server/.env` et relancez |
| `crypto.hash is not a function` ou Vite/Astro refuse de démarrer | Node trop ancien (< 22.12) | Installez Node 22 LTS (`node -v` pour vérifier) |
| `Cannot find module './vendor-chunks/...'` ou erreurs `MODULE_NOT_FOUND` dans `.next` | Cache Next.js corrompu (kill brutal, double serveur) | Arrêtez tout, `rm -rf server/.next`, relancez `npm start` |
| `EADDRINUSE` port 4000 ou 5173 | Un ancien process tourne encore | Tuez-le (`npx kill-port 4000 5173` ou via le gestionnaire de tâches) |
| Premier démarrage très long (~1 min) sans erreur | Normal : push du schéma Payload + seed des comptes | Patientez jusqu'à « Serveur Meta-Builder démarré » |
| `role "postgres" does not exist` / `database "metabuilder_db" does not exist` (option B) | Base ou utilisateur jamais créés | Créez la base (étape 2, option B) ou passez à Docker (option A) |

---

## 🌍 Passer en production sur o2switch (API cPanel)

Par défaut, tout est **simulé localement** (`HOSTING_DRIVER=simulation`) : domaine fictif, SSL fictif, publication dans `simulated_public_html/`. Pour publier **réellement** sur votre hébergement o2switch :

1. **Créez un jeton API** dans votre cPanel : ▸ *Sécurité* ▸ **« Gérer les jetons d'API »** ▸ Créer. Copiez le jeton (affiché une seule fois). ⚠️ Ce jeton donne accès à votre hébergement : ne le committez jamais.
2. **Configurez `server/.env`** :
   ```bash
   HOSTING_DRIVER=cpanel
   CPANEL_HOST=votre-serveur.o2switch.net   # l'hôte de votre cPanel
   CPANEL_USER=votre-identifiant
   CPANEL_API_TOKEN=le-jeton-créé-en-1
   CPANEL_ROOT_DOMAIN=mondomaine.fr         # parent des sous-domaines créés
   PUBLIC_API_URL=https://api.mondomaine.fr # adresse publique de CE serveur
   ```
   `PUBLIC_API_URL` est indispensable : les sites publiés l'utilisent pour le formulaire de contact, la prise de rendez-vous et les statistiques de visites.
3. **Redémarrez, puis testez** : Panel Admin ▸ encart **« Hébergement »** ▸ *Tester la connexion*.

Ce que fait le mode cPanel :
* à la **création d'un site** : le sous-domaine `<slug>.mondomaine.fr` est créé automatiquement (document root `public_html/<slug>`), et AutoSSL prend le relais pour le certificat (`sslStatus` passe de « pending » à « actif » après le premier déploiement couvert) ;
* au **déploiement** : le build Astro est publié sur l'hébergement (archive → upload → extraction), compilé pour la racine de son domaine ; les liens « Voir le site » de l'orchestrateur pointent alors vers le vrai domaine ;
* le jeton API n'apparaît **jamais** dans les logs, les erreurs ni les réponses HTTP.

---

## 🧭 Parcours utilisateur

**Client** : Connexion → « Mes sites » (ou onboarding direct s'il n'a aucun site) → Onboarding IA (description, fonctionnalités, inspiration) → le site est créé et rattaché à son compte → **Design** (tokens) → **Contenu** (blocs) → **Déploiement** (build + publication, logs en direct) → lien « Voir le site en ligne ».

**Admin** : Tout ce qui précède, plus le **Panel Admin** : statistiques, création manuelle / import / scan de sites, gestionnaire de fichiers, suppression, et liens vers le panel Payload (gestion des comptes utilisateurs).

---

## ⚡ Fonctionnalités

### 1. Tunnel d'Onboarding IA
* Besoin métier en langage naturel + choix des fonctionnalités (e-commerce, blog, multi-boutique).
* Inspiration graphique : ambiance prédéfinie, image/logo (vision IA) ou URL de référence.
* Fournisseurs : OpenAI (`gpt-4o-mini`), Anthropic (`claude-3-5-sonnet`), Google (`gemini-2.5-flash`) — défaut : `DEFAULT_PROVIDER` (openai).
* Génère la stack qualifiée, l'ébauche de page et la charte graphique, puis rattache le site au compte.

### 2. Design & thème
* Ajustement des tokens (couleurs, polices, arrondis) avec aperçu en direct et statut « brouillon non sauvegardé ».
* Application automatique dans `client-template/src/styles/theme.css` au build.

### 3. CMS par blocs
* Éditeur de sections (Hero, Features, ProductGrid, Gallery, Témoignages, FAQ, Tarifs) : ajout, réordonnancement, duplication, édition, suppression (avec « Annuler » dans la notification).
* **Annuler / rétablir** (boutons ou `Ctrl/Cmd+Z`, `Maj+Ctrl/Cmd+Z`) pendant la session d'édition.
* **Menu du site** : ordre des pages réglable (monter / descendre) et page masquable du menu (toujours publiée, par ex. mentions légales).
* Aperçu WYSIWYG en temps réel avec les tokens du thème ; sauvegarde automatique ciblée (seules les pages modifiées sont écrites).
* **Médiathèque** : images PNG, JPEG, WebP, GIF et AVIF (SVG refusé), `MEDIA_MAX_MB` (8 Mo par défaut), redimensionnées à 2400 px quand `sharp` est disponible.
* Persistance dans Payload CMS (PostgreSQL) + fichiers JSON de fallback.

### Médiathèque du site
* **Parcourir et réutiliser** : le bouton 🖼️ de chaque champ image ouvre la médiathèque du site (vignettes, dimensions, poids, recherche au-delà de 8 images) ; « Choisir » place l'image dans le champ, sans nouveau téléversement.
* **Texte alternatif** par image (200 caractères au plus), repris par le site publié pour chaque usage (galerie, produits, couvertures d'articles) ; vide, le bloc garde son texte de repli (nom du produit, « Photo N – titre »).
* **Suppression contrôlée** : refusée tant que l'image est citée par une page (toutes langues) ou un article, **brouillons compris** — la médiathèque nomme les contenus concernés. La suppression par l'API REST Payload (`DELETE /api/media/:id`) est réservée aux admins.
* Endpoints (admin ou propriétaire du site) : `GET /api/sites/:slug/media` (images et usages), `PATCH /api/sites/:slug/media/:id` (`{ alt }`), `DELETE /api/sites/:slug/media/:id` (409 si utilisée, journal d'audit `media.suppression`).
* **Sites publiés** : le build lit le canal interne `/internal/site-media` (texte alternatif, dimensions, variantes) : chaque `<img>` de la médiathèque reçoit `width`/`height` (aucun décalage de mise en page) et un `srcset` de variantes 480, 960 et 1600 px (celles nettement plus petites que l'original) écrites au déploiement sous `/media/w<largeur>/` — seulement si `sharp` est disponible, sinon l'image d'origine seule (jamais de lien cassé). Couverture d'article prioritaire, fond du Hero en tête de page préchargé. Les noms des médias ignorés ou introuvables figurent dans le journal de build.

### Messages reçus
* Chaque envoi du formulaire de contact ou de prise de rendez-vous d'un site publié est conservé (12 mois, 500 messages maximum par site) et consultable par son propriétaire dans l'onglet **Messages** : non lus, marquer comme lu, répondre par email, supprimer. Un email de notification en échec ne fait plus perdre le message.

### Mentions légales et confidentialité des sites publiés
* **Pages générées** pour chaque site : « Mentions légales » (`/mentions-legales/`) et « Politique de confidentialité » (`/confidentialite/`), plus `/en/legal-notice/` et `/en/privacy-policy/` quand le site a un accueil en anglais (une page d'une langue sans accueil renvoie aux pages françaises). Elles ne figurent ni dans le menu ni dans le sitemap ; des liens discrets en bas de chaque page (404 et blog compris) y mènent, avec « Gérer les cookies » quand une mesure d'audience est active (et un lien vers la politique dans la bannière de consentement).
* **Une page du CMS à la même adresse reste prioritaire** (ex. une page « mentions-legales » masquée du menu) : la page générée correspondante n'est pas construite, ce que le journal de build signale ; l'onglet « Infos légales » l'indique aussi.
* **Onglet « Infos légales »** (propriétaire du site ou admin) : éditeur (raison sociale, forme juridique et capital, adresse, immatriculation, TVA, téléphone, email), directeur ou directrice de la publication, hébergeur ; champs obligatoires signalés (badge « ! » sur l'onglet), reprise de l'adresse, du téléphone et de l'email du bloc « Infos pratiques ». API : `GET`/`PUT /api/sites/:slug/legal` (objet complet validé : champs connus, texte borné, email et téléphones plausibles ; journal d'audit `site.informations-legales` sans les valeurs). La fiche du site reste réservée aux admins dans l'API REST Payload.
* **Hébergeur par défaut** : `LEGAL_HOST_NAME`, `LEGAL_HOST_ADDRESS`, `LEGAL_HOST_PHONE` (serveur, voir `server/.env.example`), remplaçables champ par champ pour chaque site. Aucune adresse n'est écrite en dur.
* **Contenu adapté au site** : formulaires présents, statistiques anonymes, mesure d'audience (après consentement) ou aucun cookie, droits et lien vers la CNIL. La durée de conservation des messages est dérivée de la rétention de la boîte de réception (365 jours → 12 mois). Les textes sont un modèle neutre : à faire vérifier si l'activité a des obligations particulières.
* **Mention RGPD sous chaque formulaire** (finalité, durée de conservation, lien vers la politique de la langue de la page).
* **Brouillon** : un champ obligatoire vide s'affiche « À compléter : … » ; **site publié** : la ligne est omise (raison sociale vide : nom du site) et le build journalise les manques.
* **Erreurs du formulaire de contact traduites** : la réponse JSON porte un code stable (`unknown_site`, `invalid_fields` avec la liste `fields`, `invalid_body`, `too_large`, `rate_limited`, `send_failed`) que le script du site traduit, et les champs refusés sont signalés ; sans JavaScript, la page de réponse suit la langue du formulaire (`?lang=fr|en`), limiteur et corps trop volumineux compris.
* **Schéma** : group `legal` de la collection `payload_sites` (11 colonnes `legal_*`), créé automatiquement hors production (push) ; tant que le dépôt n'a pas de migrations, créez ces colonnes avant un déploiement en production.

### 4. Pipeline de déploiement avec file d'attente
* Webhook de build authentifié, verrou physique `build.lock` (nettoyé au boot si orphelin).
* **File d'attente** : un déploiement demandé pendant un build en cours est mis en file et lancé automatiquement à la fin du build courant (plus de rejet). Position visible dans l'interface.
* Logs de build en direct dans l'interface (filtrés : un client ne voit pas les logs des builds d'autres sites) : la sortie de `npm`/`astro` est recopiée au fil de l'eau (plafonnée à ~5 Mo par build) et l'interface n'en lit que les 200 derniers Ko.
* **Délai maximal** (`BUILD_TIMEOUT_MS`, 10 min par défaut) : au dépassement, tout l'arbre de processus du build est tué (groupe de processus POSIX, `taskkill /T` sous Windows) avant que le build suivant ne reprenne le dossier `dist`.
* **Reprise après crash** : au démarrage, un site écarté par une bascule interrompue (`<dossier>.old-…`) est restauré s'il manque, les copies partielles (`.tmp-…`) et les releases inachevées (`<id>.partial`) sont supprimées ; le scan d'import ignore ces dossiers.
* Copie du bundle statique vers le `documentRoot` du site (simulation o2switch).

### Exploitation : arrêt propre, reprise et panneau Système
* **Arrêt propre** (`SIGTERM`, `SIGINT`, Ctrl+C) : le serveur cesse d'accepter des connexions, termine les requêtes en cours et attend les tâches de fond (historique, emails), au plus `SHUTDOWN_GRACE_MS` (15 s en production, 3 s sinon). Pendant l'arrêt, `GET /api/health/ready` répond `503 { "status": "stopping" }` ; un second signal (plus d'une seconde après le premier) force l'arrêt.
* **Build interrompu repris au redémarrage** : un build en cours est arrêté et remis en tête de file, sans échec ni email ; un rollback ou une prévisualisation demandés pendant l'arrêt reçoivent un `503` explicite.
* **File de publications conservée** dans `server/data/build-queue.json` à chaque changement et relancée au démarrage (les sites supprimés entre-temps sont écartés) : seul un arrêt brutal pendant un build perd ce build.
* Régler le délai d'arrêt du superviseur **au-dessus** de `SHUTDOWN_GRACE_MS` (systemd `TimeoutStopSec`, `docker stop -t`, PM2 `kill_timeout`).
* Le lanceur (`npm start`, `start.js`) démarre le serveur et l'orchestrateur sans shell intermédiaire et attend leur arrêt : plus de processus orphelin ni d'`EADDRINUSE` au redémarrage.
* **Panneau Système** (administration) : version, Node, environnement, hébergement, durée de fonctionnement, espace disque, taille des dossiers (données, médiathèque, sites publiés, versions, brouillons, sauvegardes, dépôts), build et file d'attente, état des sauvegardes.
* **Données orphelines** (fichiers de données, versions, brouillons et copies du modèle de sites supprimés) : listées puis nettoyées après confirmation (journal d'audit `maintenance.purge`). L'inventaire est recalculé par le serveur ; les dossiers publiés sans site et les dépôts non créés par l'outil sont seulement signalés, jamais supprimés. Nettoyage indisponible sans base de données.
* La copie du modèle créée par l'outil pour un site (`repositories/<slug>`, marquée) est supprimée avec le site ; un dépôt importé ou préexistant est conservé. Un site créé sur les restes d'un ancien site (dossier publié, versions, données) reçoit un identifiant suffixé (`mon-site-2`).
* Une page absente sous `/preview` ou `/draft` renvoie la page 404 du site (celle de la langue si elle existe).
* Publication cPanel : délai d'envoi proportionnel à la taille de l'archive (`CPANEL_UPLOAD_TIMEOUT_MS` pour le fixer) et messages d'erreur explicites (étape, délai), sans hôte ni jeton.

### Supervision : endpoints de santé
Publics, sans authentification, sans secret, version ni chemin dans la réponse :
* `GET /api/health` — vivacité : `200 { "status": "ok", "uptimeS": 42 }` dès que le process répond.
* `GET /api/health/ready` — disponibilité : `200` (`ok` ou `degraded`) ou `503` (`down`) avec `{ "status", "checks": { "database", "storage", "build": { "inProgress", "queueLength" } } }`. `database` exécute un `select 1` borné à 2 s ; `storage` vérifie l'accès en écriture aux données, à la production et à la médiathèque ; `build` est informatif. Le résultat est mis en cache 2 s : une sonde fréquente ne sollicite jamais la base à chaque appel et ne reçoit jamais de 429. À utiliser pour une sonde de disponibilité, un `HEALTHCHECK` Docker ou l'attente de démarrage en CI (`curl -fsS http://localhost:4000/api/health/ready`).

### Sauvegardes et restauration
* **Contenu sauvegardé** : fiches, pages, thèmes, articles et images téléversées de tous les sites, dans `backups/backup-<date>.zip` (une archive par sauvegarde, jamais écrasée même si deux sauvegardes tombent dans la même seconde).
* **Réglages** : `BACKUP_ENABLED=true` active la planification (vérifiée au plus toutes les heures, quel que soit l'intervalle), `BACKUP_INTERVAL_HOURS` (24 par défaut), `BACKUP_KEEP` (14 archives conservées), `BACKUP_MEDIA=false` pour exclure les images (archives plus légères ; une restauration ne reprend alors que les images encore présentes). « Sauvegarder maintenant » reste disponible dans le panel d'administration.
* **Restaurer…** (panel d'administration, « Sauvegardes du contenu ») : choisir un site de la sauvegarde, puis
  * **copie** (recommandé) : nouveau site en brouillon « <nom> (restauration) » ; un site supprimé depuis est recréé sous son slug d'origine s'il est libre. Le site actuel n'est pas modifié ; la copie n'est rattachée à aucun compte client (ni domaine personnalisé ni mesure d'audience restaurés) ;
  * **remplacement** : pages, articles et thème du site existant remplacés, images manquantes restaurées, après une **sauvegarde de sécurité** de tous les sites et sous le créneau de build. Le site en ligne ne change qu'à la prochaine publication.
* **Suppression d'un site** : une sauvegarde préalable de tous les sites est proposée (cochée par défaut) ; le site supprimé reste ainsi restaurable en copie.
* Endpoints (admin) : `GET /api/admin/backups/sites?name=<archive>` (sites contenus, pages, articles, images) et `POST /api/admin/backups/restore` `{ name, slug, mode: "copy" | "replace" }`. Les archives de plus de 1 Go ne sont pas restaurables depuis l'interface.

### 5. Payload CMS v3 multi-tenant
* Collections `users` (auth + rôles + quota IA), `payload_sites` (source de vérité), `pages` (blocs), `themes`, avec access control par rôle et ownership.
* Panel d'administration Payload complet pour la gestion des comptes et des données.

### 6. Quotas IA & réinitialisation de mot de passe
* **Quota IA journalier** par compte client (`AI_DAILY_QUOTA`, surchargeable par compte dans le panel Payload) ; les admins sont illimités. Le solde restant est affiché à l'onboarding. Réservation atomique (sérialisée) : deux requêtes concurrentes ne peuvent pas dépasser la limite.
* **Mot de passe oublié** : lien « Mot de passe oublié ? » → email de réinitialisation (SMTP ou, sans SMTP, lien loggé en console en mode dev) → page de nouveau mot de passe.

### 7. Durcissement HTTP & robustesse
* **helmet** (en-têtes de sécurité ; CSP désactivée pour préserver l'admin Payload/Next) + **rate-limiting** : anti brute-force sur le login (seuls les échecs comptent), anti-abus sur l'onboarding IA et le webhook de build. `TRUST_PROXY` active la confiance au reverse-proxy pour l'IP client (off par défaut).
* **Confinement des chemins** : `documentRoot`/`repositoryPath` sont validés (jamais hors `public_html`/`repositories`) et les slugs vides sont rejetés — impossible de viser un dossier arbitraire au déploiement/suppression.
* **Déploiement atomique** (copie vers dossier temporaire puis `rename` + rollback) et **verrou anti-concurrence** en mémoire fermant la fenêtre TOCTOU entre deux builds.
* **Validation de thème** (couleurs hexadécimales, dimensions, polices en allowlist) avant écriture du CSS — anti-injection.
* Les réponses `500` ne divulguent pas les détails internes ; toute exception d'une route est rendue en JSON (jamais de requête pendante) ; une exception non-capturée arrête le process en production (relance par le superviseur).
* **API REST Payload verrouillée** : un client lit son site mais ne peut modifier ni ses paramètres de déploiement (chemins, domaine, statut) ni le site de rattachement d'une page, d'un article, d'un thème ou d'un média.
* **Endpoints publics** (formulaire de contact, beacon de statistiques) : CORS ouvert à toute origine sans cookie, corps limité à 32 Ko (ailleurs : 10 Mo pour l'onboarding, 2 Mo pour pages, articles et thème, 256 Ko pour le reste), limiteurs dédiés ; mot de passe oublié / réinitialisation également limités.
* **Garde-fous de production** (`NODE_ENV=production`) : refus de démarrer avec `DEV_NO_AUTH`, aucun compte « password123 » (admin créé seulement avec un `SEED_ADMIN_PASSWORD` d'au moins 12 caractères), refus de démarrer sans compte admin (`SEED_ADMIN_EMAIL` et `SEED_ADMIN_PASSWORD` requis au premier démarrage), création anonyme de compte refusée, arrêt si la base est injoignable, secrets du serveur jamais transmis au build.

### Note dépendances — version de Next.js
`@payloadcms/next@3.86` contraint Next à `>=15.4.11 <15.5.0` (puis `>=16.2.6`). Le projet est donc **épinglé à la dernière 15.4 disponible (`~15.4.11`)**, qui inclut déjà les correctifs de sécurité de la branche 15.4 (bien au-delà de CVE-2025-29927). Passer à Next 15.5/16 nécessiterait une montée coordonnée de Payload et de `@payloadcms/next` : migration majeure, hors périmètre de ce durcissement.

---

## 📄 Licence
Distribué sous licence [Apache License 2.0](./LICENSE). Voir le fichier [NOTICE](./NOTICE) pour les mentions d'attribution.
