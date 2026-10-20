// Consentement RGPD : la mesure d'audience n'est chargée qu'après « Accepter ». Le refus
// est aussi simple que l'acceptation ; le choix (6 mois) est modifiable via le bouton
// « Cookies » ou le lien « Gérer les cookies » du bas de page ([data-consent-open]).
// Configuration lue dans les attributs data-* de #consent-banner (ConsentBanner.astro).
// Tout échoue en silence : ne casse jamais la page.
import { CONSENT_KEY, analyticsScriptUrl, matomoTrackerUrl, readConsentChoice } from '../../lib/consent.mjs';

declare global {
	interface Window {
		dataLayer: unknown[];
		gtag?: (...args: unknown[]) => void;
		_paq?: unknown[][];
	}
}

function readChoice(): string | null {
	try {
		return readConsentChoice(localStorage.getItem(CONSENT_KEY), Date.now());
	} catch {
		return null;
	}
}

function saveChoice(value: 'accepted' | 'refused'): void {
	try {
		localStorage.setItem(CONSENT_KEY, JSON.stringify({ value, at: Date.now() }));
	} catch { /* stockage indisponible : la bannière reviendra */ }
}

function appendScript(src: string): void {
	const s = document.createElement('script');
	s.async = true;
	s.src = src;
	document.head.appendChild(s);
}

export function initConsent(): void {
	const banner = document.getElementById('consent-banner');
	const reopen = document.getElementById('consent-reopen');
	if (!banner || !reopen) return;
	const provider = banner.dataset.provider || '';
	const id = banner.dataset.id || '';
	const host = banner.dataset.host || '';

	let loaded = false;
	function loadAnalytics() {
		if (loaded) return;
		loaded = true;
		try {
			const src = analyticsScriptUrl({ provider, id, host });
			if (!src) return;
			if (provider === 'ga4') {
				appendScript(src);
				window.dataLayer = window.dataLayer || [];
				// gtag.js attend l'objet arguments lui-même : ne pas réécrire en (...args)
				const gtag = function gtag(){ window.dataLayer.push(arguments) } as (...args: unknown[]) => void;
				window.gtag = gtag;
				gtag('js', new Date());
				gtag('config', id, { anonymize_ip: true });
			} else if (provider === 'matomo') {
				const paq = (window._paq = window._paq || []);
				paq.push(['trackPageView']);
				paq.push(['enableLinkTracking']);
				paq.push(['setTrackerUrl', matomoTrackerUrl(host)]);
				paq.push(['setSiteId', id]);
				appendScript(src);
			}
		} catch { /* la mesure d'audience ne doit jamais casser la page */ }
	}

	function applyChoice(value: string) {
		banner!.hidden = true;
		reopen!.hidden = false;
		if (value === 'accepted') loadAnalytics();
	}

	// Rouvre la bannière (bouton « Cookies » ou lien « Gérer les cookies » du bas de page)
	// et place le focus sur son premier bouton.
	function openBanner() {
		banner!.hidden = false;
		reopen!.hidden = true;
		banner!.querySelector('button')?.focus();
	}

	document.getElementById('consent-accept')?.addEventListener('click', () => { saveChoice('accepted'); applyChoice('accepted'); });
	document.getElementById('consent-refuse')?.addEventListener('click', () => { saveChoice('refused'); applyChoice('refused'); });
	reopen.addEventListener('click', openBanner);
	document.querySelectorAll('[data-consent-open]').forEach((el) => el.addEventListener('click', openBanner));

	const existing = readChoice();
	if (existing) applyChoice(existing);
	else banner.hidden = false;
}
