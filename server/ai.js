const dotenv = require('dotenv');
dotenv.config();

// Helper to clean markdown codeblocks from JSON response
function cleanAndParseJSON(text) {
  let cleanText = text.trim();
  // Remove markdown code blocks if present
  if (cleanText.startsWith("```json")) {
    cleanText = cleanText.substring(7);
  } else if (cleanText.startsWith("```")) {
    cleanText = cleanText.substring(3);
  }
  if (cleanText.endsWith("```")) {
    cleanText = cleanText.substring(0, cleanText.length - 3);
  }
  return JSON.parse(cleanText.trim());
}

// Helper to parse base64 Data URLs
function parseBase64Image(dataUrl) {
  if (!dataUrl) return null;
  const matches = dataUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    // If not a data URL but already raw base64
    return {
      mimeType: "image/jpeg",
      base64Data: dataUrl
    };
  }
  return {
    mimeType: matches[1],
    base64Data: matches[2]
  };
}

// API Callers
async function callOpenAI(messages, responseFormat = null) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Clé API OpenAI manquante. Veuillez renseigner OPENAI_API_KEY dans le fichier .env");
  }

  const body = {
    model: "gpt-4o-mini",
    messages: messages,
    temperature: 0.2
  };
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Quota ou limite de requêtes (429) dépassée chez OpenAI. Veuillez patienter avant de réessayer.");
    }
    const errText = await res.text();
    throw new Error(`Erreur API OpenAI (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function callAnthropic(messages, systemPrompt = "") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Clé API Anthropic manquante. Veuillez renseigner ANTHROPIC_API_KEY dans le fichier .env");
  }

  // Anthropic messages requires text structure
  const formattedMessages = messages.map(msg => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }
    return { role: msg.role, content: msg.content };
  });

  const body = {
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4000,
    system: systemPrompt,
    messages: formattedMessages,
    temperature: 0.2
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Quota ou limite de requêtes (429) dépassée chez Anthropic. Veuillez patienter avant de réessayer.");
    }
    const errText = await res.text();
    throw new Error(`Erreur API Anthropic (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

async function callGemini(contents, systemPrompt = "", jsonMode = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Clé API Gemini manquante. Veuillez renseigner GEMINI_API_KEY dans le fichier .env");
  }

  const config = {
    temperature: 0.2
  };
  if (jsonMode) {
    config.responseMimeType = "application/json";
  }

  const body = {
    contents: contents,
    generationConfig: config
  };

  if (systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    if (res.status === 429) {
      throw new Error("Quota ou limite de requêtes (429) dépassée chez Gemini. Veuillez patienter environ une minute avant de réessayer.");
    }
    const errText = await res.text();
    throw new Error(`Erreur API Gemini (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json();
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("Aucune réponse reçue de Gemini.");
  }
  return data.candidates[0].content.parts[0].text;
}

// Unified orchestrator functions
async function runOnboard(provider, { name, description, features, ambiance, image, inspirationUrl }) {
  const selectedProvider = provider || process.env.DEFAULT_PROVIDER || 'openai';
  const systemPrompt = `Vous êtes un architecte de solutions SaaS web composables, un concepteur de sites web et un expert en identité graphique de marque.
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
      "heading": "Police de titre (choisir UNIQUEMENT parmi : 'Playfair Display', 'Outfit', 'Space Grotesk', 'Lora', 'Inter')",
      "body": "Police de corps (choisir UNIQUEMENT parmi : 'Inter', 'DM Sans', 'Karla', 'Plus Jakarta Sans')"
    },
    "radius": "Arrondi général avec unité, ex: '8px', '12px', '0px', '20px'"
  }
}

Générez entre 2 et 4 blocs pertinents en français, avec des textes fictifs complets et réalistes (sans placeholders comme [Nom du produit]). Les liens Unsplash doivent être des liens d'images réelles d'Unsplash tirés de votre base de connaissances ou d'exemples typiques.
Renvoyez UNIQUEMENT l'objet JSON. Pas d'exceptions, pas d'enrobage markdown autre que le format JSON strict.`;

  const userPrompt = `Détails du projet utilisateur :
- Nom du site : "${name || 'Mon Site'}"
- Activité / Description : "${description || 'Activité non spécifiée'}"
- Fonctionnalités souhaitées :
  * Blog ou actualités : ${features?.blog_or_news ? "OUI" : "NON"}
  * E-commerce / Vente en ligne : ${features?.e_commerce ? "OUI" : "NON"}
  * Multi-boutique / Adresses physiques : ${features?.multi_store ? "OUI" : "NON"}
${ambiance ? `- Ambiance graphique de départ demandée : "${ambiance}"` : ''}
${inspirationUrl ? `- Site d'inspiration de référence : "${inspirationUrl}"` : ''}`;

  let responseText = "";

  if (image) {
    const parsedImg = parseBase64Image(image);
    if (!parsedImg) {
      throw new Error("Format de l'image Base64 de l'onboarding invalide.");
    }

    if (selectedProvider === 'openai') {
      responseText = await callOpenAI([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${parsedImg.mimeType};base64,${parsedImg.base64Data}`
              }
            }
          ]
        }
      ], { type: "json_object" });
    } else if (selectedProvider === 'anthropic') {
      responseText = await callAnthropic([
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: parsedImg.mimeType,
                data: parsedImg.base64Data
              }
            },
            {
              type: "text",
              text: userPrompt
            }
          ]
        }
      ], systemPrompt);
    } else if (selectedProvider === 'gemini') {
      responseText = await callGemini([
        {
          parts: [
            {
              inlineData: {
                mimeType: parsedImg.mimeType,
                data: parsedImg.base64Data
              }
            },
            {
              text: userPrompt
            }
          ]
        }
      ], systemPrompt, true);
    } else {
      throw new Error(`Fournisseur d'IA inconnu : ${selectedProvider}`);
    }
  } else {
    // Si pas d'image, appel textuel standard
    if (selectedProvider === 'openai') {
      responseText = await callOpenAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ], { type: "json_object" });
    } else if (selectedProvider === 'anthropic') {
      responseText = await callAnthropic([
        { role: "user", content: userPrompt }
      ], systemPrompt);
    } else if (selectedProvider === 'gemini') {
      responseText = await callGemini([
        { parts: [{ text: userPrompt }] }
      ], systemPrompt, true);
    } else {
      throw new Error(`Fournisseur d'IA inconnu : ${selectedProvider}`);
    }
  }

  return cleanAndParseJSON(responseText);
}

// Complétion texte simple, mutualisée entre les fournisseurs. jsonMode=true attend
// une réponse JSON (parsée), sinon renvoie le texte brut nettoyé.
async function completeText(provider, systemPrompt, userPrompt, jsonMode = false) {
  const selectedProvider = provider || process.env.DEFAULT_PROVIDER || 'openai';
  let responseText;
  if (selectedProvider === 'openai') {
    responseText = await callOpenAI(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      jsonMode ? { type: 'json_object' } : null
    );
  } else if (selectedProvider === 'anthropic') {
    responseText = await callAnthropic([{ role: 'user', content: userPrompt }], systemPrompt);
  } else if (selectedProvider === 'gemini') {
    responseText = await callGemini([{ parts: [{ text: userPrompt }] }], systemPrompt, jsonMode);
  } else {
    throw new Error(`Fournisseur d'IA inconnu : ${selectedProvider}`);
  }
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
};
