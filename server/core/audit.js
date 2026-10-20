// Journal d'audit des actions sensibles (collection audit_logs, admin only en lecture).
// Fire-and-forget : l'audit n'échoue jamais une requête métier (writeAudit ne rejette pas).
// L'écriture est attendue par l'arrêt propre (writeAudit l'inscrit auprès de core/shutdown).
const { getPayloadInstance } = require('./payload');
const { writeAudit, auditActor } = require('../lib/audit-events');

function logAudit(req, action, target, details = '') {
  writeAudit(getPayloadInstance(), { action, actor: auditActor(req), target, details });
}

module.exports = { logAudit };
