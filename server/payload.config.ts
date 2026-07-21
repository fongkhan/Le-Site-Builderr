import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
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

// Lien de réinitialisation pointant vers le front (première origine configurée)
const resetPasswordUrl = (token: string) => `${frontendOrigins[0]}/reset-password?token=${token}`

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET,
  cors: frontendOrigins,
  csrf: frontendOrigins,
  // Sans SMTP_HOST, Payload écrit les emails dans la console (mode développement)
  ...(process.env.SMTP_HOST
    ? {
        email: nodemailerAdapter({
          defaultFromAddress: process.env.EMAIL_FROM || 'noreply@localhost',
          defaultFromName: 'MetaSite Builder',
          transportOptions: {
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: Number(process.env.SMTP_PORT || 587) === 465,
            auth: process.env.SMTP_USER
              ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
              : undefined,
          },
        }),
      }
    : {}),
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
      auth: {
        forgotPassword: {
          generateEmailSubject: () => 'Réinitialisation de votre mot de passe — MetaSite Builder',
          generateEmailHTML: (args) => {
            const url = resetPasswordUrl(args?.token || '')
            if (!process.env.SMTP_HOST) {
              // Mode dev sans SMTP : Payload ne logue que le sujet — on affiche le lien ici
              console.log(`🔑 [Dev] Lien de réinitialisation pour ${(args?.user as any)?.email} : ${url}`)
            }
            return `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                <h2>Réinitialisation de votre mot de passe</h2>
                <p>Une demande de réinitialisation a été faite pour votre compte MetaSite Builder.</p>
                <p>
                  <a href="${url}" style="display:inline-block;background:#6366f1;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
                    Choisir un nouveau mot de passe
                  </a>
                </p>
                <p style="color:#6b7280;font-size:13px;">Ce lien expire dans 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
                <p style="color:#6b7280;font-size:13px;">Lien direct : ${url}</p>
              </div>
            `
          },
        },
      },
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
          // SEO : balise <title> de la page (repli sur title si vide)
          name: 'metaTitle',
          type: 'text',
        },
        {
          // SEO : <meta name="description">
          name: 'metaDescription',
          type: 'textarea',
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
    {
      // Historique des builds/déploiements. Écrit uniquement par le serveur
      // (overrideAccess) ; lecture panel réservée aux admins — les clients y
      // accèdent via l'endpoint Express /api/sites/:slug/builds (ownership vérifié).
      slug: 'builds',
      admin: {
        useAsTitle: 'id',
        defaultColumns: ['site', 'status', 'durationMs', 'triggeredBy', 'createdAt'],
      },
      access: {
        read: isAdmin,
        create: () => false,
        update: () => false,
        delete: isAdmin,
      },
      fields: [
        {
          name: 'site',
          type: 'relationship',
          relationTo: 'payload_sites',
          required: true,
          index: true,
        },
        {
          name: 'status',
          type: 'select',
          options: [
            { label: 'Succès', value: 'success' },
            { label: 'Erreur', value: 'error' },
          ],
          required: true,
        },
        { name: 'durationMs', type: 'number' },
        { name: 'triggeredBy', type: 'text' },
        { name: 'logExcerpt', type: 'textarea' },
      ],
    },
  ],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
