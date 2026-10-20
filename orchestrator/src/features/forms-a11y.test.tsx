import { afterAll, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { Site } from '../types';
import { auditForm, auditFormControls } from '../test-utils/a11yAudit';
import { FieldError } from '../components/ui/FieldError';
import { Modal } from '../components/ui/Modal';
import { EditSiteModal } from './admin/EditSiteModal';
import { ImportSiteModal } from './admin/ImportSiteModal';
import { CreateClientModal } from './admin/CreateClientModal';
import { CreateSitePanel } from './admin/panels/CreateSitePanel';
import { NewPageModal } from './cms/components/NewPageModal';
import { PageSettings } from './cms/components/PageSettings';
import { OnboardingPage } from './onboarding/OnboardingPage';
import { PostEditor } from './blog/PostEditor';
import { withClientId, type EditorPage } from './cms/lib/editorModel';

// Formulaires de l'orchestrateur rendus sans DOM : les modales sont rendues sur place
// (portail simulé) ; les contextes (toasts, configuration, sites) sont simulés.
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (node: ReactNode) => node,
}));
vi.mock('../components/ui/ToastContext', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }),
}));
vi.mock('../state/ConfigContext', () => ({
  useConfig: () => ({
    config: {
      availableProviders: { openai: true, anthropic: true, gemini: false },
      defaultProvider: 'openai',
      aiQuota: null,
    },
    refresh: async () => {},
  }),
}));
vi.mock('../state/SitesContext', () => ({
  useSites: () => ({ sites: [], refresh: async () => {} }),
}));
// Modal lit document.body au rendu (cible du portail)
vi.stubGlobal('document', { body: {} });
afterAll(() => {
  vi.unstubAllGlobals();
});

const noop = () => {};
const site: Site = {
  slug: 'boulangerie',
  name: 'Boulangerie',
  domain: 'boulangerie.exemple.fr',
  documentRoot: '/srv/boulangerie',
  repositoryPath: '',
  stack: 'Astro SSG',
  createdWithTool: true,
  status: 'active',
  sslStatus: 'active',
  analyticsProvider: 'matomo',
  analyticsId: '1',
  analyticsHost: 'stats.exemple.fr',
  domainStatus: 'none',
};

// Balise ouvrante d'un champ (par son id)
const controlById = (html: string, id: string) => html.match(new RegExp(`<(?:input|textarea|select)[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
const labelledControl = (html: string, labelText: string) => {
  const id = html.match(new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${labelText}`))?.[1];
  return id ? controlById(html, id) : '';
};

describe('Modal', () => {
  it('sans onSubmit : aucun <form> ; bouton Fermer de l’en-tête de type button', () => {
    const html = renderToString(<Modal title="T" onClose={noop} footer={<button type="button">OK</button>}><p>Corps</p></Modal>);
    expect(html).not.toContain('<form');
    expect(html).toContain('<button type="button" class="btn btn-secondary"');
    expect(html).toMatch(/<div class="modal-body"><p>Corps<\/p><\/div><div class="modal-footer">/);
  });

  it('avec onSubmit : corps et pied dans un <form> sans validation native', () => {
    const html = renderToString(
      <Modal title="T" onClose={noop} onSubmit={noop} footer={<button type="submit">OK</button>}>
        <p>Corps</p>
      </Modal>,
    );
    expect(html).toMatch(/<form class="modal-form" novalidate=""><div class="modal-body">[\s\S]*<div class="modal-footer"><button type="submit">OK<\/button><\/div><\/form>/i);
    expect(auditForm(html)).toEqual([]);
  });

  it('FieldError : rien sans message, sinon le message avec son id', () => {
    expect(renderToString(<FieldError id="e" />)).toBe('');
    expect(renderToString(<FieldError id="e" message="Requis." />)).toBe('<span id="e" class="field-error">Requis.</span>');
  });
});

describe('formulaires accessibles', () => {
  it('EditSiteModal : libellés reliés, un seul <form>, nom requis', () => {
    const html = renderToString(<EditSiteModal site={site} onClose={noop} onSaved={noop} />);
    expect(auditFormControls(html)).toEqual([]);
    expect(auditForm(html)).toEqual([]);
    expect(labelledControl(html, 'Nom du site \\*')).toContain('required=""');
    expect(html).toContain('id="edit-site-domain"');
    expect(html).toMatch(/<h4 class="field-label"[^>]*>📊 Mesure d&#x27;audience/);
    expect(html).toMatch(/<h4 class="field-label"[^>]*>🌐 Domaine personnalisé du client<\/h4>/);
    expect(labelledControl(html, 'Hôte Matomo')).toContain('value="stats.exemple.fr"');
    expect(labelledControl(html, 'Nom de domaine')).toContain('placeholder="mon-commerce.fr"');
  });

  it('ImportSiteModal : libellés reliés, un seul <form>', () => {
    const scanned = { slug: 'ancien', name: 'Ancien site', documentRoot: '/srv/ancien', repositoryPath: '', domain: '', stack: 'Static HTML' };
    const html = renderToString(<ImportSiteModal scanned={scanned} onClose={noop} onImported={noop} />);
    expect(auditFormControls(html)).toEqual([]);
    expect(auditForm(html)).toEqual([]);
    expect(labelledControl(html, 'Stack technique')).toContain('<select');
  });

  it('CreateClientModal : email requis, sites en groupe, quota toujours libellé', () => {
    const html = renderToString(<CreateClientModal sites={[site]} onClose={noop} onCreated={noop} />);
    expect(auditFormControls(html)).toEqual([]);
    expect(auditForm(html)).toEqual([]);
    expect(controlById(html, 'cc-email')).toContain('required=""');
    expect(controlById(html, 'cc-password')).toContain('required=""');
    expect(html).toMatch(/<fieldset class="field-group"><legend class="field-label">Sites accessibles<\/legend>/);
    expect(html).toContain('<label class="field-label" for="cc-quota"');
    expect(html).toContain('Générations IA par jour (0 = bloqué)');
    expect(controlById(html, 'cc-quota')).toContain('disabled=""');
  });

  it('NewPageModal : un seul <form>, titre requis, plus de raccourci clavier propre', () => {
    const pages: EditorPage[] = [{ id: 'p1', title: 'Accueil', slug: 'home', locale: 'fr', layout: [withClientId({ blockType: 'hero' })] }];
    const html = renderToString(<NewPageModal pages={pages} onCancel={noop} onCreate={noop} />);
    expect(auditFormControls(html)).toEqual([]);
    expect(auditForm(html)).toEqual([]);
    expect(labelledControl(html, 'Titre de la page \\*')).toContain('required=""');
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
  });

  it('CreateSitePanel : <form> sans validation native, nom requis, stack reliée', () => {
    const html = renderToString(<CreateSitePanel onCreated={noop} />);
    expect(auditFormControls(html)).toEqual([]);
    expect(auditForm(html)).toEqual([]);
    expect(html).toMatch(/^<form class="glass-panel"/);
    expect(controlById(html, 'new-site-name')).toContain('required=""');
    expect(html).toContain('Nom du site *');
    expect(controlById(html, 'new-site-stack')).toContain('<select');
  });

  it('OnboardingPage : libellés reliés, groupes, boutons-bascule annoncés', () => {
    const html = renderToString(<OnboardingPage />);
    expect(auditFormControls(html)).toEqual([]);
    expect(html).not.toContain('<form');
    expect(labelledControl(html, 'Activité et description \\* :')).toMatch(/^<textarea[^>]*required=""/);
    expect(html).toMatch(/<legend class="field-label"[^>]*>Fonctionnalités requises :<\/legend>/);
    expect(html).toMatch(/<legend class="field-label"[^>]*>Modèle d&#x27;IA :<\/legend>/);
    expect(html).toMatch(/<legend class="field-label"[^>]*>Inspiration graphique :<\/legend>/);
    expect(html).toContain('role="group" aria-label="Ambiance prédéfinie"');
    // Fournisseur choisi, type d'inspiration et ambiance : un seul bouton enfoncé chacun
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="false"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('PostEditor et PageSettings : champs nommés, aucune référence cassée', () => {
    const post = { title: '', slug: '', excerpt: '', coverImage: '', body: '', tags: '', publishedAt: null, status: 'draft' as const };
    const editor = renderToString(<PostEditor site={site} post={post} onChange={noop} onSave={noop} onCancel={noop} saving={false} />);
    expect(auditFormControls(editor)).toEqual([]);
    expect(editor).toMatch(/<label class="field-label" for="[^"]+">Image de couverture<\/label>/);
    expect(controlById(editor, 'post-title')).toContain('required=""');

    const page: EditorPage = { id: 'p1', title: '', slug: 'contact', locale: 'fr', layout: [] };
    const settings = renderToString(
      <PageSettings page={page} deleteBlocker={null} onRename={noop} onDelete={noop} canMoveUp={false} canMoveDown={false} onMove={noop} onToggleNav={noop} />,
    );
    expect(auditFormControls(settings)).toEqual([]);
    expect(settings).toMatch(/aria-describedby="[^"]+-vide"/);
  });
});
