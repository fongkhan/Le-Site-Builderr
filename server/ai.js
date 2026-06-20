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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
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
async function runOnboard(provider, promptText) {
  const selectedProvider = provider || process.env.DEFAULT_PROVIDER || 'openai';
  const systemPrompt = `Vous êtes un architecte de solutions SaaS web composables.
Analysez la description de besoin utilisateur fournie et déduisez-en les spécifications techniques optimales et le routage de stack sur notre hébergement.
Vous devez impérativement retourner un objet JSON correspondant exactement au schéma suivant :
{
  "site_name": "Nom du site web extrait ou déduit en français (ex: 'Boulangerie de Clamart')",
  "features": {
    "blog_or_news": boolean (vrai si besoin d'un blog, d'actualités, d'articles de presse, de portfolio ou de contenu administrable régulier),
    "e_commerce": boolean (vrai si vente en ligne, panier, e-boutique ou intégration de produits à acheter),
    "multi_store": boolean (vrai si plusieurs boutiques physiques, gestion des stocks multi-emplacements ou logistique complexe)
  },
  "stack_requirements": {
    "astro_mode": "ssg" ou "hybrid" (doit être 'hybrid' si e_commerce avec multi_store ou besoins dynamiques avancés, sinon 'ssg' pour économiser des ressources),
    "need_payload": boolean (vrai si blog_or_news est vrai, ou si e_commerce est vrai, ou si besoin de modifier le contenu dynamiquement),
    "need_medusajs": boolean (vrai si e-commerce multi-boutique complexe, sinon faux),
    "need_stripe": boolean (vrai si e_commerce est vrai)
  }
}
Renvoyez UNIQUEMENT l'objet JSON. Pas d'explications en dehors du JSON, pas d'enrobage markdown autre que le format JSON strict.`;

  const userPrompt = `Description du besoin utilisateur : "${promptText}"`;

  let responseText = "";
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

  return cleanAndParseJSON(responseText);
}

async function runExtractDesign(provider, base64Image, ambiance) {
  const selectedProvider = provider || process.env.DEFAULT_PROVIDER || 'openai';
  const systemPrompt = `Vous êtes un expert en design graphique et identité de marque moderne.
Générez une palette de couleurs, des polices et des bordures harmonieuses et premium pour le projet.
Évitez les couleurs basiques trop saturées (comme le bleu pur, le rouge primaire). Choisissez des palettes raffinées (ex. couleurs chaudes, tons nature, sombres chics).
Vous devez retourner uniquement un objet JSON correspondant exactement au schéma suivant :
{
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
Renvoyez UNIQUEMENT l'objet JSON. Pas d'explications, pas de texte d'enrobage.`;

  let responseText = "";

  if (base64Image) {
    const parsedImg = parseBase64Image(base64Image);
    if (!parsedImg) {
      throw new Error("Format de l'image Base64 invalide.");
    }

    const userPromptText = "Analysez cette image (logo ou capture d'écran d'inspiration graphique) et déduisez-en une palette de couleurs, des polices et des arrondis de composants harmonieux reprenant l'identité visuelle de l'image.";

    if (selectedProvider === 'openai') {
      responseText = await callOpenAI([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPromptText },
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
              text: userPromptText
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
              text: userPromptText
            }
          ]
        }
      ], systemPrompt, true);
    } else {
      throw new Error(`Fournisseur d'IA inconnu : ${selectedProvider}`);
    }
  } else {
    // Si pas d'image, on utilise l'ambiance choisie ou un prompt textuel pour générer dynamiquement via LLM
    const userPromptText = `Générez une identité visuelle complète pour l'ambiance ou le thème suivant : "${ambiance || 'chaleureux'}".`;

    if (selectedProvider === 'openai') {
      responseText = await callOpenAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPromptText }
      ], { type: "json_object" });
    } else if (selectedProvider === 'anthropic') {
      responseText = await callAnthropic([
        { role: "user", content: userPromptText }
      ], systemPrompt);
    } else if (selectedProvider === 'gemini') {
      responseText = await callGemini([
        { parts: [{ text: userPromptText }] }
      ], systemPrompt, true);
    } else {
      throw new Error(`Fournisseur d'IA inconnu : ${selectedProvider}`);
    }
  }

  return cleanAndParseJSON(responseText);
}

module.exports = {
  runOnboard,
  runExtractDesign
};
