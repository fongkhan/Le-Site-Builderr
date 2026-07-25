// Plans d'abonnement : définition des offres et des limites associées.
// AUCUN traitement de paiement ici — seulement la brique métier (quotas et
// autorisations), à brancher plus tard sur un prestataire de facturation.
// Fonctions pures : testables sans serveur ni base de données.

const PLANS = {
  // Le quota de l'offre Découverte reprend l'ancien défaut serveur (10) : introduire
  // les offres ne doit dégrader aucun compte existant.
  free: { key: 'free', label: 'Découverte', maxSites: 1, aiDailyQuota: 10 },
  pro: { key: 'pro', label: 'Professionnel', maxSites: 5, aiDailyQuota: 50 },
  agency: { key: 'agency', label: 'Agence', maxSites: 25, aiDailyQuota: 200 },
};

const DEFAULT_PLAN = 'free';

// Plan effectif d'un compte (repli sur l'offre par défaut si absent/inconnu).
function planOf(user) {
  const key = user && typeof user.plan === 'string' ? user.plan : '';
  return PLANS[key] || PLANS[DEFAULT_PLAN];
}

// Limites applicables. `isAdmin` (ou le mode dev) = aucune limite → null.
function limitsFor(user, { isAdmin = false } = {}) {
  if (isAdmin || (user && user.devMode)) return null;
  const plan = planOf(user);
  return { plan: plan.key, label: plan.label, maxSites: plan.maxSites, aiDailyQuota: plan.aiDailyQuota };
}

// Un compte peut-il créer un site de plus ? Renvoie { allowed, reason? }.
function canCreateSite(user, currentSiteCount, { isAdmin = false } = {}) {
  const limits = limitsFor(user, { isAdmin });
  if (limits === null) return { allowed: true };
  const count = Number(currentSiteCount) || 0;
  if (count < limits.maxSites) return { allowed: true };
  return {
    allowed: false,
    reason: `Votre offre « ${limits.label} » est limitée à ${limits.maxSites} site${limits.maxSites > 1 ? 's' : ''}. Passez à une offre supérieure pour en créer davantage.`,
  };
}

module.exports = { PLANS, DEFAULT_PLAN, planOf, limitsFor, canCreateSite };
