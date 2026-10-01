# client-template — générateur des sites publiés

Projet Astro (SSG) compilé par le serveur (`server/services/build.js`) pour chaque site
client. Le contenu (pages, articles) est lu **au build** via le canal interne de
l'orchestrateur ; la sortie `dist/` est un site statique autonome.

## Structure

```text
client-template/
├── astro.config.mjs            # base = SITE_BASE_PATH, plugin des polices du thème
├── integrations/
│   └── theme-fonts.mjs         # polices auto-hébergées (@fontsource-variable/*)
├── fixtures/
│   └── site.json               # contenu de test (TEMPLATE_FIXTURE)
├── public/                     # favicon
└── src/
    ├── components/
    │   ├── blocks/             # un composant par type de bloc du CMS (11)
    │   └── forms/              # LeadForm.astro + lead-form.ts (Contact / RDV)
    ├── layouts/Layout.astro    # <head> (SEO, OG, hreflang, JSON-LD), menu, RGPD
    ├── lib/
    │   ├── content.ts          # lecture du contenu (une seule fois par build)
    │   ├── url.ts              # withBase(), safeHttpUrl(), cssUrl()…
    │   ├── jsonld.ts           # sérialisation sûre, LocalBusiness, FAQPage
    │   ├── format.ts           # dates
    │   ├── i18n.mjs            # règle des URLs par langue (identique au serveur)
    │   └── markdown.mjs        # mini-markdown sûr des articles
    ├── pages/
    │   ├── [...slug].astro     # pages du CMS (langue par défaut à la racine, /en/…)
    │   └── blog/               # index + articles
    └── styles/                 # base.css, blocks.css, theme.css (écrit par le serveur)
```

## Variables d'environnement (fournies par le serveur de build)

| Variable | Rôle |
| :-- | :-- |
| `ACTIVE_SITE_SLUG`, `BUILD_TOKEN`, `ORCHESTRATOR_URL` | Site compilé et accès au canal interne. Les deux premières définies = build orchestré : une API injoignable fait **échouer** le build. |
| `SITE_BASE_PATH` | Chemin de base : `/` (production), `/preview/<slug>` (publication simulée), `/draft/<slug>` (brouillon). |
| `PUBLIC_API_BASE` | Origine de l'API (formulaires, statistiques) ; vide = même origine. |
| `PUBLIC_SITE_NAME`, `PUBLIC_SITE_URL` | Nom et URL publique (canonique, Open Graph, hreflang, JSON-LD). Vide en brouillon. |
| `PUBLIC_ANALYTICS_*` | Mesure d'audience, chargée après consentement uniquement. |
| `PUBLIC_IS_DRAFT=1` | Brouillon : `noindex`, pas de statistiques, blocs inconnus signalés. |
| `TEMPLATE_FIXTURE` | Chemin d'un JSON `{ pages: { docs }, posts: { docs } }` lu à la place de l'API. |

## Règles à respecter

- **Liens internes** : toujours `withBase('/chemin/')` (`src/lib/url.ts`), jamais un
  chemin absolu en dur — le site doit fonctionner sous `/preview/<slug>/`.
- **URLs saisies par le client** (`href`, `src`, image de fond) : toujours filtrées par
  `safeHttpUrl()` / `cssUrl()` (http(s) uniquement ; `mailto:`/`tel:` via `safeMailto()` /
  `safeTel()`). Les médias du canal interne arrivent déjà préfixés (`<base>/media/…`).
- **JSON-LD** : émis par la page (un seul `LocalBusiness`, `@id` = `<siteUrl>/#business`,
  pas d'avis auto-déclarés), sérialisé par `jsonLdString()`.
- **Polices** : uniquement les 2 familles du thème (`--font-heading` / `--font-body` de
  `src/styles/theme.css`), auto-hébergées en sous-ensemble latin — aucune requête vers
  Google Fonts. Ajouter une police à l'allowlist du serveur impose d'ajouter son paquet
  `@fontsource-variable/*` et son entrée dans `integrations/theme-fonts.mjs`.
- **Boutons d'action** (Hero, formules, produits) : pas de lien côté CMS ; ils pointent
  vers le formulaire de la page (`#contact`, `#rendez-vous`) ou d'une autre page de la
  même langue, sinon ils ne sont pas affichés.
- Une page de la langue par défaut à l'adresse `blog` ou `en` est ignorée (avertissement
  au build) : ces adresses sont réservées au blog et au préfixe de langue.

## Commandes

À lancer depuis `client-template/` :

```sh
npm install        # dépendances (Astro, polices)
npm run build      # build local : sans API joignable → page de secours hors-ligne
npm run dev        # serveur de développement (localhost:4321)

# Build de test complet, sans serveur, sous un chemin d'aperçu :
TEMPLATE_FIXTURE=$PWD/fixtures/site.json SITE_BASE_PATH=/preview/demo \
  PUBLIC_SITE_URL=https://demo.example npm run build
```

Les tests unitaires du mini-markdown et de la règle i18n sont dans `server/tests/unit/`
(`cd server && npm test`).
