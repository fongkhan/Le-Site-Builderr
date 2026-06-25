const { buildConfig } = require('payload/config');
const { webpackBundler } = require('@payloadcms/bundler-webpack');
const { slateEditor } = require('@payloadcms/richtext-slate');
const { postgresAdapter } = require('@payloadcms/db-postgres');
const path = require('path');

const dbUri = process.env.DATABASE_URI || 'postgresql://postgres:postgrespassword@127.0.0.1:5438/metabuilder_db';

module.exports = buildConfig({
  admin: {
    bundler: webpackBundler(),
  },
  editor: slateEditor({}),
  db: postgresAdapter({
    pool: {
      connectionString: dbUri,
    },
  }),
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
      slug: 'payload_sites',
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
          relationTo: 'payload_sites',
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
            {
              slug: 'testimonials',
              fields: [
                { name: 'title', type: 'text' },
                {
                  name: 'testimonials',
                  type: 'array',
                  fields: [
                    { name: 'quote', type: 'textarea' },
                    { name: 'author', type: 'text' },
                    { name: 'role', type: 'text' },
                    { name: 'avatar', type: 'text' },
                  ],
                },
              ],
            },
            {
              slug: 'faq',
              fields: [
                { name: 'title', type: 'text' },
                {
                  name: 'items',
                  type: 'array',
                  fields: [
                    { name: 'question', type: 'text' },
                    { name: 'answer', type: 'textarea' },
                  ],
                },
              ],
            },
            {
              slug: 'pricing',
              fields: [
                { name: 'title', type: 'text' },
                {
                  name: 'plans',
                  type: 'array',
                  fields: [
                    { name: 'name', type: 'text' },
                    { name: 'price', type: 'text' },
                    { name: 'description', type: 'text' },
                    {
                      name: 'features',
                      type: 'array',
                      fields: [
                        { name: 'feature', type: 'text' },
                      ],
                    },
                    { name: 'ctaText', type: 'text' },
                    { name: 'isPopular', type: 'checkbox' },
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
          relationTo: 'payload_sites',
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
