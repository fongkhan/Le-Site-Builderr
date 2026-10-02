import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from './AppLayout';

// Contextes simulés (comme render.test.tsx) : rendu sans DOM ni serveur.
vi.mock('../../state/ConfigContext', () => ({
  useConfig: () => ({ config: null, refresh: async () => {} }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'client@client.com' }, isAdmin: false, logout: async () => {} }),
}));
vi.mock('../../state/BuildStatusContext', () => ({
  useBuildStatus: () => ({ inProgress: false }),
}));
vi.mock('../../state/SitesContext', () => ({
  useSites: () => ({ sites: [], loading: false, error: null, refresh: async () => {}, getSite: () => undefined }),
}));

describe('AppLayout : navigation accessible', () => {
  it('lien d’évitement, contenu principal focalisable et zone de statut', () => {
    // useNavigation exige un routeur de données (createMemoryRouter), comme en production
    const router = createMemoryRouter(
      [{ element: <AppLayout />, children: [{ path: '/sites', element: <p>Mes sites</p> }] }],
      { initialEntries: ['/sites'] },
    );
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).toContain('href="#contenu"');
    expect(html).toContain('class="skip-link"');
    expect(html).toContain('id="contenu"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Mes sites');
    // Le lien d'évitement est le premier élément de la mise en page
    expect(html.indexOf('skip-link')).toBeLessThan(html.indexOf('<header'));
  });
});
