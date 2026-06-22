const { buildConfig } = require('payload/config');
const { webpackBundler } = require('@payloadcms/bundler-webpack');
const { slateEditor } = require('@payloadcms/richtext-slate');
const path = require('path');

// Database adapter selection
let dbAdapter;
const dbUri = process.env.DATABASE_URI || '';

if (dbUri.startsWith('mongodb')) {
  const { mongooseAdapter } = require('@payloadcms/db-mongodb');
  dbAdapter = mongooseAdapter({
    url: dbUri,
  });
} else {
  try {
    const { postgresAdapter } = require('@payloadcms/db-postgres');
    dbAdapter = postgresAdapter({
      client: {
        connectionString: dbUri || 'postgresql://127.0.0.1:5432/metabuilder',
      },
    });
  } catch (err) {
    console.warn("⚠️ Le module @payloadcms/db-postgres n'est pas disponible. Tentative avec @payloadcms/db-mongodb...");
    try {
      const { mongooseAdapter } = require('@payloadcms/db-mongodb');
      dbAdapter = mongooseAdapter({
        url: dbUri || 'mongodb://127.0.0.1:27017/metabuilder',
      });
    } catch (mongoErr) {
      console.error("❌ Aucun adaptateur de base de données Payload n'a pu être chargé.");
      throw new Error("Veuillez installer @payloadcms/db-postgres ou @payloadcms/db-mongodb.");
    }
  }
}

module.exports = buildConfig({
  admin: {
    bundler: webpackBundler(),
  },
  editor: slateEditor({}),
  db: dbAdapter,
  collections: [
    {
      slug: 'users',
      auth: true,
      admin: {
        useAsTitle: 'email',
      },
      fields: [],
    },
    {
      slug: 'sites',
      admin: {
        useAsTitle: 'name',
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
        },
        {
          name: 'slug',
          type: 'text',
          unique: true,
          required: true,
        },
        {
          name: 'domain',
          type: 'text',
        },
        {
          name: 'documentRoot',
          type: 'text',
        },
        {
          name: 'repositoryPath',
          type: 'text',
        },
        {
          name: 'stack',
          type: 'text',
        },
      ],
    },
    {
      slug: 'pages',
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
        },
        {
          name: 'slug',
          type: 'text',
          required: true,
        },
        {
          name: 'site',
          type: 'relationship',
          relationTo: 'sites',
          required: true,
        },
        {
          name: 'layout',
          type: 'blocks',
          blocks: [
            {
              slug: 'hero',
              fields: [
                { name: 'title', type: 'text' },
                { name: 'subtitle', type: 'text' },
                { name: 'ctaText', type: 'text' },
                { name: 'backgroundImage', type: 'text' },
              ],
            },
            {
              slug: 'features',
              fields: [
                { name: 'title', type: 'text' },
                {
                  name: 'items',
                  type: 'array',
                  fields: [
                    { name: 'title', type: 'text' },
                    { name: 'description', type: 'textarea' },
                  ],
                },
              ],
            },
            {
              slug: 'product-grid',
              fields: [
                { name: 'title', type: 'text' },
                {
                  name: 'products',
                  type: 'array',
                  fields: [
                    { name: 'name', type: 'text' },
                    { name: 'price', type: 'text' },
                    { name: 'image', type: 'text' },
                  ],
                },
              ],
            },
            {
              slug: 'gallery',
              fields: [
                { name: 'title', type: 'text' },
                {
                  name: 'images',
                  type: 'array',
                  fields: [
                    { name: 'url', type: 'text' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      slug: 'themes',
      fields: [
        {
          name: 'site',
          type: 'relationship',
          relationTo: 'sites',
          required: true,
          unique: true,
        },
        {
          name: 'colors',
          type: 'group',
          fields: [
            { name: 'primary', type: 'text' },
            { name: 'secondary', type: 'text' },
            { name: 'background', type: 'text' },
            { name: 'text', type: 'text' },
          ],
        },
        {
          name: 'fonts',
          type: 'group',
          fields: [
            { name: 'heading', type: 'text' },
            { name: 'body', type: 'text' },
          ],
        },
        {
          name: 'radius',
          type: 'text',
        },
      ],
    },
  ],
  typescript: {
    outputFile: path.resolve(__dirname, 'payload-types.ts'),
  },
});
