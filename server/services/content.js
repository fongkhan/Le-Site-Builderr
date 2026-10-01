// Contenu des sites : pages, articles et thème. Payload est la source de vérité ; les
// fichiers JSON de data/ servent de repli (mode sans base) et de miroir.
const fs = require('fs');
const path = require('path');
const { validateTheme } = require('../lib/theme');
const { readJsonStrict, writeJsonAtomic } = require('../lib/json-file');
const sitesStore = require('../sites-store');
const { getPayloadInstance } = require('../core/payload');
const {
  ASTRO_PROJECT_DIR,
  PUBLIC_HTML_DIR,
  SITES_FILE,
  getSitePagesFile,
  getSiteThemeFile,
  getSitePostsFile,
} = require('../core/config');
const { DEFAULT_PAGES, DEFAULT_THEME, starterPages } = require('./defaults');

const SEED_SITE_SLUG = 'boulangerie-artisanale';

// Lit un fichier JSON ; absent ou illisible → fallback.
function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Vrai si le fichier existe, se parse et passe la validation fournie.
function isUsableJsonFile(filePath, validate) {
  if (!fs.existsSync(filePath)) return false;
  try {
    return validate(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
  } catch (e) {
    return false;
  }
}

// Données initiales au boot : registre des sites (mode JSON), pages/thème du site seedé
// s'ils sont absents ou vides/corrompus, et theme.css par défaut du template.
function seedDefaultData() {
  if (!fs.existsSync(SITES_FILE)) {
    const seededSites = [
      {
        slug: SEED_SITE_SLUG,
        name: "Boulangerie Artisanale Clamart",
        domain: "boulangerie-clamart.o2switch.site",
        documentRoot: path.join(PUBLIC_HTML_DIR, SEED_SITE_SLUG).replace(/\\/g, '/'),
        repositoryPath: "",
        stack: "Astro SSG + Payload CMS",
        createdWithTool: true,
        status: "draft",
        sslStatus: "active"
      }
    ];
    writeJsonFile(SITES_FILE, seededSites);
  }
  if (!isUsableJsonFile(getSitePagesFile(SEED_SITE_SLUG), (p) => Array.isArray(p.docs) && p.docs.length > 0)) {
    writeJsonFile(getSitePagesFile(SEED_SITE_SLUG), DEFAULT_PAGES);
  }
  if (!isUsableJsonFile(getSiteThemeFile(SEED_SITE_SLUG), (t) => Boolean(t.theme && t.theme.colors))) {
    writeJsonFile(getSiteThemeFile(SEED_SITE_SLUG), DEFAULT_THEME);
  }
  writeThemeCss(DEFAULT_THEME);
}

// Synchronise un thème JSON vers le fichier CSS global du template Astro.
function writeThemeCss(themeData) {
  // Défense en profondeur : un siteThemeFile corrompu ou légué (antérieur à la
  // validation d'entrée) ne doit jamais injecter de CSS ni casser le build.
  const candidate = themeData && themeData.theme;
  const t = validateTheme(candidate).ok ? candidate : DEFAULT_THEME.theme;
  const cssContent = `/* Généré automatiquement par l'Orchestrateur */
:root {
  --color-primary: ${t.colors.primary};
  --color-secondary: ${t.colors.secondary};
  --color-bg: ${t.colors.background};
  --color-text: ${t.colors.text};
  --font-heading: '${t.fonts.heading}', serif;
  --font-body: '${t.fonts.body}', sans-serif;
  --border-radius: ${t.radius};
}
`;
  const cssDir = path.join(ASTRO_PROJECT_DIR, 'src/styles');
  if (!fs.existsSync(cssDir)) {
    fs.mkdirSync(cssDir, { recursive: true });
  }
  fs.writeFileSync(path.join(cssDir, 'theme.css'), cssContent, 'utf-8');
}

// Applique au template le thème d'un site avant une compilation. Même source que
// l'éditeur de design (readSiteTheme) ; sans thème enregistré, le thème par défaut est
// écrit — jamais celui du site compilé précédemment (theme.css est global au template).
async function applySiteThemeCss(siteSlug) {
  try {
    writeThemeCss(await readSiteTheme(siteSlug));
  } catch (e) {
    console.error("Erreur lors de l'application du thème pour le build", e);
    writeThemeCss(DEFAULT_THEME);
  }
}

// Identifiant Payload d'un site (ou null s'il n'y est pas référencé).
async function findPayloadSiteId(payloadInstance, siteSlug) {
  const siteRes = await payloadInstance.find({
    collection: 'payload_sites',
    where: { slug: { equals: siteSlug } },
    limit: 1,
    overrideAccess: true
  });
  return siteRes.docs.length > 0 ? siteRes.docs[0].id : null;
}

// Lecture des pages d'un site : Payload d'abord, fallback JSON (partagé entre l'API
// authentifiée et le canal interne de build)
async function readSitePages(siteSlug) {
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    try {
      const siteId = await findPayloadSiteId(payloadInstance, siteSlug);
      if (siteId) {
        const pagesRes = await payloadInstance.find({
          collection: 'pages',
          where: { site: { equals: siteId } },
          // Toutes les pages : la limite par défaut de Payload (10) tronquait les gros sites
          pagination: false,
          overrideAccess: true
        });
        if (pagesRes.docs.length > 0) {
          return {
            docs: [...splitDuplicatePages(pagesRes.docs).kept.values()].map(page => ({
              title: page.title,
              slug: page.slug,
              locale: page.locale || 'fr',
              metaTitle: page.metaTitle || undefined,
              metaDescription: page.metaDescription || undefined,
              layout: page.layout ? page.layout.map(block => {
                const { id, ...fields } = block;
                if (block.blockType === 'gallery' && fields.images) {
                  fields.images = fields.images.map(img => typeof img === 'object' && img !== null ? img.url : img);
                }
                return {
                  blockType: block.blockType,
                  ...fields
                };
              }) : []
            }))
          };
        }
      }
    } catch (dbError) {
      console.error("Erreur lecture pages de Payload, fallback JSON:", dbError.message);
    }
  }

  const sitePagesFile = getSitePagesFile(siteSlug);
  if (fs.existsSync(sitePagesFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(sitePagesFile, 'utf-8'));
      if (data && Array.isArray(data.docs)) return { ...data, docs: dedupePageDocs(data.docs) };
      return data;
    } catch (e) {
      console.error(`Fichier de pages corrompu pour ${siteSlug}, fallback par défaut :`, e.message);
    }
  }
  return fallbackPages(siteSlug);
}

// Pages d'un site qui n'en a encore aucune (site importé par scan…) : le contenu de
// démonstration pour le site seedé, sinon des pages de départ à son nom.
async function fallbackPages(siteSlug) {
  if (siteSlug === SEED_SITE_SLUG) return DEFAULT_PAGES;
  let site = null;
  try { site = await sitesStore.getSiteBySlug(siteSlug); } catch { site = null; }
  return starterPages(site ? site.name : siteSlug);
}

// Schémas d'URL exécutables : jamais acceptés dans un champ d'URL de bloc (image, avatar,
// lien Google, réseaux sociaux), qui finit en href/src sur le site publié. Les champs de
// texte ne sont pas concernés : « JavaScript & TypeScript » est un intitulé légitime.
const DANGEROUS_URL = /^(?:javascript|vbscript)\s*:|^data\s*:\s*text\/html/i;
const URL_FIELDS = new Set([
  'backgroundImage', 'image', 'images', 'url', 'avatar', 'googleBusinessUrl',
  'socials', 'facebook', 'instagram', 'linkedin', 'x',
]);

// Les navigateurs ignorent blancs et caractères de contrôle dans un schéma (« java\tscript: »).
const isDangerousUrl = (value) => DANGEROUS_URL.test(value.replace(/[\u0000-\u0020]/g, ''));

function findDangerousUrl(value, inUrlField = false) {
  if (typeof value === 'string') return inUrlField && isDangerousUrl(value) ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findDangerousUrl(v, inUrlField);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      const found = findDangerousUrl(v, inUrlField || URL_FIELDS.has(key));
      if (found) return found;
    }
  }
  return null;
}

// Clé d'une page : (langue, slug). Deux langues peuvent partager le même slug.
const pageKey = (slug, locale) => `${locale === 'en' ? 'en' : 'fr'}:${slug}`;
const PAGE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_DELETED_PAGES = 500;

// Valide le corps envoyé par le CMS : { docs: [{ title, slug, locale?, layout? }] }.
// Renvoie un message d'erreur, ou null si le corps est exploitable.
function validatePagesBody(body) {
  if (!body || !Array.isArray(body.docs)) return "Corps invalide : une liste de pages (docs) est attendue.";
  const keys = new Set();
  for (const page of body.docs) {
    if (!page || typeof page !== 'object') return "Page invalide.";
    if (typeof page.title !== 'string' || !page.title.trim()) return "Chaque page doit avoir un titre.";
    // Segment d'URL simple (jamais de « / » ni de « .. ») : la page devient /<slug>/ au build
    if (typeof page.slug !== 'string' || page.slug.length > 200 || !PAGE_SLUG_RE.test(page.slug)) {
      return `Adresse de page invalide : ${JSON.stringify(page.slug)}.`;
    }
    if (page.layout !== undefined && !Array.isArray(page.layout)) return "Le contenu d'une page (layout) doit être une liste de sections.";
    const key = pageKey(page.slug, page.locale);
    if (keys.has(key)) return `Page en double : ${page.slug}.`;
    keys.add(key);
    if (findDangerousUrl(page.layout)) return "Lien non autorisé dans le contenu (javascript:, vbscript: ou data:text/html).";
  }
  // Pages supprimées dans l'éditeur : [{ slug, locale? }]
  if (body.deleted !== undefined) {
    if (!Array.isArray(body.deleted) || body.deleted.length > MAX_DELETED_PAGES) return "Liste de pages supprimées invalide.";
    for (const ref of body.deleted) {
      if (!ref || typeof ref.slug !== 'string' || ref.slug.length > 200 || !PAGE_SLUG_RE.test(ref.slug)) {
        return "Liste de pages supprimées invalide.";
      }
    }
  }
  return null;
}

// Une page par clé (langue, slug) : des doublons en base (sauvegardes concurrentes,
// création dans l'admin Payload…) ne doivent jamais bloquer l'éditeur. On garde la plus
// récemment modifiée ; les autres sont renvoyées pour suppression.
function splitDuplicatePages(docs) {
  const kept = new Map();
  const duplicates = [];
  const newer = (a, b) => {
    const byDate = String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
    return byDate !== 0 ? byDate > 0 : String(a.id) > String(b.id);
  };
  for (const doc of docs) {
    const key = pageKey(doc.slug, doc.locale);
    const current = kept.get(key);
    if (!current) kept.set(key, doc);
    else if (newer(doc, current)) { duplicates.push(current); kept.set(key, doc); }
    else duplicates.push(doc);
  }
  return { kept, duplicates };
}

// Première occurrence de chaque clé (fichier JSON : onboarding, import, ancien format).
function dedupePageDocs(docs) {
  const seen = new Set();
  return docs.filter((p) => {
    if (!p || typeof p !== 'object') return false;
    const key = pageKey(p.slug, p.locale);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Enregistre les pages d'un site. Payload : upsert par (site, slug, langue), puis
// suppression des pages listées dans body.deleted (absentes du corps) et des doublons.
// Une page simplement absente du corps est conservée : elle a pu être créée depuis un
// autre onglet ou par un autre utilisateur. Une erreur de base est propagée (l'appelant
// répond 500, rien n'est perdu en silence). Miroir JSON des pages reçues ensuite.
async function saveSitePages(siteSlug, body) {
  const docs = body.docs;
  const sentKeys = new Set(docs.map((p) => pageKey(p.slug, p.locale)));
  const deletedKeys = new Set((body.deleted || []).map((ref) => pageKey(ref.slug, ref.locale)).filter((k) => !sentKeys.has(k)));

  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);
    const existingRes = await payloadInstance.find({
      collection: 'pages',
      where: { site: { equals: siteDoc.id } },
      pagination: false,
      depth: 0,
      overrideAccess: true
    });
    const { kept: existingByKey, duplicates } = splitDuplicatePages(existingRes.docs);

    for (const pageInput of docs) {
      const pageLocale = pageInput.locale === 'en' ? 'en' : 'fr';
      const pageData = {
        title: pageInput.title,
        slug: pageInput.slug,
        locale: pageLocale,
        metaTitle: pageInput.metaTitle || null,
        metaDescription: pageInput.metaDescription || null,
        site: siteDoc.id,
        layout: pageInput.layout ? pageInput.layout.map(block => {
          const { blockType, id, ...fields } = block;
          if (blockType === 'gallery' && fields.images) {
            fields.images = fields.images.map(img => typeof img === 'string' ? { url: img } : img);
          }
          return {
            blockType: blockType,
            ...fields
          };
        }) : []
      };

      const existing = existingByKey.get(pageKey(pageInput.slug, pageLocale));
      if (existing) {
        await payloadInstance.update({ collection: 'pages', id: existing.id, data: pageData });
      } else {
        await payloadInstance.create({ collection: 'pages', data: pageData });
      }
    }

    // Pages supprimées dans le CMS (sinon elles réapparaîtraient) et doublons
    const toDelete = [...duplicates, ...[...existingByKey].filter(([key]) => deletedKeys.has(key)).map(([, page]) => page)];
    for (const page of toDelete) {
      await payloadInstance.delete({ collection: 'pages', id: page.id, overrideAccess: true });
    }
    writeJsonFile(getSitePagesFile(siteSlug), { docs });
    return;
  }

  // Mode sans base : même règle sur le fichier JSON (pages absentes conservées)
  let previous = [];
  try {
    const data = readJsonStrict(getSitePagesFile(siteSlug), null);
    previous = data && Array.isArray(data.docs) ? data.docs : [];
  } catch { previous = []; }
  const keptPrevious = dedupePageDocs(previous).filter((p) => {
    const key = pageKey(p.slug, p.locale);
    return !sentKeys.has(key) && !deletedKeys.has(key);
  });
  writeJsonFile(getSitePagesFile(siteSlug), { docs: [...docs, ...keptPrevious] });
}

// --- Blog / actualités : articles par site ---

function normalizePost(p) {
  return {
    title: p.title || '',
    slug: p.slug || '',
    excerpt: p.excerpt || '',
    coverImage: p.coverImage || '',
    body: p.body || '',
    tags: p.tags || '',
    publishedAt: p.publishedAt || null,
    status: p.status === 'published' ? 'published' : 'draft',
  };
}

// Fichier JSON des articles, non normalisés. Deux origines : un miroir de la base
// (mirror=true, écrit après chaque modification) ou des articles qui n'existent encore que
// dans le fichier (import, duplication, mode sans base). Un fichier illisible lève une
// erreur : il n'est jamais réécrit comme s'il était vide.
function readPostsFileData(siteSlug) {
  const data = readJsonStrict(getSitePostsFile(siteSlug), null);
  return {
    docs: data && Array.isArray(data.docs) ? data.docs : [],
    mirror: Boolean(data && data.source === 'payload'),
  };
}

function readPostsFile(siteSlug) {
  return readPostsFileData(siteSlug).docs;
}

function writePostsFile(siteSlug, docs, { mirror = false } = {}) {
  writeJsonAtomic(getSitePostsFile(siteSlug), mirror ? { source: 'payload', docs } : { docs });
}

// Plus récents d'abord ; articles sans date en dernier (même ordre qu'en base).
function sortPostsByDate(docs) {
  return [...docs].sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
}

// Articles d'un site en base (normalisés), ou null si Payload est indisponible ou si le
// site n'y est pas référencé.
async function readPayloadPosts(payloadInstance, siteSlug) {
  const siteId = await findPayloadSiteId(payloadInstance, siteSlug);
  if (!siteId) return null;
  const postsRes = await payloadInstance.find({
    collection: 'posts', where: { site: { equals: siteId } }, sort: '-publishedAt', limit: 500, overrideAccess: true,
  });
  return postsRes.docs.map(normalizePost);
}

// Le fichier JSON contient-il des articles pas encore repris en base ? (jamais un miroir :
// un article supprimé ou dépublié dans l'admin Payload ne doit pas revenir par ce biais)
function hasUnadoptedJsonPosts(siteSlug) {
  try {
    const { docs, mirror } = readPostsFileData(siteSlug);
    return !mirror && docs.length > 0;
  } catch {
    return false;
  }
}

// Lit les articles d'un site. La base fait foi dès que le site y est référencé ; repli
// sur le fichier JSON si la base est indisponible, si le site n'y est pas, ou si ses
// articles n'existent encore que dans le fichier (site importé ou dupliqué).
// publishedOnly=true → uniquement les articles publiés (pour le build public).
async function readSitePosts(siteSlug, { publishedOnly = false } = {}) {
  const published = (docs) => (publishedOnly ? docs.filter((p) => p.status === 'published') : docs);
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    try {
      const fromDb = await readPayloadPosts(payloadInstance, siteSlug);
      if (fromDb && (fromDb.length > 0 || !hasUnadoptedJsonPosts(siteSlug))) return { docs: published(fromDb) };
    } catch (dbError) {
      console.error('Erreur lecture posts de Payload, fallback JSON :', dbError.message);
    }
  }
  let docs;
  try { docs = sortPostsByDate(readPostsFile(siteSlug).map(normalizePost)); } catch { docs = []; }
  return { docs: published(docs) };
}

// Écrit le fichier JSON miroir depuis la base (repli si la base devient indisponible).
async function writePostsMirror(siteSlug) {
  try {
    const payloadInstance = getPayloadInstance();
    if (!payloadInstance) return;
    writePostsFile(siteSlug, (await readPayloadPosts(payloadInstance, siteSlug)) || [], { mirror: true });
  } catch (e) {
    console.error('Miroir JSON des articles non écrit :', e.message);
  }
}

// Avant la première écriture en base d'un site dont les articles ne vivent encore que
// dans le fichier JSON (import, duplication, passage du mode sans base au mode Payload),
// on les reprend en base : sinon ils disparaîtraient au premier enregistrement. Un miroir
// n'est jamais repris (base vidée volontairement depuis l'admin Payload).
async function adoptJsonPosts(payloadInstance, siteDoc, siteSlug) {
  const existing = await payloadInstance.find({
    collection: 'posts', where: { site: { equals: siteDoc.id } }, limit: 1, depth: 0, overrideAccess: true,
  });
  if (existing.docs.length > 0) return;
  let jsonPosts = [];
  try {
    const data = readPostsFileData(siteSlug);
    if (data.mirror) return;
    jsonPosts = data.docs;
  } catch (e) {
    console.error(`Articles JSON de ${siteSlug} illisibles, non repris en base :`, e.message);
  }
  for (const post of jsonPosts.map(normalizePost).filter((p) => p.slug && p.title)) {
    await payloadInstance.create({ collection: 'posts', data: { ...post, site: siteDoc.id }, overrideAccess: true });
  }
}

// Crée ou met à jour un article (identifié par son slug au sein du site).
async function upsertPost(siteSlug, post) {
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);
    await adoptJsonPosts(payloadInstance, siteDoc, siteSlug);
    const existing = await payloadInstance.find({
      collection: 'posts',
      where: { and: [{ site: { equals: siteDoc.id } }, { slug: { equals: post.slug } }] },
      limit: 1, overrideAccess: true,
    });
    const data = { ...post, site: siteDoc.id };
    if (existing.docs.length > 0) {
      await payloadInstance.update({ collection: 'posts', id: existing.docs[0].id, data, overrideAccess: true });
    } else {
      await payloadInstance.create({ collection: 'posts', data, overrideAccess: true });
    }
    await writePostsMirror(siteSlug);
    return;
  }
  // Mode sans base : upsert directement dans le fichier JSON
  const docs = readPostsFile(siteSlug);
  const idx = docs.findIndex((p) => p.slug === post.slug);
  if (idx >= 0) docs[idx] = post; else docs.push(post);
  writePostsFile(siteSlug, docs);
}

// Supprime un article par slug (sans erreur s'il n'existe pas).
async function deletePost(siteSlug, postSlug) {
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);
    await adoptJsonPosts(payloadInstance, siteDoc, siteSlug);
    const existing = await payloadInstance.find({
      collection: 'posts',
      where: { and: [{ site: { equals: siteDoc.id } }, { slug: { equals: postSlug } }] },
      limit: 1, overrideAccess: true,
    });
    if (existing.docs.length > 0) {
      await payloadInstance.delete({ collection: 'posts', id: existing.docs[0].id, overrideAccess: true });
    }
    await writePostsMirror(siteSlug);
    return;
  }
  writePostsFile(siteSlug, readPostsFile(siteSlug).filter((p) => p.slug !== postSlug));
}

// --- Thème ---

// Thème d'un site : Payload d'abord, sinon fichier JSON, sinon thème par défaut.
async function readSiteTheme(siteSlug) {
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    try {
      const siteRes = await payloadInstance.find({
        collection: 'payload_sites',
        where: { slug: { equals: siteSlug } },
        limit: 1
      });
      if (siteRes.docs.length > 0) {
        const siteId = siteRes.docs[0].id;
        const themeRes = await payloadInstance.find({
          collection: 'themes',
          where: { site: { equals: siteId } },
          limit: 1
        });
        if (themeRes.docs.length > 0) {
          const t = themeRes.docs[0];
          return {
            theme: {
              colors: t.colors,
              fonts: t.fonts,
              radius: t.radius
            }
          };
        }
      }
    } catch (dbError) {
      console.error("Erreur lecture theme de Payload, fallback JSON:", dbError.message);
    }
  }

  const siteThemeFile = getSiteThemeFile(siteSlug);
  if (!fs.existsSync(siteThemeFile)) {
    return DEFAULT_THEME;
  }
  try {
    return JSON.parse(fs.readFileSync(siteThemeFile, 'utf-8'));
  } catch (e) {
    console.error(`Fichier de thème corrompu pour ${siteSlug}, fallback par défaut :`, e.message);
    return DEFAULT_THEME;
  }
}

// Enregistre un thème DÉJÀ validé : Payload (best-effort) puis fichier JSON.
// NOTE : on n'écrit PAS theme.css ici. Ce fichier est global au template Astro ;
// l'écrire hors build créait une race multi-tenant (le build d'un site A pouvait
// embarquer le thème d'un site B). Le build le régénère depuis siteThemeFile.
async function saveSiteTheme(siteSlug, themeData) {
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    try {
      const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);

      const themeRes = await payloadInstance.find({
        collection: 'themes',
        where: { site: { equals: siteDoc.id } },
        limit: 1
      });

      const tInput = themeData.theme;
      const themePayloadData = {
        site: siteDoc.id,
        colors: tInput.colors,
        fonts: tInput.fonts,
        radius: tInput.radius
      };

      if (themeRes.docs.length > 0) {
        await payloadInstance.update({
          collection: 'themes',
          id: themeRes.docs[0].id,
          data: themePayloadData
        });
      } else {
        await payloadInstance.create({
          collection: 'themes',
          data: themePayloadData
        });
      }
    } catch (dbError) {
      console.error("Erreur écriture theme dans Payload:", dbError.message);
    }
  }

  writeJsonFile(getSiteThemeFile(siteSlug), themeData);
}

module.exports = {
  SEED_SITE_SLUG,
  readJsonFile,
  writeJsonFile,
  isUsableJsonFile,
  seedDefaultData,
  writeThemeCss,
  applySiteThemeCss,
  findPayloadSiteId,
  readSitePages,
  validatePagesBody,
  findDangerousUrl,
  saveSitePages,
  normalizePost,
  readPostsFile,
  writePostsFile,
  readSitePosts,
  writePostsMirror,
  upsertPost,
  deletePost,
  readSiteTheme,
  saveSiteTheme,
};
