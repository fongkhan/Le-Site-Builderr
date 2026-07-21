// Abstraction de l'hébergement : où et comment le site construit est publié.
// Deux drivers, sélectionnés par HOSTING_DRIVER :
//   - 'simulation' (défaut) : tout reste local (simulated_public_html), domaine et SSL fictifs.
//     C'est le mode de développement — zéro dépendance externe.
//   - 'cpanel' : publication réelle sur un hébergement cPanel/o2switch via l'API
//     (jeton cPanel, UAPI/API2 sur le port 2083). Le sous-domaine <slug>.<rootDomain>
//     est créé automatiquement et le statut SSL (AutoSSL) est lu depuis le serveur.
//
// SÉCURITÉ : le jeton API n'apparaît JAMAIS dans les logs, les erreurs ni les réponses
// HTTP — toutes les erreurs remontées sont génériques (module/fonction seulement).

const fs = require('fs');
const os = require('os');
const path = require('path');

const CPANEL_TIMEOUT_MS = 20000;

// ---------------------------------------------------------------------------
// Driver « simulation » : comportement historique, aucun appel réseau.
// ---------------------------------------------------------------------------
function createSimulationDriver() {
  return {
    name: 'simulation',
    isRemote: false,
    status() {
      return { driver: 'simulation', description: 'Publication locale (simulated_public_html) — domaine et SSL fictifs.' };
    },
    async testConnection() {
      return { ok: true, message: 'Mode simulation : aucune connexion distante requise.' };
    },
    // Domaine fictif historique — conservé à l'identique pour zéro régression.
    async ensureSubdomain(slug) {
      return { domain: `${slug}.o2switch.site`, created: false };
    },
    // La copie atomique locale (index.js) est LA publication en simulation.
    async publish() {
      return { published: 'local' };
    },
    async getSslStatus() {
      return 'active';
    },
  };
}

// ---------------------------------------------------------------------------
// Driver « cpanel » : API réelle o2switch/cPanel.
// ---------------------------------------------------------------------------
function createCpanelDriver(config) {
  const { host, user, token, rootDomain, port = 2083, fetchImpl = fetch, insecureTls = false } = config;
  const base = `https://${host}:${port}`;
  const authHeader = `cpanel ${user}:${token}`;

  // dispatcher optionnel pour les tests (mock en HTTP simple)
  const baseUrl = config.baseUrl || base;

  async function call(pathname, params, { method = 'GET', body } = {}) {
    const url = new URL(baseUrl + pathname);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        body,
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(CPANEL_TIMEOUT_MS),
      });
    } catch (e) {
      // Ne jamais relayer e.message brut : il peut contenir l'URL complète
      throw new Error(`cPanel injoignable (${pathname.split('?')[0]}) : réseau ou hôte invalide.`);
    }
    if (!res.ok) {
      throw new Error(`cPanel a répondu HTTP ${res.status} sur ${pathname.split('?')[0]}.`);
    }
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`Réponse cPanel illisible sur ${pathname.split('?')[0]}.`);
    }
    return json;
  }

  // UAPI : /execute/Module/fonction → { status: 1|0, data, errors }
  async function uapi(module, func, params) {
    const json = await call(`/execute/${module}/${func}`, params);
    if (json.status !== 1) {
      const reason = Array.isArray(json.errors) && json.errors.length ? json.errors.join(' ; ') : 'erreur inconnue';
      throw new Error(`Échec UAPI ${module}::${func} — ${reason}`);
    }
    return json.data;
  }

  // API2 : /json-api/cpanel → { cpanelresult: { event: { result }, data, error } }
  // Utilisée uniquement pour Fileman::fileop (extract/unlink), absent d'UAPI.
  async function api2(module, func, params) {
    const json = await call('/json-api/cpanel', {
      cpanel_jsonapi_apiversion: '2',
      cpanel_jsonapi_module: module,
      cpanel_jsonapi_func: func,
      ...params,
    });
    const result = json.cpanelresult || {};
    if (result.error || (result.event && result.event.result === 0)) {
      throw new Error(`Échec API2 ${module}::${func} — ${result.error || 'erreur inconnue'}`);
    }
    return result.data;
  }

  // Isolé volontairement : le nom/les paramètres de l'extraction varient selon les
  // versions de cPanel — un seul endroit à ajuster si besoin.
  async function extractRemote(archivePath, destDir) {
    await api2('Fileman', 'fileop', { op: 'extract', sourcefiles: archivePath, destfiles: destDir });
  }

  async function unlinkRemote(filePath) {
    await api2('Fileman', 'fileop', { op: 'unlink', sourcefiles: filePath });
  }

  return {
    name: 'cpanel',
    isRemote: true,

    status() {
      // Jamais le jeton ; l'hôte et le domaine racine suffisent à l'admin.
      return { driver: 'cpanel', host, user, rootDomain, description: `Publication réelle sur ${host} (sous-domaines de ${rootDomain}).` };
    },

    async testConnection() {
      const data = await uapi('DomainInfo', 'list_domains', {});
      return { ok: true, message: `Connexion cPanel OK (domaine principal : ${data && data.main_domain ? data.main_domain : 'inconnu'}).` };
    },

    // Crée <slug>.<rootDomain> (document root public_html/<slug>) s'il n'existe pas déjà.
    async ensureSubdomain(slug) {
      const domain = `${slug}.${rootDomain}`;
      const data = await uapi('DomainInfo', 'list_domains', {});
      const existing = (data && data.sub_domains) || [];
      if (existing.includes(domain)) {
        return { domain, created: false };
      }
      await uapi('SubDomain', 'addsubdomain', {
        domain: slug,
        rootdomain: rootDomain,
        dir: `public_html/${slug}`,
      });
      return { domain, created: true };
    },

    // Publie le dist : archive zip locale → upload → extraction distante → nettoyage.
    // Chemins distants dérivés du slug (validé en amont), jamais du documentRoot local.
    async publish(slug, distDir) {
      const archiver = require('archiver');
      const zipName = `deploy-${slug}-${Date.now()}.zip`;
      const localZip = path.join(os.tmpdir(), zipName);

      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(localZip);
        const archive = archiver('zip', { zlib: { level: 6 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(distDir, false);
        archive.finalize();
      });

      try {
        const form = new FormData();
        form.set('dir', 'public_html');
        form.set('file-1', new Blob([fs.readFileSync(localZip)]), zipName);
        const json = await call('/execute/Fileman/upload_files', {}, { method: 'POST', body: form });
        if (json.status !== 1) {
          const reason = Array.isArray(json.errors) && json.errors.length ? json.errors.join(' ; ') : 'erreur inconnue';
          throw new Error(`Échec UAPI Fileman::upload_files — ${reason}`);
        }
        await extractRemote(`public_html/${zipName}`, `public_html/${slug}`);
        await unlinkRemote(`public_html/${zipName}`);
      } finally {
        try { fs.rmSync(localZip, { force: true }); } catch {}
      }
      return { published: 'cpanel', remoteDir: `public_html/${slug}` };
    },

    // Statut AutoSSL : 'active' si un certificat installé couvre le domaine, sinon 'pending'.
    async getSslStatus(domain) {
      const hosts = await uapi('SSL', 'installed_hosts', {});
      const covered = Array.isArray(hosts) && hosts.some((h) => {
        const fqdns = (h.fqdns || []).concat(h.certificate && h.certificate.domains ? h.certificate.domains : []);
        return fqdns.some((f) => f === domain || (f.startsWith('*.') && domain.endsWith(f.slice(1))));
      });
      return covered ? 'active' : 'pending';
    },
  };
}

// ---------------------------------------------------------------------------
// Fabrique + singleton initialisé depuis l'environnement.
// ---------------------------------------------------------------------------
function createHostingDriver(env = process.env, overrides = {}) {
  const driver = (env.HOSTING_DRIVER || 'simulation').toLowerCase();
  if (driver === 'cpanel') {
    const missing = ['CPANEL_HOST', 'CPANEL_USER', 'CPANEL_API_TOKEN', 'CPANEL_ROOT_DOMAIN'].filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new Error(
        `HOSTING_DRIVER=cpanel mais variable(s) manquante(s) : ${missing.join(', ')}. ` +
        `Renseignez-les dans server/.env (voir .env.example) ou repassez en HOSTING_DRIVER=simulation.`
      );
    }
    return createCpanelDriver({
      host: env.CPANEL_HOST,
      user: env.CPANEL_USER,
      token: env.CPANEL_API_TOKEN,
      rootDomain: env.CPANEL_ROOT_DOMAIN,
      port: Number.parseInt(env.CPANEL_PORT ?? '', 10) || 2083,
      ...overrides,
    });
  }
  if (driver !== 'simulation') {
    throw new Error(`HOSTING_DRIVER inconnu : « ${driver} » (valeurs possibles : simulation, cpanel).`);
  }
  return createSimulationDriver();
}

let instance = null;
function getHosting() {
  if (!instance) instance = createHostingDriver();
  return instance;
}

module.exports = { createHostingDriver, createSimulationDriver, createCpanelDriver, getHosting };
