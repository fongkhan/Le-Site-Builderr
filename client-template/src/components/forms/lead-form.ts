// Envoi des formulaires de contact et de prise de rendez-vous (blocs Contact et
// Appointment, balisage commun : LeadForm.astro).
//
// Amélioration progressive : sans JavaScript, le formulaire est posté normalement
// (method="post", jamais en GET : les données ne doivent pas finir dans une URL, des
// journaux ou l'historique). Avec JavaScript, l'envoi se fait en fetch (JSON) et le
// résultat s'affiche sans quitter la page. Échoue en douceur : ne casse jamais la page.

type LeadKind = 'contact' | 'appointment';

const MESSAGES: Record<LeadKind, { sending: string; ok: string; failed: string }> = {
  contact: {
    sending: 'Envoi en cours…',
    ok: 'Merci, votre message a bien été envoyé !',
    failed: "Impossible d'envoyer le message pour le moment.",
  },
  appointment: {
    sending: 'Envoi en cours…',
    ok: 'Merci ! Votre demande de rendez-vous a bien été envoyée.',
    failed: "Impossible d'envoyer la demande pour le moment.",
  },
};

function field(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  return el && typeof el.value === 'string' ? el.value.trim() : '';
}

// Corps attendu par l'API de contact : { name, email, message, company (honeypot) }.
// Une demande de RDV compose un message lisible (prestation, créneau, téléphone).
function payloadFor(form: HTMLFormElement, kind: LeadKind) {
  let message = field(form, 'message');
  if (kind === 'appointment') {
    const lines = ['Demande de rendez-vous'];
    const service = field(form, 'service');
    const slot = field(form, 'slot');
    const phone = field(form, 'phone');
    if (service) lines.push(`Prestation : ${service}`);
    if (slot) lines.push(`Créneau souhaité : ${slot}`);
    if (phone) lines.push(`Téléphone : ${phone}`);
    if (message) lines.push('', message);
    message = lines.join('\n');
  }
  return {
    name: field(form, 'name'),
    email: field(form, 'email'),
    message,
    company: field(form, 'company'),
  };
}

function enhance(form: HTMLFormElement) {
  if (form.dataset.enhanced === '1') return;
  form.dataset.enhanced = '1';
  const kind: LeadKind = form.dataset.kind === 'appointment' ? 'appointment' : 'contact';
  const texts = MESSAGES[kind];
  const status = form.querySelector<HTMLElement>('.lead-status');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const say = (text: string) => { if (status) status.textContent = text; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button) button.disabled = true;
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
        const data = await res.json().catch(() => ({}));
        say((data && typeof data.error === 'string' && data.error) || 'Une erreur est survenue. Réessayez plus tard.');
      }
    } catch {
      say(texts.failed);
    } finally {
      if (button) button.disabled = false;
    }
  });
}

document.querySelectorAll<HTMLFormElement>('form.lead-form').forEach(enhance);
