// Fournisseurs d'IA (OpenAI, Anthropic, Gemini) : onboarding d'un site complet et
// assistant de rédaction du CMS. Un seul point d'appel réseau (délai maximal, erreurs
// homogènes) et une seule construction de message par fournisseur.
const { HEADING_FONTS, BODY_FONTS, validateTheme } = require('./lib/theme');

const AI_TIMEOUT_MS = Number.parseInt(process.env.AI_TIMEOUT_MS ?? '', 10) || 90 * 1000;

// Modèles surchargeables par variable d'environnement.
const PROVIDERS = {
  openai: { label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', model: () => process.env.OPENAI_MODEL || 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', keyEnv: 'ANTHROPIC_API_KEY', model: () => process.env.ANTHROPIC_MODEL || 'claude-opus-5-5' },
  gemini: { label: 'Gemini', keyEnv: 'GEMINI_API_KEY', model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
};

// Blocs que le template sait afficher (les autres sont écartés de la sortie IA).
const KNOWN_BLOCK_TYPES = new Set(['hero', 'features', 'product-grid', 'gallery', 'testimonials', 'faq', 'pricing', 'contact', 'appointment', 'info', 'footer']);

// Image d'inspiration acceptée : formats web courants, ~6 Mo de base64 au plus.
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;

// Extrait l'objet JSON d'une réponse (blocs ```json éventuels, texte autour).
function cleanAndParseJSON(text) {
  let cleanText = String(text || '').trim();
  if (cleanText.startsWith("```json")) {
    cleanText = cleanText.substring(7);
  } else if (cleanText.startsWith("```")) {
    cleanText = cleanText.substring(3);
  }
  if (cleanText.endsWith("```")) {
    cleanText = cleanText.substring(0, cleanText.length - 3);
  }
  cleanText = cleanText.trim();
  try {
    return JSON.parse(cleanText);
  } catch (err) {
    const first = cleanText.indexOf('{');
    const last = cleanText.lastIndexOf('}');
    if (first !== -1 && last > first) return JSON.parse(cleanText.slice(first, last + 1));
    throw err;
  }
}

// Data URL base64 → { mimeType, base64Data }, ou null si le format est refusé.
function parseBase64Image(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl) return null;
  const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  const mimeType = matches ? matches[1].toLowerCase() : 'image/jpeg'; // base64 brut : JPEG supposé
  const base64Data = matches ? matches[2] : dataUrl;
  if (!IMAGE_MIME_TYPES.has(mimeType) || base64Data.length > MAX_IMAGE_BASE64_LENGTH || !/^[A-Za-z0-9+/=\s]+$/.test(base64Data)) {
    return null;
  }
  return { mimeType, base64Data };
}

// POST JSON vers un fournisseur, borné dans le temps, avec des erreurs explicites.
async function postJson(provider, url, headers, body) {
  const { label } = PROVIDERS[provider];
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`${label} n'a pas répondu dans le délai imparti (${Math.round(AI_TIMEOUT_MS / 1000)} s).`);
    }
    throw new Error(`${label} est injoignable : ${err && err.message}`);
  }
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(`Quota ou limite de requêtes (429) dépassée chez ${label}. Veuillez patienter avant de réessayer.`);
    }
    const errText = await res.text();
    throw new Error(`Erreur API ${label} (HTTP ${res.status}): ${errText.slice(0, 500)}`);
  }
  return res.json();
}

function apiKeyFor(provider) {
  const { label, keyEnv } = PROVIDERS[provider];
  const apiKey = process.env[keyEnv];
  if (!apiKey) {
    throw new Error(`Clé API ${label} manquante. Veuillez renseigner ${keyEnv} dans le fichier .env`);
  }
  return apiKey;
}

// Requête unique vers le fournisseur choisi : consigne système, message utilisateur,
// image facultative, et json=true pour exiger un objet JSON. Renvoie le texte produit.
const CALLERS = {
  async openai({ system, user, image, json }) {
    const apiKey = apiKeyFor('openai');
    const content = image
      ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64Data}` } }]
      : user;
    const body = {
      model: PROVIDERS.openai.model(),
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
      temperature: 0.2,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    };
    const data = await postJson('openai', 'https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${apiKey}` }, body);
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error('Aucune réponse reçue de OpenAI.');
    return text;
  },

  async anthropic({ system, user, image }) {
    const apiKey = apiKeyFor('anthropic');
    const content = image
      ? [{ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64Data } }, { type: 'text', text: user }]
      : user;
    const body = {
      model: PROVIDERS.anthropic.model(),
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content }],
    };
    const data = await postJson('anthropic', 'https://api.anthropic.com/v1/messages', { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body);
    if (data.stop_reason === 'refusal') throw new Error('Anthropic a refusé de traiter cette demande.');
    // La réponse peut contenir plusieurs blocs : on concatène les blocs texte.
    const text = (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new Error('Aucune réponse reçue de Anthropic.');
    return text;
  },

  async gemini({ system, user, image, json }) {
    const apiKey = apiKeyFor('gemini');
    const parts = image ? [{ inlineData: { mimeType: image.mimeType, data: image.base64Data } }, { text: user }] : [{ text: user }];
    const body = {
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) },
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    };
    // Clé en en-tête (jamais dans l'URL, qui finit dans les journaux des proxys)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(PROVIDERS.gemini.model())}:generateContent`;
    const data = await postJson('gemini', url, { 'x-goog-api-key': apiKey }, body);
    const candidate = data.candidates && data.candidates[0];
    const text = candidate && candidate.content && (candidate.content.parts || []).map((p) => p.text || '').join('');
    if (!text) throw new Error('Aucune réponse reçue de Gemini.');
    return text;
  },
};

async function complete(provider, request) {
  const selectedProvider = provider || process.env.DEFAULT_PROVIDER || 'openai';
  const caller = CALLERS[selectedProvider];
  if (!caller) throw new Error(`Fournisseur d'IA inconnu : ${selectedProvider}`);
  return caller(request);
}

// --- Onboarding ---------------------------------------------------------------

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

function onboardSystemPrompt({ name, features, ambiance, image, inspirationUrl }) {
  return `Vous êtes un architecte de solutions SaaS web composables, un concepteur de sites web et un expert en identité graphique de marque.
Analysez le nom du site, l'activité de l'utilisateur, les fonctionnalités requises et l'inspiration graphique fournie (ambiance prédéfinie, image/logo de référence ou URL d'inspiration) pour en déduire les spécifications techniques de la stack, concevoir une ébauche de page d'accueil personnalisée et composer une charte graphique premium assortie.

L'utilisateur souhaite s'inspirer de :
${ambiance ? `- L'ambiance prédéfinie : "${ambiance}"` : ''}
${inspirationUrl ? `- Le site web d'inspiration : "${inspirationUrl}"` : ''}
${image ? `- Une image / logo importé (qui vous est fourni en pièce jointe)` : ''}

Vous devez générer une palette de couleurs, des polices et des bordures harmonieuses et premium basées sur ces éléments d'inspiration. Si une image/logo est fourni, analysez ses couleurs dominantes et son identité visuelle pour composer le thème. Si une URL est fournie, inspirez-vous de la marque, du style ou du secteur associés à ce site.
Évitez à tout prix les couleurs basiques trop saturées (comme le bleu pur, le rouge primaire). Choisissez des palettes raffinées (ex. couleurs chaudes, tons nature, sombres chics).

Vous devez impérativement retourner un objet JSON correspondant EXACTEMENT au schéma suivant :
{
  "qualification": {
    "site_name": "Nom du site web (ex: '${name || 'Mon Site'}')",
    "features": {
      "blog_or_news": boolean (doit être ${features?.blog_or_news ? 'true' : 'false'}),
      "e_commerce": boolean (doit être ${features?.e_commerce ? 'true' : 'false'}),
      "multi_store": boolean (doit être ${features?.multi_store ? 'true' : 'false'})
    },
    "stack_requirements": {
      "astro_mode": "ssg" ou "hybrid" (doit être 'hybrid' si e_commerce avec multi_store ou besoins dynamiques avancés, sinon 'ssg' pour économiser des ressources),
      "need_payload": boolean (vrai si blog_or_news est vrai, ou si e_commerce est vrai, ou si besoin de modifier le contenu dynamiquement),
      "need_medusajs": boolean (vrai si e-commerce multi-boutique complexe, sinon faux),
      "need_stripe": boolean (vrai si e_commerce est vrai)
    }
  },
  "pages": {
    "docs": [
      {
        "title": "Accueil",
        "slug": "home",
        "layout": [
          // Liste de blocs personnalisés en fonction de l'activité. Les blocs disponibles sont :
          
          // Bloc 1 (Toujours obligatoire en premier) : hero
          {
            "blockType": "hero",
            "title": "Titre d'accroche percutant adapté à l'activité de l'utilisateur",
            "subtitle": "Sous-titre descriptif engageant présentant la proposition de valeur",
            "ctaText": "Texte du bouton d'action principal",
            "backgroundImage": "Lien vers une image Unsplash premium et de haute qualité pertinente pour l'activité (ex: pour une boulangerie, une image de pain chaud. Utilisez des liens d'images Unsplash valides, sans clé API nécessaire, ex: https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&q=80&w=1200)"
          },
          
          // Bloc 2 (Recommandé) : features (pour lister les avantages, services ou valeurs de l'entreprise)
          {
            "blockType": "features",
            "title": "Titre de la section services/avantages (ex: 'Nos prestations', 'Pourquoi nous choisir')",
            "items": [
              { "title": "Avantage/Prestation 1", "description": "Description de l'avantage ou de la prestation." },
              { "title": "Avantage/Prestation 2", "description": "Description..." },
              { "title": "Avantage/Prestation 3", "description": "Description..." }
            ]
          },
          
          // Bloc 3 (Recommandé si e-commerce ou prestations de services tarifées) : product-grid
          {
            "blockType": "product-grid",
            "title": "Titre de la grille de produits/services (ex: 'Nos formules', 'Nos produits vedettes')",
            "products": [
              { "name": "Nom du produit/formule 1", "price": "Prix avec symbole (ex: '45.00 €', '1.30 €')", "image": "Lien image Unsplash correspondante (ex: https://images.unsplash.com/photo-1549931319-a545dcf3bc73?auto=format&fit=crop&q=80&w=400)" },
              { "name": "Nom du produit/formule 2", "price": "Prix...", "image": "Lien image..." },
              { "name": "Nom du produit/formule 3", "price": "Prix...", "image": "Lien image..." }
            ]
          },
          
          // Bloc 4 (Optionnel) : gallery (pour un portfolio, des réalisations ou photos d'illustration)
          {
            "blockType": "gallery",
            "title": "Titre de la galerie (ex: 'Nos réalisations', 'Notre univers')",
            "images": [
              "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=300",
              "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=300",
              "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=300"
            ]
          },

          // Bloc 5 (Recommandé) : faq (questions fréquentes réalistes sur l'activité : horaires, délais, tarifs, zone desservie…)
          {
            "blockType": "faq",
            "title": "Questions fréquentes",
            "items": [
              { "question": "Question fréquente 1", "answer": "Réponse claire et utile." },
              { "question": "Question fréquente 2", "answer": "Réponse..." }
            ]
          },

          // Bloc 6 (Recommandé, en dernier) : contact (formulaire de contact)
          {
            "blockType": "contact",
            "title": "Titre de la section contact (ex: 'Contactez-nous')",
            "subtitle": "Phrase d'invitation à écrire",
            "ctaText": "Texte du bouton d'envoi (ex: 'Envoyer')"
          }
        ]
      }
    ]
  },
  "theme": {
    "colors": {
      "primary": "#couleur_principale_hex (couleur d'accent, boutons)",
      "secondary": "#couleur_secondaire_hex (teinte douce ou crème contrastant bien avec le fond)",
      "background": "#couleur_fond_hex (fond général de la page, clair ou sombre)",
      "text": "#couleur_texte_hex (couleur lisible sur le fond)"
    },
    "fonts": {
      "heading": "Police de titre (choisir UNIQUEMENT parmi : ${HEADING_FONTS.map((f) => `'${f}'`).join(', ')})",
      "body": "Police de corps (choisir UNIQUEMENT parmi : ${BODY_FONTS.map((f) => `'${f}'`).join(', ')})"
    },
    "radius": "Arrondi général avec unité, ex: '8px', '12px', '0px', '20px'"
  }
}

Générez entre 3 et 5 blocs pertinents en français (le hero en premier, de préférence le contact en dernier), avec des textes complets et réalistes (sans placeholders comme [Nom du produit]). N'inventez jamais d'avis ni de témoignages de clients. Les liens Unsplash doivent être des liens d'images réelles d'Unsplash tirés de votre base de connaissances ou d'exemples typiques.
Renvoyez UNIQUEMENT l'objet JSON. Pas d'exceptions, pas d'enrobage markdown autre que le format JSON strict.`;
}

// Sortie IA normalisée : qualification complète (valeurs par défaut sûres), pages
// limitées aux blocs connus, thème validé (sinon null → thème par défaut côté appelant).
function normalizeOnboardResult(raw, { name, features } = {}) {
  const q = (raw && typeof raw.qualification === 'object' && raw.qualification) || {};
  const req = (q && typeof q.stack_requirements === 'object' && q.stack_requirements) || {};
  const qualification = {
    site_name: clip(q.site_name, 120) || clip(name, 120) || 'Nouveau Site',
    features: {
      blog_or_news: Boolean(features && features.blog_or_news),
      e_commerce: Boolean(features && features.e_commerce),
      multi_store: Boolean(features && features.multi_store),
    },
    stack_requirements: {
      astro_mode: req.astro_mode === 'hybrid' ? 'hybrid' : 'ssg',
      need_payload: Boolean(req.need_payload),
      need_medusajs: Boolean(req.need_medusajs),
      need_stripe: Boolean(req.need_stripe),
    },
  };

  const rawDocs = raw && raw.pages && Array.isArray(raw.pages.docs) ? raw.pages.docs : [];
  const docs = rawDocs
    .filter((p) => p && typeof p === 'object')
    .map((p, i) => {
      const slug = typeof p.slug === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(p.slug) ? p.slug : (i === 0 ? 'home' : `page-${i + 1}`);
      return {
        title: clip(p.title, 120) || (i === 0 ? 'Accueil' : `Page ${i + 1}`),
        slug,
        layout: Array.isArray(p.layout) ? p.layout.filter((b) => b && typeof b === 'object' && KNOWN_BLOCK_TYPES.has(b.blockType)) : [],
      };
    })
    .filter((p) => p.layout.length > 0);

  const theme = raw && raw.theme && validateTheme(raw.theme).ok ? raw.theme : null;
  return { qualification, pages: docs.length > 0 ? { docs } : null, theme };
}

async function runOnboard(provider, input) {
  // Entrées bornées (coût et abus) : l'onboarding est accessible aux clients.
  const name = clip(input.name, 120);
  const description = clip(input.description, 2000);
  const ambiance = clip(input.ambiance, 100);
  const inspirationUrl = clip(input.inspirationUrl, 300);
  const features = input.features || {};
  let image = null;
  if (input.image) {
    image = parseBase64Image(input.image);
    if (!image) throw new Error("Image d'inspiration refusée : utilisez un PNG, JPEG, WebP ou GIF de moins de 6 Mo.");
  }

  const system = onboardSystemPrompt({ name, features, ambiance, image, inspirationUrl });
  const user = `Détails du projet utilisateur :
- Nom du site : "${name || 'Mon Site'}"
- Activité / Description : "${description || 'Activité non spécifiée'}"
- Fonctionnalités souhaitées :
  * Blog ou actualités : ${features.blog_or_news ? "OUI" : "NON"}
  * E-commerce / Vente en ligne : ${features.e_commerce ? "OUI" : "NON"}
  * Multi-boutique / Adresses physiques : ${features.multi_store ? "OUI" : "NON"}
${ambiance ? `- Ambiance graphique de départ demandée : "${ambiance}"` : ''}
${inspirationUrl ? `- Site d'inspiration de référence : "${inspirationUrl}"` : ''}`;

  const responseText = await complete(provider, { system, user, image, json: true });
  return normalizeOnboardResult(cleanAndParseJSON(responseText), { name, features });
}

// --- Assistant de rédaction --------------------------------------------------

// Complétion texte : jsonMode=true attend une réponse JSON (parsée), sinon renvoie le
// texte brut nettoyé.
async function completeText(provider, system, user, jsonMode = false) {
  const responseText = await complete(provider, { system, user, json: jsonMode });
  return jsonMode ? cleanAndParseJSON(responseText) : responseText.trim();
}

// Assistant de rédaction pour le CMS. Réutilise les mêmes fournisseurs que l'onboarding.
// action : 'rewrite' | 'generate-description' | 'seo'. Retourne { text } ou
// { metaTitle, metaDescription } selon l'action.
async function runAssist(provider, { action, input, context }) {
  const safeInput = String(input || '').slice(0, 4000);
  const safeContext = String(context || '').slice(0, 500);

  if (action === 'rewrite') {
    if (!safeInput.trim()) throw new Error('Aucun texte à améliorer.');
    const system = "Tu es un rédacteur web professionnel francophone. Améliore le texte fourni pour un site vitrine : plus clair, plus engageant, sans fautes. Garde la même langue et une longueur similaire. Réponds UNIQUEMENT avec le texte amélioré, sans guillemets ni commentaire.";
    const user = `${safeContext ? `Contexte du site : ${safeContext}\n\n` : ''}Texte à améliorer :\n${safeInput}`;
    return { text: await completeText(provider, system, user) };
  }

  if (action === 'generate-description') {
    const system = "Tu es un rédacteur web professionnel francophone. Rédige une courte description marketing (1 à 2 phrases) pour la section d'un site vitrine. Ton chaleureux et professionnel. Réponds UNIQUEMENT avec la description, sans guillemets ni commentaire.";
    const user = `${safeContext ? `Sujet : ${safeContext}\n` : ''}${safeInput ? `Éléments à intégrer : ${safeInput}` : 'Génère une description générique attrayante.'}`;
    return { text: await completeText(provider, system, user) };
  }

  if (action === 'article') {
    if (!safeInput.trim()) throw new Error("Aucun sujet d'article fourni.");
    const system = "Tu es un rédacteur web professionnel francophone pour des sites vitrine de PME. Rédige un court article de blog (200 à 350 mots) à partir du sujet fourni. Ton chaleureux et informatif. Utilise une mise en forme markdown LÉGÈRE : sous-titres (## …), listes à puces (- …), **gras** ponctuel. Réponds STRICTEMENT en JSON : {\"title\": \"…\", \"excerpt\": \"… (1 phrase)\", \"body\": \"… (markdown)\"}.";
    const user = `${safeContext ? `Nom du site : ${safeContext}\n` : ''}Sujet de l'article :\n${safeInput}`;
    const out = await completeText(provider, system, user, true);
    return {
      title: String(out.title || '').slice(0, 160),
      excerpt: String(out.excerpt || '').slice(0, 300),
      body: String(out.body || '').slice(0, 8000),
    };
  }

  if (action === 'seo') {
    const system = "Tu es un expert SEO francophone. À partir du contenu d'une page, propose un titre d'onglet (metaTitle, ≤ 60 caractères) et une méta-description (metaDescription, ≤ 155 caractères) optimisés et naturels. Réponds STRICTEMENT en JSON : {\"metaTitle\": \"...\", \"metaDescription\": \"...\"}.";
    const user = `${safeContext ? `Nom du site : ${safeContext}\n` : ''}Contenu de la page :\n${safeInput}`;
    const out = await completeText(provider, system, user, true);
    return {
      metaTitle: String(out.metaTitle || '').slice(0, 70),
      metaDescription: String(out.metaDescription || '').slice(0, 170),
    };
  }

  throw new Error(`Action d'assistance inconnue : ${action}`);
}

module.exports = {
  runOnboard,
  runAssist,
  // Exportés pour les tests unitaires
  cleanAndParseJSON,
  parseBase64Image,
  normalizeOnboardResult,
};
