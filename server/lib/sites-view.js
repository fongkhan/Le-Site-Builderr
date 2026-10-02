// Vue d'un site renvoyée par l'API Express : les chemins serveur et le jeton de
// vérification de domaine ne sont exposés qu'aux admins.
const ADMIN_ONLY_SITE_FIELDS = ['documentRoot', 'repositoryPath', 'domainVerifyToken'];

function publicSiteView(site, { isAdmin = false } = {}) {
  if (isAdmin || !site || typeof site !== 'object') return site;
  const view = { ...site };
  for (const key of ADMIN_ONLY_SITE_FIELDS) delete view[key];
  return view;
}

module.exports = { publicSiteView, ADMIN_ONLY_SITE_FIELDS };
