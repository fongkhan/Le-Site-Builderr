// Journal d'audit des actions sensibles (collection audit_logs, admin only en lecture).
// Fire-and-forget : l'audit n'échoue jamais une requête métier.
const { getPayloadInstance } = require('./payload');

function logAudit(req, action, target, details = '') {
  const payloadInstance = getPayloadInstance();
  if (!payloadInstance) return;
  payloadInstance
    .create({
      collection: 'audit_logs',
      data: {
        action,
        actor: (req && req.user && req.user.email) || 'système',
        target: String(target || ''),
        details: String(details || '').slice(0, 1000),
      },
      overrideAccess: true,
    })
    .catch((e) => console.error('Audit non enregistré :', e.message));
}

module.exports = { logAudit };
