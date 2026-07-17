import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { fileURLToPath } from 'url'
import { Access } from 'payload'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.DATABASE_URI) {
  throw new Error('DATABASE_URI manquante : Payload CMS ne peut pas démarrer sans base de données.')
}
if (!process.env.PAYLOAD_SECRET || process.env.PAYLOAD_SECRET.length < 16) {
  throw new Error('PAYLOAD_SECRET manquant ou trop court (16 caractères minimum) : définissez-le dans le fichier .env.')
}

const dbUri = process.env.DATABASE_URI

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

// Un admin accède à tous les comptes, un client uniquement au sien
const isAdminOrSelf: Access = ({ req: { user } }) => {
  if (!user) return false
  if (user.roles && user.roles.includes('admin')) return true
  return {
    id: {
      equals: user.id,
    },
  }
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

const frontendOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET,
  cors: frontendOrigins,
  csrf: frontendOrigins,
  editor: lexicalEditor({}),
  db: postgresAdapter({
    pool: {
      connectionString: dbUri,
    },
    // push actif en dev : le schéma est synchronisé automatiquement (aucune migration versionnée dans ce repo)
  }),
  collections: [
    {
      slug: 'users',
      auth: true,
      admin: {
        useAsTitle: 'email',
      },
      access: {
        // Bloque l'entrée du panel /admin aux non-admins
        admin: isAdmin,
        create: isAdmin,
        delete: isAdmin,
        read: isAdminOrSelf,
        update: isAdminOrSelf,
      },
      hooks: {
        beforeChange: [
          // Empêche un client de s'auto-promouvoir, de s'attribuer des sites ou de modifier
          // son quota IA : seuls les admins (ou les appels système sans user) le peuvent.
          ({ req, data, originalDoc, operation }) => {
            const user = req?.user as any
            if (operation === 'update' && user && !(user.roles || []).includes('admin')) {
              if (data.roles !== undefined) data.roles = originalDoc?.roles
              if (data.sites !== undefined) data.sites = originalDoc?.sites
              if (data.aiDailyQuota !== undefined) data.aiDailyQuota = originalDoc?.aiDailyQuota
            }
            return data
          },
        ],
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
        },
        {
          name: 'aiDailyQuota',
          type: 'number',
          min: 0,
          admin: {
            description: "Quota IA journalier personnalisé pour ce compte. Vide = valeur AI_DAILY_QUOTA du serveur (défaut 10). 0 = générations bloquées."
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
        {
          name: 'status',
          type: 'select',
          options: [
            { label: 'Brouillon', value: 'draft' },
            { label: 'Actif (déployé)', value: 'active' },
            { label: 'Erreur de build', value: 'error' },
          ],
          defaultValue: 'draft',
          required: true,
        },
        {
          name: 'sslStatus',
          type: 'text',
          defaultValue: 'active',
        },
        {
          name: 'createdWithTool',
          type: 'checkbox',
          defaultValue: false,
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
