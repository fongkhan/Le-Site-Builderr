import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { Access, Plugin } from 'payload'
// Thème : logo validé comme par POST /api/theme (module CommonJS, import par défaut)
import themeLib from './lib/theme.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.DATABASE_URI) {
  throw new Error('DATABASE_URI manquante : Payload CMS ne peut pas démarrer sans base de données.')
}
if (!process.env.PAYLOAD_SECRET || process.env.PAYLOAD_SECRET.length < 16) {
  throw new Error('PAYLOAD_SECRET manquant ou trop court (16 caractères minimum) : définissez-le dans le fichier .env.')
}

const dbUri = process.env.DATABASE_URI

// Médiathèque : taille maximale d'un fichier téléversé (Mo, défaut 8).
const MEDIA_MAX_MB = Number.parseInt(process.env.MEDIA_MAX_MB ?? '', 10) || 8

// sharp (redimensionnement des images) est optionnel : sans lui, les fichiers sont
// conservés tels quels.
let sharp: any = null
try {
  sharp = createRequire(import.meta.url)('sharp')
} catch {
  console.warn('⚠️ [Médias] sharp indisponible : les images téléversées ne seront pas redimensionnées.')
}

// Access Control Helpers
const userIsAdmin = (user: any) => Boolean(user && user.roles && user.roles.includes('admin'))

// Identifiants des sites rattachés à un compte (relation peuplée ou non)
const siteIdsOf = (user: any): Array<string | number> =>
  (user?.sites || []).map((s: any) => (typeof s === 'object' && s !== null ? s.id : s))

const isAdmin = ({ req: { user } }: any) => userIsAdmin(user)

const isAdminOrSiteClient: Access = ({ req: { user } }) => {
  if (!user) return false
  if (userIsAdmin(user)) return true
  const siteIds = siteIdsOf(user)
  return siteIds.length > 0 ? { site: { in: siteIds } } : false
}

const isAdminOrOwnSite: Access = ({ req: { user } }) => {
  if (!user) return false
  if (userIsAdmin(user)) return true
  const siteIds = siteIdsOf(user)
  return siteIds.length > 0 ? { id: { in: siteIds } } : false
}

// Création d'un document rattaché à un site (page, article, thème, média) : admin, ou
// client propriétaire du site cible.
const canCreateForOwnSite: Access = ({ req: { user, data } }: any) => {
  if (!user) return false
  if (userIsAdmin(user)) return true
  if (!data || !data.site) return false
  return siteIdsOf(user).map(Number).includes(Number(data.site))
}

// Un admin accède à tous les comptes, un client uniquement au sien
const isAdminOrSelf: Access = ({ req: { user } }) => {
  if (!user) return false
  if (userIsAdmin(user)) return true
  return {
    id: {
      equals: user.id,
    },
  }
}

// Relation « site » d'un document de contenu. Seul un admin peut la modifier après
// création : sinon un client pourrait déplacer un de ses documents vers le site d'un
// autre client (injection de contenu chez un tiers).
const siteRelationField = (extra: Record<string, unknown> = {}): any => ({
  name: 'site',
  type: 'relationship',
  relationTo: 'payload_sites',
  required: true,
  access: { update: isAdmin },
  ...extra,
})

// Lien d'un bouton d'action (bannière, formule, produit). Les schémas exécutables
// (javascript:, vbscript:, data:text/html) sont refusés ici aussi : l'API REST de Payload
// n'accepte pas ce que le CMS refuse. Le reste (saisie en cours, page supprimée…) est
// toléré : le template ignore un lien invalide et revient au formulaire du site.
// Un validate personnalisé remplace celui du type text : ce dernier (longueur maximale…)
// est donc appelé ensuite. Module CommonJS du serveur : import par défaut (interop tsx et Next).
import urlSafety from './lib/url-safety.js'
import { validations } from 'payload'
const ctaLinkField = (): any => ({
  name: 'ctaLink',
  type: 'text',
  validate: (value: unknown, options: any) => {
    const safe = urlSafety.validateSafeUrl(value)
    return safe === true ? validations.text(value as any, options) : safe
  },
  admin: { description: 'Lien du bouton : vide = formulaire du site ; /page/, #contact, https://…, tel:… ou mailto:…' },
})

const frontendOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())

// Verrous de documents (posés par /admin à l'ouverture d'un document) : toute écriture
// passe outre, comme l'API locale des endpoints Express. Sans cela (défaut de l'API REST),
// Payload vérifie le verrou HORS de la transaction de l'écriture : une seconde connexion
// du pool réclamée pendant que la première est tenue. Dès une dizaine d'écritures REST
// simultanées, plus aucune ne se libère : tout le serveur se fige (un client connecté y
// suffit, PATCH /api/users/<son id>). Le verrou est levé dans la transaction. Appliqué à
// toutes les collections par un plugin.
const overrideDocumentLocks = ({ args, operation }: any) => {
  if (operation === 'update' || operation === 'delete') args.overrideLock = true
  return args
}
const documentLocksOverridden: Plugin = (config) => ({
  ...config,
  collections: (config.collections || []).map((c) => ({
    ...c,
    hooks: { ...c.hooks, beforeOperation: [overrideDocumentLocks, ...(c.hooks?.beforeOperation || [])] },
  })),
})

// Lien de réinitialisation pointant vers le front (première origine configurée)
const resetPasswordUrl = (token: string) => `${frontendOrigins[0]}/reset-password?token=${token}`

// --- Comptes : politique de mot de passe, sessions, login (collection users) ---
// Imports regroupés ici (hissés par ESM) pour isoler les modifications de la collection users.
// Modules CommonJS du serveur : import par défaut (interop tsx et Next).
import { ValidationError, Forbidden } from 'payload'
import passwordPolicy from './lib/password-policy.js'
import sessionOptions from './lib/session.js'
import accountGuards from './lib/account-guards.js'
import auditEvents from './lib/audit-events.js'

// Message unique pour tout échec de login (mauvais identifiants OU compte verrouillé) :
// ne révèle ni l'existence d'un compte ni son verrouillage.
const LOGIN_FAILED_MESSAGE = 'Email ou mot de passe incorrect, ou compte temporairement verrouillé.'

// Email servant à la politique de mot de passe : celui envoyé, sinon celui du compte visé.
async function passwordPolicyEmail({ args, operation, req }: any): Promise<string> {
  if (typeof args.data?.email === 'string') return args.data.email
  try {
    if (operation === 'update' && args.id !== undefined) {
      const doc = await req.payload.findByID({ collection: 'users', id: args.id, depth: 0, overrideAccess: true, req })
      return doc?.email || ''
    }
    if (operation === 'resetPassword' && typeof args.data?.token === 'string') {
      const doc = await req.payload.db.findOne({ collection: 'users', where: { resetPasswordToken: { equals: args.data.token } }, req })
      return doc?.email || ''
    }
  } catch {
    // compte introuvable : l'opération échouera ensuite d'elle-même
  }
  return ''
}

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET,
  cors: frontendOrigins,
  csrf: frontendOrigins,
  // GraphQL inutilisé (orchestrateur et panel passent par l'API REST) : désactivé pour
  // qu'aucune seconde porte d'entrée (login, création de compte…) n'échappe aux
  // limiteurs Express. La dépendance graphql reste installée (requise par @payloadcms/next).
  graphQL: { disable: true },
  // Avatar générique dans /admin : par défaut, Payload charge celui de gravatar.com (requête
  // vers un tiers qui expose le hachage MD5 de l'email du compte connecté).
  admin: { avatar: 'default' },
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
  // Téléversements : taille bornée (413 au-delà) et un seul fichier par requête. Les
  // fichiers en transit restent en MÉMOIRE (useTempFiles: false) : Payload analyse le
  // multipart AVANT le contrôle d'accès et n'efface ses fichiers temporaires qu'après une
  // création réussie, si bien qu'une requête refusée (même anonyme) laisserait un
  // fichier sur disque à chaque appel. Au plus MEDIA_MAX_MB en mémoire, libérés en fin
  // de requête.
  upload: {
    limits: { fileSize: MEDIA_MAX_MB * 1024 * 1024, files: 1 },
    abortOnLimit: true,
    responseOnLimit: `Image trop volumineuse (${MEDIA_MAX_MB} Mo maximum).`,
    useTempFiles: false,
  },
  ...(sharp ? { sharp } : {}),
  editor: lexicalEditor({}),
  db: postgresAdapter({
    pool: {
      connectionString: dbUri,
      // Filet de sécurité : sans connexion libre au bout de 30 s, la requête échoue (et sa
      // transaction est annulée) au lieu d'attendre indéfiniment ; un pool saturé ne fige
      // plus le serveur jusqu'au redémarrage.
      connectionTimeoutMillis: 30_000,
    },
    // Développement : schéma poussé automatiquement (push). Production : migrations
    // versionnées de ce dossier, appliquées au démarrage par core/payload.js (pas de
    // prodMigrations : sur une base de développement, Payload poserait une question
    // interactive et bloquerait le serveur).
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  collections: [
    {
      slug: 'users',
      auth: {
        // Cookie Secure en production (surchargeable par COOKIE_SECURE)
        cookies: sessionOptions.authCookieOptions(process.env),
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
        // Déverrouillage réservé aux admins. L'accès est vérifié avant la recherche du
        // compte : 403 identique que l'email existe ou non (pas d'énumération).
        unlock: isAdmin,
      },
      hooks: {
        beforeOperation: [
          // Tentative de login : email saisi mémorisé pour le journal d'audit (afterError),
          // quelle que soit la forme du chemin. Jamais le mot de passe.
          ({ args, operation, req }: any) => {
            if (operation === 'login' && req?.context) {
              req.context.loginAttempt = { email: typeof args?.data?.email === 'string' ? args.data.email : '' }
            }
            return args
          },
          // Aucune création de compte par HTTP sans être connecté, y compris
          // /api/users/first-register (premier compte admin sur une base vide) : les
          // comptes viennent d'un admin ou du seed (API locale, SEED_ADMIN_EMAIL).
          ({ args, operation, req }: any) => {
            if (accountGuards.isAnonymousHttpCreate({ operation, req })) throw new Forbidden(req.t)
            return args
          },
          // Politique de mot de passe sur les appels HTTP (REST, GraphQL). L'API locale
          // (seed de développement) n'est pas concernée.
          async ({ args, operation, req }: any) => {
            if (!['create', 'update', 'resetPassword'].includes(operation)) return args
            if (operation === 'resetPassword') req.context.resetPassword = true
            if (req.payloadAPI === 'local') return args
            const password = args.data?.password
            if (password === undefined || password === null || password === '') return args
            // Opération que le contrôle d'accès refusera de toute façon : on le laisse
            // répondre (403) sans rien révéler du compte visé.
            const user = req.user
            const admin = userIsAdmin(user)
            if (operation === 'create' && !admin) return args
            if (operation === 'update' && !admin) {
              if (!user || (args.id !== undefined && String(args.id) !== String(user.id))) return args
            }
            // Mise à jour groupée (sans id) par un client : seul son propre compte est visé
            const email = operation === 'update' && args.id === undefined && !admin && typeof args.data?.email !== 'string'
              ? user.email
              : await passwordPolicyEmail({ args, operation, req })
            const message = passwordPolicy.checkPassword(password, { email })
            if (message) {
              const err = new ValidationError({ collection: 'users', errors: [{ message, path: 'password' }] }, req.t)
              // Message principal en français (affiché tel quel par l'orchestrateur)
              err.message = message
              throw err
            }
            return args
          },
        ],
        beforeValidate: [
          // Réinitialisation du mot de passe : toutes les sessions existantes sont
          // révoquées (Payload ajoute ensuite la session de la réinitialisation).
          ({ data, req }: any) => {
            if (req?.context?.resetPassword && data) data.sessions = []
            return data
          },
        ],
        beforeChange: [
          // Changement de mot de passe : les autres sessions seront révoquées après écriture.
          // Marque par compte (mise à jour groupée : comptes traités en parallèle).
          ({ data, operation, context, originalDoc }: any) => {
            if (operation === 'update' && typeof data?.password === 'string' && data.password) {
              accountGuards.markPasswordChange(context, originalDoc?.id)
            }
            return data
          },
          // Empêche un client de s'auto-promouvoir, de s'attribuer des sites ou de modifier
          // son quota IA : seuls les admins (ou les appels système sans user) le peuvent.
          ({ req, data, originalDoc, operation }) => {
            const user = req?.user as any
            if (operation === 'update' && user && !(user.roles || []).includes('admin')) {
              if (data.roles !== undefined) data.roles = originalDoc?.roles
              if (data.sites !== undefined) data.sites = originalDoc?.sites
              if (data.aiDailyQuota !== undefined) data.aiDailyQuota = originalDoc?.aiDailyQuota
              if (data.plan !== undefined) data.plan = originalDoc?.plan
            }
            return data
          },
        ],
        afterChange: [
          // Journal d'audit des comptes (création ; modification d'email, rôles, offre,
          // quota IA, sites, mot de passe — jamais sa valeur). Les comptes passent par l'API
          // REST Payload, hors des endpoints Express, d'où le hook. DOIT rester EN PREMIER :
          // le hook suivant (révocation) retire la marque de mot de passe de ce compte (lue
          // ici de façon synchrone). L'update interne de forgot-password (jeton) ne produit
          // aucune entrée (diff vide). Écriture en arrière-plan : hook exécuté dans la
          // transaction.
          ({ req, doc, previousDoc, operation, context }: any) => {
            if (operation !== 'create' && operation !== 'update') return doc
            const payload = req?.payload
            const actor = auditEvents.auditActor(req)
            const passwordChanged = accountGuards.hasPasswordChange(context, doc?.id)
            // Champs audités copiés maintenant (jamais password, hash, jeton, sessions)
            const pick = (d: any) => ({ email: d?.email, roles: d?.roles, plan: d?.plan, aiDailyQuota: d?.aiDailyQuota, sites: d?.sites })
            const before = pick(previousDoc)
            const after = pick(doc)
            // Relations en ids (previousDoc) ou peuplées (doc) : libellés résolus seulement
            // si les sites changent
            const sitesTouched = operation === 'create'
              ? (after.sites || []).length > 0
              : auditEvents.userChangeSummary({ sites: before.sites }, { sites: after.sites }) !== ''
            if (operation === 'update' && !sitesTouched && !auditEvents.userChangeSummary(before, after, { passwordChanged })) return doc
            auditEvents.auditInBackground(async () => {
              const labels = sitesTouched ? await auditEvents.siteLabelsFor(payload, before.sites, after.sites) : {}
              if (operation === 'create') {
                await auditEvents.writeAudit(payload, { action: 'utilisateur.creation', actor, target: after.email, details: auditEvents.userCreationSummary(after, labels) })
                return
              }
              const details = auditEvents.userChangeSummary(before, after, { passwordChanged, siteLabels: labels })
              if (details) await auditEvents.writeAudit(payload, { action: 'utilisateur.modification', actor, target: after.email, details })
            })
            return doc
          },
          // Mot de passe modifié : révoque les sessions ouvertes. Seule la session courante
          // est conservée quand l'utilisateur modifie son propre compte.
          async ({ req, doc, operation, context }: any) => {
            if (operation !== 'update' || !accountGuards.hasPasswordChange(context, doc?.id)) return doc
            accountGuards.clearPasswordChange(context, doc?.id)
            try {
              const self = req?.user && String(req.user.id) === String(doc.id)
              const current = self && req.user._sid
              // Document complet relu en base, comme le fait Payload (logout) : une écriture
              // partielle { sessions } effacerait les champs select multiples (roles).
              const stored = await req.payload.db.findOne({ collection: 'users', where: { id: { equals: doc.id } }, req })
              if (!stored) return doc
              stored.sessions = current ? (stored.sessions || []).filter((s: any) => s?.id === current) : []
              stored.updatedAt = null // date de modification déjà posée par la mise à jour
              await req.payload.db.updateOne({ collection: 'users', id: doc.id, data: stored, req, returning: false })
            } catch (err: any) {
              console.error('❌ [Comptes] Révocation des sessions impossible :', err?.message || err)
            }
            return doc
          },
        ],
        // Journal d'audit : suppression d'un compte (arrière-plan : dans la transaction)
        afterDelete: [
          ({ req, doc }: any) => {
            const roles = (Array.isArray(doc?.roles) ? doc.roles.map(String).sort() : []).join(',') || '∅'
            const entry = { action: 'utilisateur.suppression', actor: auditEvents.auditActor(req), target: doc?.email, details: `roles=${roles}` }
            auditEvents.auditInBackground(() => auditEvents.writeAudit(req?.payload, entry))
            return doc
          },
        ],
        // Journal d'audit des opérations d'authentification réussies. Renvoie TOUJOURS
        // result. forgotPassword : result est le jeton de réinitialisation, jamais écrit ;
        // il n'est non nul que pour un compte existant (et ce hook s'exécute avant le
        // commit : écriture en arrière-plan). resetPassword écrit par db.updateOne (sans
        // afterChange) : tracé ici.
        afterOperation: [
          ({ args, operation, req, result }: any) => {
            const email = typeof args?.data?.email === 'string' ? args.data.email.trim().toLowerCase() : ''
            let entry: any = null
            if (operation === 'unlock' && result && email) {
              entry = { action: 'utilisateur.deverrouillage', actor: auditEvents.auditActor(req), target: email }
            } else if (operation === 'forgotPassword' && result && email) {
              entry = { action: 'motdepasse.demande-reinit', actor: auditEvents.auditActor(req), target: email, details: '' }
            } else if (operation === 'resetPassword' && result?.user?.email) {
              entry = { action: 'motdepasse.reinitialisation', actor: result.user.email, target: result.user.email }
            }
            if (entry) auditEvents.auditInBackground(() => auditEvents.writeAudit(req?.payload, entry))
            return result
          },
        ],
        // Journal d'audit : connexions réussies des admins (de tous les comptes si
        // AUDIT_LOGINS=true). Arrière-plan : hook exécuté dans la transaction du login.
        afterLogin: [
          ({ req, user }: any) => {
            if (auditEvents.shouldAuditLogin(user, process.env)) {
              const entry = { action: 'connexion.succes', actor: user.email, target: user.email }
              auditEvents.auditInBackground(() => auditEvents.writeAudit(req?.payload, entry))
            }
            return user
          },
        ],
        // Login : même réponse pour identifiants invalides et compte verrouillé, quelle que
        // soit la forme du chemin (/api/users/LOGIN, /api/users/%6Cogin…) ; échec tracé
        // avec l'email masqué.
        afterError: [
          async ({ error, req, context }: any) => {
            const attempt = context?.loginAttempt || req?.context?.loginAttempt
            if (!attempt && !accountGuards.isLoginPath(req?.pathname)) return
            // Statut 401 (LockedAuth, AuthenticationError) : error.name n'est pas fiable
            // une fois le bundle Next minifié en production
            if (!accountGuards.isLoginFailure(error)) return
            // Écriture attendue : la transaction du login est déjà annulée (aucune
            // connexion tenue) et l'entrée existe avant la réponse
            await auditEvents.writeAudit(req?.payload, {
              action: 'connexion.echec',
              actor: 'anonyme',
              target: auditEvents.maskEmail(attempt?.email),
              details: `motif=${accountGuards.loginFailureReason(error, req?.t?.('error:userLocked'))}`,
            })
            return { status: 401, response: { errors: [{ message: LOGIN_FAILED_MESSAGE }] } }
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
            description: "Quota IA journalier personnalisé pour ce compte. Vide = quota de l'offre du compte. 0 = générations bloquées."
          }
        },
        {
          // Offre souscrite : détermine le nombre de sites autorisés et le quota IA
          // par défaut. Aucune donnée de paiement n'est stockée ici.
          name: 'plan',
          type: 'select',
          options: [
            { label: 'Découverte (1 site)', value: 'free' },
            { label: 'Professionnel (5 sites)', value: 'pro' },
            { label: 'Agence (25 sites)', value: 'agency' },
          ],
          defaultValue: 'free',
          admin: {
            description: "Offre du compte. Modifiable par un administrateur uniquement."
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
        // Écriture réservée aux admins : chemins (documentRoot), domaine, statut et mesure
        // d'audience pilotent le déploiement. Les clients passent par les endpoints Express.
        update: isAdmin,
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
          // Chemin serveur : jamais exposé aux clients par l'API REST
          access: { read: isAdmin },
        },
        {
          name: 'repositoryPath',
          type: 'text',
          // Chemin serveur : jamais exposé aux clients par l'API REST
          access: { read: isAdmin },
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
        // --- Domaine personnalisé (rattachement du vrai nom de domaine du client) ---
        {
          name: 'customDomain',
          type: 'text',
          admin: { description: "Nom de domaine propre du client (ex. mon-commerce.fr). Vide = sous-domaine généré." },
        },
        {
          name: 'domainStatus',
          type: 'select',
          options: [
            { label: 'Aucun (sous-domaine)', value: 'none' },
            { label: 'En attente de vérification', value: 'pending' },
            { label: 'Actif', value: 'active' },
            { label: 'Erreur', value: 'error' },
          ],
          defaultValue: 'none',
        },
        {
          name: 'domainVerifyToken',
          type: 'text',
          access: { read: isAdmin },
          admin: { description: 'Jeton de vérification TXT (généré automatiquement).' },
        },
        // --- Mesure d'audience (analytics) : chargée après consentement RGPD ---
        {
          name: 'analyticsProvider',
          type: 'select',
          options: [
            { label: 'Aucune', value: '' },
            { label: 'Google Analytics 4', value: 'ga4' },
            { label: 'Matomo', value: 'matomo' },
          ],
          defaultValue: '',
        },
        {
          name: 'analyticsId',
          type: 'text',
          admin: { description: 'GA4 : identifiant de mesure G-XXXXXXXXXX. Matomo : idSite numérique.' },
        },
        {
          name: 'analyticsHost',
          type: 'text',
          admin: { description: 'Matomo uniquement : hôte du serveur (ex. stats.mondomaine.fr).' },
        },
        // --- Informations légales (mentions légales et politique de confidentialité du
        // site publié) : mêmes clés et longueurs que server/lib/legal.js. Saisie par le
        // propriétaire via PUT /api/sites/:slug/legal (validée), accès REST inchangés.
        {
          name: 'legal',
          type: 'group',
          label: 'Informations légales',
          admin: { description: "Publiées dans les mentions légales et la politique de confidentialité du site. Hébergeur vide : valeur par défaut du serveur (LEGAL_HOST_*)." },
          fields: [
            { name: 'companyName', type: 'text', maxLength: 200, label: "Raison sociale ou nom de l'éditeur" },
            { name: 'legalForm', type: 'text', maxLength: 200, label: 'Forme juridique et capital' },
            { name: 'address', type: 'textarea', maxLength: 400, label: 'Adresse du siège' },
            { name: 'registration', type: 'text', maxLength: 200, label: 'Immatriculation (SIREN, RCS ou RM)' },
            { name: 'vatNumber', type: 'text', maxLength: 40, label: 'N° de TVA intracommunautaire' },
            { name: 'phone', type: 'text', maxLength: 40, label: 'Téléphone' },
            { name: 'email', type: 'text', maxLength: 200, label: 'Email de contact' },
            { name: 'publisherName', type: 'text', maxLength: 200, label: 'Directeur ou directrice de la publication' },
            { name: 'hostName', type: 'text', maxLength: 200, label: 'Hébergeur' },
            { name: 'hostAddress', type: 'textarea', maxLength: 400, label: "Adresse de l'hébergeur" },
            { name: 'hostPhone', type: 'text', maxLength: 40, label: "Téléphone de l'hébergeur" },
          ],
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
        create: canCreateForOwnSite,
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
          // Langue de la page : la langue par défaut est servie à la racine,
          // les autres sous /<locale>/ (ex. /en/about/).
          name: 'locale',
          type: 'select',
          options: [
            { label: 'Français', value: 'fr' },
            { label: 'English', value: 'en' },
          ],
          defaultValue: 'fr',
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
          // Position dans le menu (écrite par le CMS) ; sans valeur : en fin de menu
          name: 'navOrder',
          type: 'number',
          index: true,
        },
        {
          // Page publiée mais absente du menu de navigation (reste dans le sitemap)
          name: 'hideFromNav',
          type: 'checkbox',
          defaultValue: false,
        },
        siteRelationField(),
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
                ctaLinkField(),
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
                    ctaLinkField(),
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
                    // Note sur 5 (0 = pas de note affichée)
                    { name: 'rating', type: 'number', min: 0, max: 5 },
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
                    ctaLinkField(),
                    { name: 'isPopular', type: 'checkbox' },
                  ],
                },
              ],
            },
            {
              // Formulaire de contact fonctionnel (poste vers /api/contact/<slug>)
              slug: 'contact',
              fields: [
                { name: 'title', type: 'text' },
                { name: 'subtitle', type: 'text' },
                { name: 'ctaText', type: 'text' },
              ],
            },
            {
              // Demande de rendez-vous : formulaire (poste vers /api/contact/<slug>)
              slug: 'appointment',
              fields: [
                { name: 'title', type: 'text' },
                { name: 'subtitle', type: 'text' },
                { name: 'ctaText', type: 'text' },
                {
                  name: 'services',
                  type: 'array',
                  fields: [
                    { name: 'name', type: 'text' },
                  ],
                },
              ],
            },
            {
              // Infos pratiques : adresse, téléphone, email, horaires, fiche Google
              slug: 'info',
              fields: [
                { name: 'title', type: 'text' },
                { name: 'address', type: 'text' },
                { name: 'phone', type: 'text' },
                { name: 'email', type: 'text' },
                { name: 'hours', type: 'textarea' },
                // Lien vers la fiche Google Business Profile (https://…)
                { name: 'googleBusinessUrl', type: 'text' },
              ],
            },
            {
              // Pied de page : mentions + réseaux sociaux (rendu sous le contenu)
              slug: 'footer',
              fields: [
                { name: 'text', type: 'text' },
                {
                  name: 'socials',
                  type: 'group',
                  fields: [
                    { name: 'facebook', type: 'text' },
                    { name: 'instagram', type: 'text' },
                    { name: 'linkedin', type: 'text' },
                    { name: 'x', type: 'text' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      // Articles de blog / actualités par site
      slug: 'posts',
      admin: { useAsTitle: 'title' },
      access: {
        read: isAdminOrSiteClient,
        create: canCreateForOwnSite,
        update: isAdminOrSiteClient,
        delete: isAdminOrSiteClient,
      },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'slug', type: 'text', required: true },
        { name: 'excerpt', type: 'textarea' },
        { name: 'coverImage', type: 'text' },
        { name: 'body', type: 'textarea' },
        { name: 'tags', type: 'text' },
        { name: 'publishedAt', type: 'date' },
        {
          name: 'status',
          type: 'select',
          options: [
            { label: 'Brouillon', value: 'draft' },
            { label: 'Publié', value: 'published' },
          ],
          defaultValue: 'draft',
        },
        siteRelationField(),
      ],
    },
    {
      slug: 'themes',
      access: {
        read: isAdminOrSiteClient,
        create: canCreateForOwnSite,
        update: isAdminOrSiteClient,
        delete: isAdminOrSiteClient,
      },
      fields: [
        siteRelationField({ unique: true }),
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
        {
          // Même règle que l'API du thème : bloque aussi PATCH /api/themes/:id (REST Payload)
          name: 'logo',
          type: 'text',
          validate: (value: unknown) =>
            value == null || value === '' || themeLib.normalizeLogo(value) !== null ? true : themeLib.LOGO_ERROR,
          // Enregistré sous sa forme canonique (comme POST /api/theme), même saisi dans le
          // panel ou par PATCH REST sous la forme de doc.url (« logo%20(1).png »)
          hooks: {
            beforeValidate: [
              ({ value }: any) => {
                const logo = themeLib.normalizeLogo(value)
                return typeof logo === 'string' && logo !== '' ? logo : value
              },
            ],
          },
          admin: {
            description: 'Logo du site : image de la médiathèque (/api/media/file/<nom>). Vide : nom du site affiché.',
          },
        },
      ],
    },
    {
      // Journal d'audit des actions sensibles (sites, comptes, connexions, contenus,
      // builds…). Écrit uniquement par le serveur (overrideAccess) ; ni modification ni
      // suppression par l'API ou le panel ; purge de rétention côté serveur
      // (services/retention.js). Lecture réservée aux admins.
      slug: 'audit_logs',
      admin: {
        useAsTitle: 'action',
        defaultColumns: ['action', 'actor', 'target', 'createdAt'],
      },
      access: {
        read: isAdmin,
        create: () => false,
        update: () => false,
        delete: () => false,
      },
      fields: [
        { name: 'action', type: 'text', required: true, index: true },
        { name: 'actor', type: 'text' },
        { name: 'target', type: 'text' },
        { name: 'details', type: 'textarea' },
      ],
    },
    {
      // Médiathèque par site : images téléversées depuis le CMS. Servies par Payload
      // sous /api/media/file/<nom> (lecture contrôlée par ownership) ; au déploiement,
      // les fichiers référencés sont copiés dans le site statique sous /media/.
      slug: 'media',
      upload: {
        staticDir: path.resolve(dirname, 'uploads'),
        // Images matricielles uniquement : un SVG peut embarquer du script (XSS sur le
        // domaine du site publié).
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'],
        // Grandes photos ramenées à 2400 px maximum (jamais agrandies), si sharp est là.
        ...(sharp ? { resizeOptions: { width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true } } : {}),
        // Fichiers servis à des comptes authentifiés : cache navigateur seulement.
        modifyResponseHeaders: ({ headers }: { headers: Headers }) => {
          headers.set('Cache-Control', 'private, max-age=86400')
          return headers
        },
      },
      admin: {
        useAsTitle: 'filename',
      },
      // Journal d'audit des ajouts et suppressions faits par l'API REST ou le panel. Les
      // copies et purges internes (API locale) sont déjà tracées par site.duplication et
      // site.suppression. Écriture en arrière-plan : hooks exécutés dans la transaction.
      hooks: {
        afterChange: [
          ({ req, doc, operation }: any) => {
            if (operation !== 'create' || req?.payloadAPI === 'local') return doc
            const payload = req?.payload
            const actor = auditEvents.auditActor(req)
            auditEvents.auditInBackground(async () => auditEvents.writeAudit(payload, {
              action: 'media.ajout',
              actor,
              target: await auditEvents.siteTargetFor(payload, doc?.site),
              details: `fichier=${doc?.filename} ; type=${doc?.mimeType} ; taille=${doc?.filesize}`,
            }))
            return doc
          },
        ],
        afterDelete: [
          ({ req, doc }: any) => {
            if (req?.payloadAPI === 'local') return doc
            const payload = req?.payload
            const actor = auditEvents.auditActor(req)
            auditEvents.auditInBackground(async () => auditEvents.writeAudit(payload, {
              action: 'media.suppression',
              actor,
              target: await auditEvents.siteTargetFor(payload, doc?.site),
              details: `fichier=${doc?.filename}`,
            }))
            return doc
          },
        ],
      },
      access: {
        read: isAdminOrSiteClient,
        create: canCreateForOwnSite,
        // Client : texte alternatif via PATCH /api/sites/:slug/media/:id. Un PATCH REST avec
        // un nouveau fichier effacerait l'ancien, encore cité, sans contrôle d'usage.
        update: isAdmin,
        // Suppression client via DELETE /api/sites/:slug/media/:id (contrôle d'usage)
        delete: isAdmin,
      },
      fields: [
        siteRelationField({ index: true }),
        // Texte alternatif repris par le site publié pour chaque usage de l'image ;
        // vide = texte de repli du bloc (nom du produit, « Photo N – titre »…).
        { name: 'alt', type: 'text', maxLength: 200 },
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
    {
      // Messages reçus par les formulaires des sites publiés (contact, rendez-vous).
      // Écrits uniquement par le serveur (overrideAccess) ; le propriétaire du site les
      // lit et les supprime, l'orchestrateur passe par /api/sites/:slug/submissions.
      slug: 'submissions',
      admin: {
        useAsTitle: 'name',
        defaultColumns: ['site', 'kind', 'name', 'email', 'read', 'createdAt'],
      },
      access: {
        read: isAdminOrSiteClient,
        create: () => false,
        update: () => false,
        delete: isAdminOrSiteClient,
      },
      fields: [
        siteRelationField({ index: true }),
        {
          name: 'kind',
          type: 'select',
          options: [
            { label: 'Contact', value: 'contact' },
            { label: 'Rendez-vous', value: 'appointment' },
          ],
          defaultValue: 'contact',
          required: true,
        },
        { name: 'name', type: 'text', required: true },
        { name: 'email', type: 'text', required: true },
        { name: 'phone', type: 'text' },
        { name: 'message', type: 'textarea', required: true },
        { name: 'read', type: 'checkbox', defaultValue: false, index: true },
      ],
    },
  ],
  plugins: [documentLocksOverridden],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
