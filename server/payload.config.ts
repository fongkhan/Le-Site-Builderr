import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { fileURLToPath } from 'url'
import { Access } from 'payload'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const dbUri = process.env.DATABASE_URI || 'postgresql://postgres:postgrespassword@127.0.0.1:5438/metabuilder_db'

// Access Control Helpers
const isAdmin = ({ req: { user } }: any) => {
  return Boolean(user && user.roles && user.roles.includes('admin'))
}

const isAdminOrSiteClient: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.roles && user.roles.includes('admin')) return true
  if (user.sites && user.sites.length > 0) {
    const siteIds = user.sites.map((s: any) => typeof s === 'object' && s !== null ? s.id : s)
    return {
      site: {
        in: siteIds,
      },
    }
  }
  return false
}

const isAdminOrOwnSite: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.roles && user.roles.includes('admin')) return true
  if (user.sites && user.sites.length > 0) {
    const siteIds = user.sites.map((s: any) => typeof s === 'object' && s !== null ? s.id : s)
    return {
      id: {
        in: siteIds,
      },
    }
  }
  return false
}

const canCreatePage: Access = ({ req: { user, data } }: any) => {
  if (!user) return false
  if (user.roles && user.roles.includes('admin')) return true
  if (user.sites && user.sites.length > 0 && data && data.site) {
    const siteIds = user.sites.map((s: any) => typeof s === 'object' && s !== null ? s.id : s)
    return siteIds.includes(Number(data.site))
  }
  return false
}

const canCreateTheme: Access = ({ req: { user, data } }: any) => {
  if (!user) return false
  if (user.roles && user.roles.includes('admin')) return true
  if (user.sites && user.sites.length > 0 && data && data.site) {
    const siteIds = user.sites.map((s: any) => typeof s === 'object' && s !== null ? s.id : s)
    return siteIds.includes(Number(data.site))
  }
  return false
}

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || 'fallback-secret-payload-key-12345678',
  editor: lexicalEditor({}),
  db: postgresAdapter({
    pool: {
      connectionString: dbUri,
    },
    push: false,
  }),
  collections: [
    {
      slug: 'users',
      auth: true,
      admin: {
        useAsTitle: 'email',
      },
      fields: [
        {
          name: 'roles',
          type: 'select',
          hasMany: true,
          options: [
            { label: 'Super Admin', value: 'admin' },
            { label: 'Client', value: 'client' },
          ],
          defaultValue: ['client'],
          required: true,
        },
        {
          name: 'sites',
          type: 'relationship',
          relationTo: 'payload_sites',
          hasMany: true,
          admin: {
            description: 'Sites auxquels le client a accès. Laisser vide pour un Super Admin.'
          }
        }
      ],
    },
    {
      slug: 'payload_sites',
      admin: {
        useAsTitle: 'name',
      },
      access: {
        read: isAdminOrOwnSite,
        update: isAdminOrOwnSite,
        create: isAdmin,
        delete: isAdmin,
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
      access: {
        read: isAdminOrSiteClient,
        create: canCreatePage,
        update: isAdminOrSiteClient,
        delete: isAdminOrSiteClient,
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
      access: {
        read: isAdminOrSiteClient,
        create: canCreateTheme,
        update: isAdminOrSiteClient,
        delete: isAdminOrSiteClient,
      },
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
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
