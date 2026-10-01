// Contenu des sites : pages, articles et thème. Payload est la source de vérité ; les
// fichiers JSON de data/ servent de repli (mode sans base) et de miroir.
const fs = require('fs');
const path = require('path');
const { validateTheme } = require('../lib/theme');
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
const { DEFAULT_PAGES, DEFAULT_THEME } = require('./defaults');

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

// Applique au template le thème enregistré d'un site avant une compilation.
function applySiteThemeCss(siteSlug) {
  const siteThemeFile = getSiteThemeFile(siteSlug);
  if (!fs.existsSync(siteThemeFile)) return;
  try {
    writeThemeCss(JSON.parse(fs.readFileSync(siteThemeFile, 'utf-8')));
  } catch (e) {
    console.error("Erreur lors de l'application du thème pour le build", e);
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
          overrideAccess: true
        });
        if (pagesRes.docs.length > 0) {
          return {
            docs: pagesRes.docs.map(page => ({
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
  if (!fs.existsSync(sitePagesFile)) {
    return DEFAULT_PAGES;
  }
  try {
    return JSON.parse(fs.readFileSync(sitePagesFile, 'utf-8'));
  } catch (e) {
    console.error(`Fichier de pages corrompu pour ${siteSlug}, fallback par défaut :`, e.message);
    return DEFAULT_PAGES;
  }
}

// Enregistre les pages d'un site (upsert par site + slug + langue dans Payload, puis
// miroir JSON du corps reçu).
async function saveSitePages(siteSlug, body) {
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    try {
      const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);

      if (body.docs && Array.isArray(body.docs)) {
        for (const pageInput of body.docs) {
          // Une page est identifiée par (site, slug, langue) : deux langues peuvent
          // partager le même slug (« home » en fr et en en).
          const pageLocale = pageInput.locale === 'en' ? 'en' : 'fr';
          const pageRes = await payloadInstance.find({
            collection: 'pages',
            where: {
              and: [
                { site: { equals: siteDoc.id } },
                { slug: { equals: pageInput.slug } },
                { locale: { equals: pageLocale } }
              ]
            },
            limit: 1
          });

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

          if (pageRes.docs.length > 0) {
            await payloadInstance.update({
              collection: 'pages',
              id: pageRes.docs[0].id,
              data: pageData
            });
          } else {
            await payloadInstance.create({
              collection: 'pages',
              data: pageData
            });
          }
        }
      }
    } catch (dbError) {
      console.error("Erreur écriture pages dans Payload:", dbError.message);
    }
  }

  writeJsonFile(getSitePagesFile(siteSlug), body);
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

// Articles du fichier JSON (repli hors base de données), non normalisés.
function readPostsFile(siteSlug) {
  const data = readJsonFile(getSitePostsFile(siteSlug), null);
  return data && Array.isArray(data.docs) ? data.docs : [];
}

function writePostsFile(siteSlug, docs) {
  writeJsonFile(getSitePostsFile(siteSlug), { docs });
}

// Lit les articles d'un site. Payload prioritaire ; repli sur le fichier JSON.
// publishedOnly=true → uniquement les articles publiés (pour le build public).
async function readSitePosts(siteSlug, { publishedOnly = false } = {}) {
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    try {
      const siteId = await findPayloadSiteId(payloadInstance, siteSlug);
      if (siteId) {
        const where = { and: [{ site: { equals: siteId } }] };
        if (publishedOnly) where.and.push({ status: { equals: 'published' } });
        const postsRes = await payloadInstance.find({
          collection: 'posts', where, sort: '-publishedAt', limit: 500, overrideAccess: true,
        });
        return { docs: postsRes.docs.map(normalizePost) };
      }
    } catch (dbError) {
      console.error('Erreur lecture posts de Payload, fallback JSON :', dbError.message);
    }
  }
  let docs;
  try { docs = readPostsFile(siteSlug).map(normalizePost); } catch { docs = []; }
  if (publishedOnly) docs = docs.filter((p) => p.status === 'published');
  return { docs };
}

// Écrit le fichier JSON miroir depuis la liste courante (repli hors base de données).
async function writePostsMirror(siteSlug) {
  try {
    const { docs } = await readSitePosts(siteSlug);
    writePostsFile(siteSlug, docs);
  } catch (e) {
    console.error('Miroir JSON des articles non écrit :', e.message);
  }
}

// Crée ou met à jour un article (identifié par son slug au sein du site).
async function upsertPost(siteSlug, post) {
  const payloadInstance = getPayloadInstance();
  if (payloadInstance) {
    const siteDoc = await sitesStore.getOrCreatePayloadDoc(siteSlug);
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
  saveSitePages,
  normalizePost,
  readSitePosts,
  writePostsMirror,
  upsertPost,
  deletePost,
  readSiteTheme,
  saveSiteTheme,
};
