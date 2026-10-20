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
const { isValidSlug } = require('./paths');

// Délai d'un appel d'API cPanel ordinaire (inventaire, sous-domaine, SSL…).
const CPANEL_TIMEOUT_MS = 20000;

// Délai de l'envoi puis de l'extraction d'une archive de publication : CPANEL_UPLOAD_TIMEOUT_MS
// (ms, entier > 0) s'il est défini, sinon proportionnel à la taille (256 Ko/s, plus 20 s),
// 60 s au minimum. Un site lourd n'échoue plus au bout de 20 s.
function uploadTimeoutMs(bytes, env = process.env) {
  const raw = String(env.CPANEL_UPLOAD_TIMEOUT_MS ?? '').trim();
  if (/^\d+$/.test(raw) && Number(raw) > 0) return Number(raw);
  return Math.max(60000, Math.ceil(20000 + (Number(bytes) || 0) / 262144 * 1000));
}

// Une requête interrompue par son délai (AbortSignal.timeout) : TimeoutError, ou AbortError
// selon l'implémentation de fetch.
const isTimeout = (e) => Boolean(e) && (e.name === 'TimeoutError' || e.name === 'AbortError');

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
    // Domaine personnalisé simulé : aucun appel réseau, on considère le rattachement OK.
    async ensureCustomDomain(fqdn) {
      return { domain: fqdn, created: true };
    },
    async removeCustomDomain() {
      return { removed: true };
    },
    // La copie atomique locale (index.js) est LA publication en simulation.
    async publish() {
      return { published: 'local' };
    },
    // Rien de distant à retirer : les fichiers locaux sont supprimés par l'appelant.
    async removeSite() {
      return { removed: false };
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
  const { host, user, token, rootDomain, port = 2083, fetchImpl = fetch } = config;
  const base = `https://${host}:${port}`;
  const authHeader = `cpanel ${user}:${token}`;

  // dispatcher optionnel pour les tests (mock en HTTP simple)
  const baseUrl = config.baseUrl || base;

  // label : étape lisible citée en cas de délai dépassé (« l'envoi de l'archive (3,2 Mo) »).
  async function call(pathname, params, { method = 'GET', body, timeoutMs = CPANEL_TIMEOUT_MS, label } = {}) {
    const fn = pathname.split('?')[0];
    // Jamais l'hôte, l'URL ni le jeton dans un message : seulement la fonction ou l'étape
    const timeoutError = () => new Error(`cPanel : délai dépassé (${Math.round(timeoutMs / 1000)} s) pendant ${label || fn}.`);
    const url = new URL(baseUrl + pathname);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        body,
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (isTimeout(e)) throw timeoutError();
      // Ne jamais relayer l'erreur réseau (message ni cause) : elle contient l'URL complète
      // eslint-disable-next-line preserve-caught-error -- erreur d'origine écartée volontairement (URL de l'hôte cPanel)
      throw new Error(`cPanel injoignable (${fn}) : réseau ou hôte invalide.`);
    }
    if (!res.ok) {
      throw new Error(`cPanel a répondu HTTP ${res.status} sur ${fn}.`);
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      if (isTimeout(e)) throw timeoutError();
      // eslint-disable-next-line preserve-caught-error -- erreur d'origine écartée volontairement (extrait de la réponse de l'hôte)
      throw new Error(`Réponse cPanel illisible sur ${fn}.`);
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
  async function api2(module, func, params, opts) {
    const json = await call('/json-api/cpanel', {
      cpanel_jsonapi_apiversion: '2',
      cpanel_jsonapi_module: module,
      cpanel_jsonapi_func: func,
      ...params,
    }, opts);
    const result = json.cpanelresult || {};
    if (result.error || (result.event && result.event.result === 0)) {
      throw new Error(`Échec API2 ${module}::${func} — ${result.error || 'erreur inconnue'}`);
    }
    return result.data;
  }

  // Isolé volontairement : le nom/les paramètres de l'extraction varient selon les
  // versions de cPanel — un seul endroit à ajuster si besoin.
  async function extractRemote(archivePath, destDir, opts) {
    await api2('Fileman', 'fileop', { op: 'extract', sourcefiles: archivePath, destfiles: destDir }, opts);
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

    // Rattache un domaine EXTERNE (acheté par le client) comme domaine additionnel,
    // pointant sur le document root existant du site (public_html/<slug>). Idempotent.
    // AutoSSL émettra le certificat une fois le domaine résolu vers le serveur.
    async ensureCustomDomain(fqdn, slug) {
      const data = await uapi('DomainInfo', 'list_domains', {});
      const existing = (data && data.addon_domains) || [];
      if (existing.includes(fqdn)) {
        return { domain: fqdn, created: false };
      }
      await uapi('AddonDomain', 'addaddondomain', {
        newdomain: fqdn,
        dir: `public_html/${slug}`,
      });
      return { domain: fqdn, created: true };
    },

    // Détache un domaine additionnel. Best-effort : l'appelant tolère l'échec
    // (domaine déjà absent, variations d'API selon la version cPanel).
    async removeCustomDomain(fqdn) {
      await uapi('AddonDomain', 'deladdondomain', { domain: fqdn });
      return { removed: true };
    },

    // Publie le dist : archive zip locale → upload → extraction distante → nettoyage.
    // Chemins distants dérivés du slug (validé en amont), jamais du documentRoot local.
    // L'archive est envoyée en flux (jamais chargée en mémoire) avec un délai proportionnel
    // à sa taille ; elle est supprimée dans tous les cas, création ratée comprise. Renvoie
    // la taille de l'archive (bytes) pour le journal de build.
    async publish(slug, distDir) {
      const archiver = require('archiver');
      const zipName = `deploy-${slug}-${Date.now()}.zip`;
      const localZip = path.join(os.tmpdir(), zipName);

      try {
        await new Promise((resolve, reject) => {
          const output = fs.createWriteStream(localZip);
          const archive = archiver('zip', { zlib: { level: 6 } });
          output.on('close', resolve);
          output.on('error', reject);
          archive.on('error', reject);
          archive.pipe(output);
          archive.directory(distDir, false);
          Promise.resolve(archive.finalize()).catch(reject);
        });

        const bytes = fs.statSync(localZip).size;
        const timeoutMs = uploadTimeoutMs(bytes);
        const mo = (bytes / (1024 * 1024)).toFixed(1).replace('.', ',');
        const form = new FormData();
        form.set('dir', 'public_html');
        form.set('file-1', await fs.openAsBlob(localZip), zipName);
        const json = await call('/execute/Fileman/upload_files', {}, { method: 'POST', body: form, timeoutMs, label: `l'envoi de l'archive (${mo} Mo)` });
        if (json.status !== 1) {
          const reason = Array.isArray(json.errors) && json.errors.length ? json.errors.join(' ; ') : 'erreur inconnue';
          throw new Error(`Échec UAPI Fileman::upload_files — ${reason}`);
        }
        await extractRemote(`public_html/${zipName}`, `public_html/${slug}`, { timeoutMs, label: "l'extraction de l'archive" });
        await unlinkRemote(`public_html/${zipName}`);
        return { published: 'cpanel', remoteDir: `public_html/${slug}`, bytes };
      } finally {
        try { fs.rmSync(localZip, { force: true }); } catch { /* nettoyage au mieux : jamais au détriment du résultat de la publication */ }
      }
    },

    // Retire un site du serveur : domaine personnalisé, sous-domaine <slug>.<rootDomain>,
    // puis dossier public_html/<slug>. Chaque étape est tentée même si une précédente
    // échoue (droits, API…) ; le résultat détaille chaque étape ('removed', 'failed' ou
    // 'skipped'), sans jeton ni hôte. Une ressource absente du serveur (domaine encore en
    // attente de vérification, site importé sans sous-domaine ni dossier…) est 'skipped' :
    // pas de fausse alerte « retrait incomplet ». Inventaire illisible : l'étape est
    // tentée. Slug revalidé : jamais de chemin distant dérivé d'une valeur arbitraire
    // (« ../ », vide → racine public_html).
    async removeSite(slug, { customDomain } = {}) {
      if (!isValidSlug(slug)) {
        throw new Error('Identifiant de site invalide : retrait distant refusé.');
      }
      const attempt = async (label, fn) => {
        try {
          await fn();
          return 'removed';
        } catch (e) {
          console.error(`⚠️ [cPanel] Retrait ${label} de ${slug} : ${e.message}`);
          return 'failed';
        }
      };
      // Inventaire du compte : null si illisible ou absent de la réponse (version de
      // cPanel), jamais lu comme « vide » ; l'étape correspondante est alors tentée.
      const toList = (list) => (Array.isArray(list) ? list.map((v) => String(v || '').toLowerCase()) : null);
      const read = async (fn) => {
        try { return await fn(); } catch { return null; }
      };
      const domainInfo = (await read(() => uapi('DomainInfo', 'list_domains', {}))) || {};
      const addonDomains = toList(domainInfo.addon_domains);
      const subDomains = toList(domainInfo.sub_domains);
      const entries = await read(() => uapi('Fileman', 'list_files', { dir: 'public_html', types: 'dir' }));
      const dirs = toList(Array.isArray(entries) ? entries.map((e) => e && e.file) : null);
      const absent = (list, name) => Array.isArray(list) && !list.includes(String(name).toLowerCase());

      const subdomain = `${slug}.${rootDomain}`;
      const result = {
        customDomain: !customDomain || absent(addonDomains, customDomain)
          ? 'skipped'
          : await attempt('du domaine personnalisé', () => uapi('AddonDomain', 'deladdondomain', { domain: customDomain })),
        subdomain: absent(subDomains, subdomain)
          ? 'skipped'
          : await attempt('du sous-domaine', () => api2('SubDomain', 'delsubdomain', { domain: subdomain })),
        files: absent(dirs, slug)
          ? 'skipped'
          : await attempt('des fichiers', () => unlinkRemote(`public_html/${slug}`)),
      };
      result.removed = Object.values(result).every((v) => v !== 'failed');
      return result;
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

module.exports = { createHostingDriver, createSimulationDriver, createCpanelDriver, getHosting, uploadTimeoutMs };
