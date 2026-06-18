# Document d'Architecture Technique (DAT)
## Projet : Meta-Builder de Sites Web Composables Intelligents (AI-Driven)
**Statut :** En cours de validation  
**Environnement cible :** Hébergement o2switch (cPanel) + Node.js + PostgreSQL  

---

## 1. Vision Générale & Objectifs Métier

L'objectif de ce projet est de concevoir un système d'industrialisation et de génération automatique de sites web (SaaS de type "Meta-Builder"). L'architecture repose sur l'approche du web composable (Jamstack/Hybride) pour garantir des performances optimales, une sécurité maximale et des coûts d'infrastructure maîtrisés.

L'expérience utilisateur est entièrement dictée par l'Intelligence Artificielle : le client fournit son besoin en langage naturel, ses inspirations graphiques (images, maquettes, documents, liens), et le système en déduit automatiquement la stack technique, le modèle de données, le design système et le contenu initial.

---

## 2. Architecture Globale & Choix de la Stack

L'architecture est scindée en deux univers distincts : l'**Orchestrateur** (l'application SaaS maîtresse) et les **Instances Clients** (les sites générés).

### 2.1 L'Orchestrateur (Le Cerveau)
* **Technologie :** Instance **Payload CMS Maîtresse** tournant sous Node.js.
* **Rôle :** Gestion des utilisateurs, des abonnements, de l'authentification et exécution des scripts d'automatisation via ses Hooks Node.js (provisioning, création de bases de données, appels LLM).

### 2.2 Les Instances Clients (La Stack Composable)
Chaque site client est généré à partir d'une combinaison sur-mesure de trois briques de pointe :
* **Front-end :** Astro (SSG / Hybride) : Choisi pour sa rapidité d'exécution, son architecture en îles (Islands Architecture) et son support natif de la génération statique.
* **CMS de Contenu :** Payload CMS (Node.js) : Choisi pour son approche orientée développeur, sa flexibilité dans la modélisation des données et ses hooks puissants.
* **E-commerce :** MedusaJS (Node.js) : Framework e-commerce headless modulaire, idéal pour la gestion multi-boutique, les stocks complexes et la gestion des flux d'achats.

---

## 3. Moteur de Décision IA & Qualification Dynamique

Plutôt que d'enfermer l'utilisateur dans des offres rigides, l'intégration des LLM permet une configuration d'infrastructure élastique et sur-mesure.

### 3.1 Flux d'Onboarding et Routage d'Infrastructure
1.  **Entrée Client :** L'utilisateur soumet son texte descriptif (*ex: "Je veux un site pour ma boulangerie à Clamart, j'ai deux boutiques et je veux vendre mes croissants en ligne"*).
2.  **Analyse LLM :** Le prompt est envoyé à l'API d'un LLM avec une contrainte de sortie au format JSON strict (*Structured Outputs*).
3.  **Contrat d'Interface JSON :** L'IA retourne un objet qualifiant les besoins fonctionnels et techniques :

```json
{
  "site_name": "Au Bon Pain de Clamart",
  "features": {
    "blog_or_news": true,
    "e_commerce": true,
    "multi_store": true
  },
  "stack_requirements": {
    "astro_mode": "hybrid",
    "need_payload": true,
    "need_medusajs": true,
    "need_stripe": true
  }
}
```

### 3.2 Logique de Détermination de la Stack

L'Orchestrateur applique les règles suivantes pour optimiser la consommation de ressources sur o2switch :

* **Landing Page Simple (Astro SSG Pur) :** Aucun processus Node.js actif en continu pour le client. Le site est 100% statique (Fichiers plats). Consommation serveur quasi nulle.
* **Portfolio / Site Vitrine Modifiable (Astro SSG + Payload CMS) :** Initialisation d'une instance Payload CMS (1 processus Node actif, 1 base PostgreSQL). Rebuild statique au webhook.
* **E-commerce Pièces Uniques (Astro SSG + Payload CMS + Stripe) :** Gestion du stock et intégration du plugin de paiement directement dans Payload (1 processus Node actif).
* **Commerce Complexe / Multi-boutique (Astro Hybride + Payload + MedusaJS) :** Déploiement de la stack complète. 2 processus Node.js actifs. Astro passe en mode Hybride : affichage ultra-rapide des pages en statique, mais requêtes dynamiques (Client-Side Fetch) vers MedusaJS pour les paniers et l'état des stocks temps réel des boulangeries.

---

## 4. Extraction Automatique du Design (Design Prédictif)

Le client peut téléverser ses assets graphiques (images, logos, captures d'écran de sites existants, PDF) pour définir l'identité visuelle de son futur site.

### 4.1 Pipeline d'Analyse Visuelle (Vision LLM)

Les fichiers sont soumis à un modèle multimodal (ex: GPT-4o) pour en extraire l'essence graphique. L'IA extrait un JSON standardisé contenant la charte graphique :

```json
{
  "theme": {
    "colors": {
      "primary": "#3B2F2F",
      "secondary": "#F5E6CC",
      "background": "#FFFFFF",
      "text": "#1A1A1A"
    },
    "fonts": {
      "heading": "Playfair Display",
      "body": "Inter"
    },
    "radius": "8px"
  }
}
```

### 4.2 Injection Dynamique dans le Design System

Les valeurs de la charte graphique générées par l'IA sont écrites par l'Orchestrateur dans un fichier de configuration globale du site du client. Le template Astro utilise ces tokens via des variables CSS natives :

```css
/* src/styles/theme.css */
:root {
  --color-primary: #3B2F2F;
  --color-secondary: #F5E6CC;
  --color-bg: #FFFFFF;
  --color-text: #1A1A1A;
  --font-heading: 'Playfair Display', serif;
  --font-body: 'Inter', sans-serif;
  --border-radius: 8px;
}
```

Tous les composants du site utilisent exclusivement ces variables, garantissant le respect immédiat de l'identité visuelle extraite.

---

## 5. Architecture de Contenu : Couplage Natif Astro ↔ Payload

Pour offrir une flexibilité totale d'édition tout en conservant les performances d'un site statique, le système repose sur une architecture de composants par blocs (Flexible Blocks).

### 5.1 Côté CMS : Payload Blocks

Dans l'instance Payload du client, une collection Pages est définie en utilisant le champ Blocks. Chaque bloc correspond à une section de l'interface utilisateur (Hero, Features, Gallery, ProductGrid).

### 5.2 Côté Front : Le Routeur de Blocs Astro

Astro récupère la structure de la page via l'API REST de Payload et mappe dynamiquement les blocs reçus vers des composants Astro isolés.

```astro
// src/pages/[...slug].astro
import Hero from '../components/blocks/Hero.astro';
import Features from '../components/blocks/Features.astro';
import ProductGrid from '../components/blocks/ProductGrid.astro';

const { slug } = Astro.params;
// Appel à l'API locale du Payload du client
const response = await fetch(`http://localhost:3000/api/pages?where[slug][equals]=${slug}`);
const data = await response.json();
const page = data.docs[0];

const blockMap = {
  hero: Hero,
  features: Features,
  'product-grid': ProductGrid,
};
---

<Layout title={page.title}>
  {page.layout.map((block) => {
    const Component = blockMap[block.blockType];
    return Component ? <Component data={block} /> : null;
  })}
</Layout>
```

---

## 6. Stratégie de Déploiement et Provisioning sur o2switch

L'hébergement s'effectue sur l'environnement mutualisé o2switch, en exploitant les fonctionnalités cPanel via scripts automatisés.

### 6.1 Stratégie de Multi-Tenancy et Isolation

* **Isolation des Fichiers et Processus :** Chaque client dispose d'un sous-dossier dédié contenant son propre dépôt Git cloné depuis un template de base. Les applications de back-end (Payload / Medusa) tournent de manière cloisonnée via l'outil "Sélectionner une application Node.js" du cPanel.
* **Isolation des Données :** L'Orchestrateur utilise l'API cPanel pour générer dynamiquement une base de données PostgreSQL isolée et un utilisateur unique par client. Les secrets et credentials sont stockés de manière étanche dans un fichier .env propre à chaque instance.
* **Gestion Réseau et SSL :** Les domaines personnalisés ou sous-domaines clients sont associés aux répertoires public_html/nom-du-client correspondants via l'API cPanel, déclenchant automatiquement la génération de certificats SSL Let's Encrypt gratuits.

### 6.2 Pipeline de Build Résistant aux Contraintes de Ressources

Les processus de compilation (Astro SSG) consomment ponctuellement beaucoup de CPU et de RAM. Pour éviter les blocages de processus ou la saturation des quotas sur un hébergement mutualisé, un script d'écoute de webhook intelligent est mis en place.

Ce script utilise un système de verrou (Lockfile) pour s'assurer qu'un client ne déclenche pas plusieurs builds simultanés s'il clique plusieurs fois sur "Enregistrer", et permet de sérialiser les files d'attente si nécessaire.
Script d'Automatisation du Build (Webhook Handler Node.js local) :

```javascript
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const ASTRO_PROJECT_DIR = '/home/username/client-sites/boulangerie-1';
const DIST_DIR = path.join(ASTRO_PROJECT_DIR, 'dist');
const PUBLIC_HTML_DIR = '/home/username/public_html/ma-boulangerie';
const LOCK_FILE = path.join(ASTRO_PROJECT_DIR, 'build.lock');

app.post('/webhook/rebuild', (req, res) => {
    // 1. Vérification si un build est déjà en cours
    if (fs.existsSync(LOCK_FILE)) {
        return res.status(429).json({ message: 'Build déjà en cours. Requête mise de côté.' });
    }

    // 2. Poser le verrou
    fs.writeFileSync(LOCK_FILE, 'locked');
    res.status(202).json({ message: 'Build démarré avec succès.' });

    console.log('Début de la recompilation statique d’Astro...');

    // 3. Exécuter le build et le déploiement de manière séquentielle
    exec(`cd ${ASTRO_PROJECT_DIR} && npm run build`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Erreur de build : ${error.message}`);
            fs.unlinkSync(LOCK_FILE); // Libérer le verrou en cas d'erreur
            return;
        }

        console.log('Build Astro terminé. Copie des fichiers vers public_html...');

        // 4. Déploiement des fichiers statiques dans le dossier web
        exec(`rsync -av --delete ${DIST_DIR}/ ${PUBLIC_HTML_DIR}/`, (deployError, deployStdout, deployStderr) => {
            // Dans tous les cas, on libère le verrou à la fin du processus
            fs.unlinkSync(LOCK_FILE);

            if (deployError) {
                console.error(`Erreur lors de la copie public_html : ${deployError.message}`);
                return;
            }
            console.log('Site mis à jour avec succès et synchronisé en production !');
        });
    });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Le webhook de build écoute sur le port ${PORT}`));
```

---

## 7. Sécurité et Maintenance

* **Sécurité des Données :** Aucune base de données n'est partagée entre les clients. Un piratage ou une faille de script sur l'instance du client A ne peut pas compromettre les données du client B.
* **Nettoyage Automatisé :** Une tâche Cron globale est configurée pour purger chaque semaine les dossiers temporaires de build (.astro, cache npm) ainsi que les fichiers de logs volumineux afin de ne jamais saturer l'espace disque alloué par o2switch.