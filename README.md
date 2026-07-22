# Meta-Builder de Sites Web Composables Intelligents (AI-Driven)

Plateforme d'industrialisation et de génération automatique de sites web composables : onboarding IA, design prédictif, CMS par blocs (Payload), pipeline de build avec verrou, et **sécurité par compte** (admin / client).

---

## 🏗️ Architecture Technique

Le projet est conçu en trois couches :

1. **L'Orchestrateur (SaaS UI)** — Application React 19 / Vite (port 5173), routée par URL (`react-router`), **protégée par login**. C'est le tableau de bord : liste de sites, onboarding IA, design, contenu, déploiement, et panel d'administration (admins uniquement).
2. **Le Serveur (Backend)** — Node.js / Express + Next.js 15 + Payload CMS v3 (port 4000). Gère les données (PostgreSQL via Drizzle), l'**authentification et les rôles**, l'API sites/pages/thèmes, les appels IA et le webhook de build avec verrou.
3. **Le Template Client (Astro)** — Projet Astro (SSG) injectant les tokens de design et les blocs de contenu au moment du build.

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

**Comptes de démonstration** (seedés au premier boot, mots de passe personnalisables via `SEED_ADMIN_PASSWORD` / `SEED_CLIENT_PASSWORD`) :
- `admin@admin.com` / `password123` — Super Admin
- `client@client.com` / `password123` — Client (rattaché au site « boulangerie-artisanale »)

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
   ```
3. **Redémarrez, puis testez** : Panel Admin ▸ encart **« Hébergement »** ▸ *Tester la connexion*.

Ce que fait le mode cPanel :
* à la **création d'un site** : le sous-domaine `<slug>.mondomaine.fr` est créé automatiquement (document root `public_html/<slug>`), et AutoSSL prend le relais pour le certificat (`sslStatus` passe de « pending » à « actif » après le premier déploiement couvert) ;
* au **déploiement** : le build Astro est publié sur l'hébergement (archive → upload → extraction) *en plus* de l'aperçu local `/preview` qui continue de fonctionner ;
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
* Éditeur de sections (Hero, Features, ProductGrid, Gallery, Témoignages, FAQ, Tarifs) : ajout, réordonnancement, édition, suppression.
* Aperçu WYSIWYG en temps réel avec les tokens du thème.
* Persistance dans Payload CMS (PostgreSQL) + fichiers JSON de fallback.

### 4. Pipeline de déploiement avec file d'attente
* Webhook de build authentifié, verrou physique `build.lock` (nettoyé au boot si orphelin).
* **File d'attente** : un déploiement demandé pendant un build en cours est mis en file et lancé automatiquement à la fin du build courant (plus de rejet). Position visible dans l'interface.
* Logs de build en direct dans l'interface (filtrés : un client ne voit pas les logs des builds d'autres sites).
* Copie du bundle statique vers le `documentRoot` du site (simulation o2switch).

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
* Les réponses `500` ne divulguent pas les détails internes ; une exception non-capturée arrête le process en production (relance par le superviseur).

### Note dépendances — version de Next.js
`@payloadcms/next@3.86` contraint Next à `>=15.4.11 <15.5.0` (puis `>=16.2.6`). Le projet est donc **épinglé à la dernière 15.4 disponible (`~15.4.11`)**, qui inclut déjà les correctifs de sécurité de la branche 15.4 (bien au-delà de CVE-2025-29927). Passer à Next 15.5/16 nécessiterait une montée coordonnée de Payload et de `@payloadcms/next` : migration majeure, hors périmètre de ce durcissement.

---

## 📄 Licence
Distribué sous licence [Apache License 2.0](./LICENSE). Voir le fichier [NOTICE](./NOTICE) pour les mentions d'attribution.
