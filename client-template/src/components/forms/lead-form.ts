// Envoi des formulaires de contact et de prise de rendez-vous (blocs Contact et
// Appointment, balisage commun : LeadForm.astro).
//
// Amélioration progressive : sans JavaScript, le formulaire est posté normalement
// (method="post", jamais en GET : les données ne doivent pas finir dans une URL, des
// journaux ou l'historique). Avec JavaScript, l'envoi se fait en fetch (JSON) et le
// résultat s'affiche sans quitter la page. Échoue en douceur : ne casse jamais la page.
// Messages d'état dans la langue de la page : attributs data-msg-sending, data-msg-ok,
// data-msg-error, data-msg-invalid, data-msg-rate-limit et data-msg-too-long du
// formulaire (posés par LeadForm.astro), repli sur le français. Le texte d'erreur du
// serveur (en français) n'est jamais affiché : le message dépend du code d'erreur de la
// réponse, sinon de son statut (lead-status.mjs). Les champs refusés par le serveur
// sont marqués aria-invalid et le premier reçoit le focus.

import { errorMessageFor, invalidFieldsOf } from './lead-status.mjs';

type LeadKind = 'contact' | 'appointment';

const COMMON = {
  sending: 'Envoi en cours…',
  invalid: 'Vérifiez votre nom, votre email et votre message.',
  rateLimited: "Trop d'envois en peu de temps : réessayez dans quelques minutes.",
  tooLong: 'Votre message est trop long.',
};

const MESSAGES: Record<LeadKind, { sending: string; ok: string; failed: string; invalid: string; rateLimited: string; tooLong: string }> = {
  contact: {
    ...COMMON,
    ok: 'Merci, votre message a bien été envoyé !',
    failed: "Impossible d'envoyer le message pour le moment.",
  },
  appointment: {
    ...COMMON,
    ok: 'Merci ! Votre demande de rendez-vous a bien été envoyée.',
    failed: "Impossible d'envoyer la demande pour le moment.",
  },
};

function field(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  return el && typeof el.value === 'string' ? el.value.trim() : '';
}

// Corps attendu par l'API de contact : { name, email, message, company (honeypot) }, plus
// pour une demande de RDV { kind, service, slot, phone } — le serveur compose alors le
// message, exactement comme pour un envoi sans JavaScript.
function payloadFor(form: HTMLFormElement, kind: LeadKind) {
  const base = {
    name: field(form, 'name'),
    email: field(form, 'email'),
    message: field(form, 'message'),
    company: field(form, 'company'),
  };
  if (kind !== 'appointment') return base;
  return { ...base, kind, service: field(form, 'service'), slot: field(form, 'slot'), phone: field(form, 'phone') };
}

function enhance(form: HTMLFormElement) {
  if (form.dataset.enhanced === '1') return;
  form.dataset.enhanced = '1';
  const kind: LeadKind = form.dataset.kind === 'appointment' ? 'appointment' : 'contact';
  const fallback = MESSAGES[kind];
  const texts = {
    sending: form.dataset.msgSending || fallback.sending,
    ok: form.dataset.msgOk || fallback.ok,
    failed: form.dataset.msgError || fallback.failed,
    invalid: form.dataset.msgInvalid || fallback.invalid,
    rateLimited: form.dataset.msgRateLimit || fallback.rateLimited,
    tooLong: form.dataset.msgTooLong || fallback.tooLong,
  };
  const status = form.querySelector<HTMLElement>('.lead-status');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const say = (text: string) => { if (status) status.textContent = text; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button) button.disabled = true;
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    say(texts.sending);
    try {
      const res = await fetch(form.getAttribute('action') || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payloadFor(form, kind)),
      });
      if (res.ok) {
        form.reset();
        say(texts.ok);
      } else {
        // Message traduit selon le code d'erreur (trop d'envois, champ invalide, message
        // trop long, erreur), champs refusés signalés et focus sur le premier.
        const data = await res.json().catch(() => null);
        say(errorMessageFor(res.status, texts, data?.code));
        const invalid = invalidFieldsOf(data)
          .map((name) => form.elements.namedItem(name))
          .filter((el): el is HTMLInputElement | HTMLTextAreaElement => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement);
        invalid.forEach((el) => el.setAttribute('aria-invalid', 'true'));
        invalid[0]?.focus();
      }
    } catch {
      say(errorMessageFor(0, texts));
    } finally {
      if (button) button.disabled = false;
    }
  });
}

document.querySelectorAll<HTMLFormElement>('form.lead-form').forEach(enhance);
