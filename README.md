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

### Prérequis
* [Node.js](https://nodejs.org/) v22+
* npm v10+
* **PostgreSQL** (requis pour l'authentification et Payload CMS)

### Configuration
Copiez `server/.env.example` vers `server/.env` et renseignez au minimum :

```bash
DATABASE_URI=postgres://user:password@127.0.0.1:5432/metabuilder_db
PAYLOAD_SECRET=<valeur aléatoire de 32+ caractères, ex: openssl rand -hex 32>
# Au moins une clé IA pour l'onboarding :
OPENAI_API_KEY=...       # ou ANTHROPIC_API_KEY / GEMINI_API_KEY
```

Options facultatives dans `server/.env` :

```bash
AI_DAILY_QUOTA=10          # générations IA/jour par client (admins illimités ; 0 = bloqué)
SMTP_HOST=                 # envoi des emails de réinitialisation ; vide = email loggé en console (dev)
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=noreply@localhost
```

> **Mode sans base de données** : sans `DATABASE_URI`, le serveur démarre en mode simulation JSON mais **toutes les routes protégées répondent 503** (pas d'authentification possible). Pour du développement local uniquement, `DEV_NO_AUTH=true` désactive l'authentification (toutes les requêtes sont admin) — une bannière d'avertissement s'affiche alors dans l'interface. **À ne jamais utiliser en production.**
>
> **Source de vérité** : quand la base est disponible, **Payload CMS est la source de vérité** de tous les sites (le fichier `sites.json` ne sert plus que de fallback en mode sans DB, et est importé automatiquement au premier démarrage).

### Lancement

```bash
# Installer les dépendances
npm install
cd server && npm install
cd ../orchestrator && npm install
cd ../client-template && npm install

# Démarrer la stack (serveur + orchestrateur) depuis la racine
cd .. && npm start
```

* **Orchestrateur (SaaS UI)** : `http://localhost:5173` → page de connexion
* **Serveur API & Webhook** : `http://localhost:4000`
* **Panel Payload (admins)** : `http://localhost:5173/admin` (proxifié) ou `http://localhost:4000/admin`
* **Prévisualisation des sites déployés** : `http://localhost:5173/preview/<slug>/index.html`

En dev, le front proxifie `/api`, `/webhook`, `/preview`, `/admin` et `/_next` vers le port 4000 (cookies same-origin, aucun réglage CORS côté navigateur).

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
* **Quota IA journalier** par compte client (`AI_DAILY_QUOTA`, surchargeable par compte dans le panel Payload) ; les admins sont illimités. Le solde restant est affiché à l'onboarding.
* **Mot de passe oublié** : lien « Mot de passe oublié ? » → email de réinitialisation (SMTP ou, sans SMTP, lien loggé en console en mode dev) → page de nouveau mot de passe.

---

## 📄 Licence
Ce projet est développé à des fins de démonstration d'architecture technique (DAT).
