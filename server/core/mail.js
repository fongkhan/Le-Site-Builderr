// Envoi d'email générique. Même convention que le reset de mot de passe : sans
// SMTP_HOST, le message est écrit dans la console (mode développement).
const { envInt } = require('./config');

let mailTransport = null;

// options.replyTo : adresse de réponse (ex. le visiteur qui a écrit via le formulaire).
// Chaque destinataire est tenté ; l'envoi n'échoue que si AUCUN n'a pu être servi.
async function sendMail(recipients, subject, text, { replyTo } = {}) {
  const emails = Array.isArray(recipients) ? recipients : [recipients];
  if (emails.length === 0) return;
  if (!process.env.SMTP_HOST) {
    console.log(`📧 [Dev] ${subject} → ${emails.join(', ')}${replyTo ? ` (répondre à ${replyTo})` : ''}\n${text}`);
    return;
  }
  if (!mailTransport) {
    const nodemailer = require('nodemailer');
    const port = envInt('SMTP_PORT', 587);
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // SMTPS implicite ; STARTTLS sur 587/25
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  const from = process.env.EMAIL_FROM || 'noreply@localhost';
  const results = await Promise.allSettled(
    emails.map((to) => mailTransport.sendMail({ from, to, subject, text, ...(replyTo ? { replyTo } : {}) }))
  );
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length === results.length) throw failures[0].reason;
  for (const f of failures) console.error('📧 Envoi partiel — un destinataire a échoué :', f.reason && f.reason.message);
}

module.exports = { sendMail };
