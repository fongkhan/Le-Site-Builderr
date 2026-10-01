// Envoi d'email générique. Même convention que le reset de mot de passe : sans
// SMTP_HOST, le message est écrit dans la console (mode développement).
const { envInt } = require('./config');

let mailTransport = null;

async function sendMail(recipients, subject, text) {
  const emails = Array.isArray(recipients) ? recipients : [recipients];
  if (emails.length === 0) return;
  if (!process.env.SMTP_HOST) {
    console.log(`📧 [Dev] ${subject} → ${emails.join(', ')}\n${text}`);
    return;
  }
  if (!mailTransport) {
    const nodemailer = require('nodemailer');
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: envInt('SMTP_PORT', 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  const from = process.env.EMAIL_FROM || 'noreply@localhost';
  await Promise.all(emails.map((to) => mailTransport.sendMail({ from, to, subject, text })));
}

module.exports = { sendMail };
