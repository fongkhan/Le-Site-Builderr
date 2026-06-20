# Meta-Builder de Sites Web Composables Intelligents (AI-Driven)

Ce projet est un prototype fonctionnel d'une plateforme SaaS d'industrialisation et de génération automatique de sites web composables. L'intégralité du tunnel d'onboarding, de la génération de design prédictif, de l'édition par blocs (CMS Payload-like) et du pipeline de build sécurisé avec verrouillage physique (pour o2switch) a été implémentée.

---

## 🏗️ Architecture Technique de la Stack

Le projet est conçu en trois couches principales :
1. **L'Orchestrateur (SaaS UI) :** Application React / Vite avec une esthétique sombre premium. Elle sert de tableau de bord pour l'onboarding IA, l'édition de design et le CMS par blocs.
2. **Le Serveur de Provisioning (Backend) :** Serveur Node.js / Express assurant la gestion des données, l'API d'extraction d'ambiances et la gestion du webhook de build avec verrou.
3. **Le Template Client (Astro) :** Projet Astro (SSG/Hybride) configuré pour injecter dynamiquement les tokens de design et charger les pages générées à partir des blocs de contenu.

---

## 🚀 Démarrage Rapide

### Prérequis
* [Node.js](https://nodejs.org/) (v22 ou supérieur recommandé)
* npm (v10 ou supérieur)

### Lancement du projet
Pour installer l'ensemble des dépendances et démarrer les serveurs simultanément :

1. Installez les dépendances à la racine et dans chaque sous-projet :
   ```bash
   # Racine
   npm install
   # Serveur API
   cd server && npm install
   # Client Orchestrateur React
   cd ../orchestrator && npm install
   # Template Astro Client
   cd ../client-template && npm install
   ```

2. Démarrez l'application depuis la racine :
   ```bash
   cd ..
   npm start
   ```

* **Orchestrateur (SaaS UI) :** `http://localhost:5173`
* **Serveur API & Webhook :** `http://localhost:4000`

---

## ⚡ Fonctionnalités Implémentées

### 1. Tunnel d'Onboarding IA & Inspiration Graphique Unifiée
* Saisie de besoin métier en langage naturel.
* Choix de l'inspiration visuelle directement à l'onboarding : sélection d'une ambiance prédéfinie (Chaleureux, Nature, Techno, Minimaliste), téléversement d'une image/logo (Vision IA) et spécification optionnelle d'un site web d'inspiration (ex: `apple.com`).
* Appel IA unifié (utilisant `gemini-3.5-flash` par défaut pour contourner les quotas de requêtes) générant conjointement la stack technique qualifiée, l'ébauche de blocs, et la charte graphique initiale (couleurs, polices, arrondi) en une seule étape.

### 2. Personnalisation du Design & Peaufinage Manuel
* Onglet Design 100% manuel dédié aux ajustements fins des tokens CSS (couleur primaire/secondaire, fond, texte, polices de titres/corps de texte, arrondis).
* Rendu en direct des tokens CSS sur un aperçu interactif.
* Enregistrement et application automatique dans le fichier de style client `theme.css`.

### 3. CMS flexible par Blocs (Payload Blocks ↔ Astro Router)
* Éditeur de blocs de page (Hero, Features, ProductGrid, Gallery).
* Rendu en temps réel appliquant les variables CSS.

### 4. Pipeline de Déploiement avec Verrou (Lockfile)
* Déclenchement de la compilation statique d'Astro par webhook local.
* Verrouillage physique via un fichier `build.lock` empêchant toute compilation simultanée (concurrence).
* Retour HTTP 429 lors de tentatives de build concurrentes pour protéger les quotas de ressources o2switch.
* Déploiement automatisé du bundle statique vers un dossier cible de production.

---

## 📄 Licence
Ce projet est développé à des fins de démonstration d'architecture technique (DAT).
