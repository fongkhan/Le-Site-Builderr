import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useBuildStatus } from '../../state/BuildStatusContext';
import { useConfig } from '../../state/ConfigContext';
import { useSites } from '../../state/SitesContext';
import { APP_BRAND, routeTitle } from '../../lib/routeTitle';
import { SparklesIcon, CPanelIcon, BlocksIcon } from '../ui/Icons';

// Titre de l'onglet selon la route (nom du site courant si connu). La marque seule est
// rétablie en quittant l'espace connecté (page de connexion).
function useDocumentTitle(pathname: string) {
  const { getSite } = useSites();
  const slugMatch = /^\/sites\/([^/]+)/.exec(pathname);
  let siteName: string | undefined;
  if (slugMatch) {
    try {
      siteName = getSite(decodeURIComponent(slugMatch[1]))?.name;
    } catch {
      siteName = undefined;
    }
  }
  useEffect(() => {
    document.title = routeTitle(pathname, siteName);
  }, [pathname, siteName]);
  useEffect(() => () => {
    document.title = APP_BRAND;
  }, []);
}

// Focus sur le contenu principal à chaque changement de page (lecteurs d'écran, clavier) :
// jamais au premier affichage, ni quand seul le query-string change.
function useFocusMainOnNavigation(pathname: string) {
  const mainRef = useRef<HTMLElement>(null);
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);
  return mainRef;
}

export function AppLayout() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const buildStatus = useBuildStatus();
  const devNoAuth = Boolean(useConfig().config?.devNoAuth);
  const { pathname } = useLocation();
  // Chargement d'une page à la demande (route lazy) : barre fine + aria-busy
  const pageLoading = useNavigation().state === 'loading';
  useDocumentTitle(pathname);
  const mainRef = useFocusMainOnNavigation(pathname);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app-container">
      <a
        href="#contenu"
        className="skip-link"
        onClick={(e) => {
          // Focus direct : l'URL ne garde pas d'ancre et le routeur n'est pas sollicité
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Aller au contenu
      </a>
      {pageLoading && <div className="route-progress" aria-hidden />}
      <div role="status" className="sr-only">{pageLoading ? 'Chargement de la page…' : ''}</div>
      {devNoAuth && (
        <div className="dev-banner">
          ⚠️ Mode développement sans authentification (DEV_NO_AUTH) — toutes les requêtes sont traitées comme un admin. Ne jamais utiliser en production.
        </div>
      )}
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/sites" className="logo-container" style={{ textDecoration: 'none' }}>
            <div className="logo-icon">M</div>
            <div>
              <h1 className="logo-text">MetaSite Builder</h1>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI-Driven Composable SaaS</span>
            </div>
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <nav className="nav-tabs">
            <NavLink to="/sites" end className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
              <BlocksIcon /> Mes sites
            </NavLink>
            <NavLink to="/onboarding" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
              <SparklesIcon /> Créer un site (IA)
              </NavLink>
            {isAdmin && (
              <NavLink to="/admin-panel" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
                <CPanelIcon /> Panel Admin
                {buildStatus.inProgress && <span className="pulse-glow" style={{ background: 'var(--accent-emerald)', width: 8, height: 8, borderRadius: '50%', marginLeft: 4 }}></span>}
              </NavLink>
            )}
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderLeft: '1px solid var(--border-color)', paddingLeft: 15 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{user?.email}</span>
              <span style={{ fontSize: '0.7rem', color: isAdmin ? 'var(--purple-300)' : 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                {isAdmin ? 'Administrateur' : 'Client'}
              </span>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={handleLogout}>
              Déconnexion
            </button>
          </div>
        </div>
      </header>
      <main id="contenu" tabIndex={-1} ref={mainRef} className="main-content" aria-busy={pageLoading || undefined}>
        <Outlet />
      </main>
    </div>
  );
}
