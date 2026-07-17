import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useBuildStatus } from '../../hooks/useBuildStatus';
import { fetchConfig } from '../../api/sites';
import { SparklesIcon, CPanelIcon, BlocksIcon } from '../ui/Icons';

export function AppLayout() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const buildStatus = useBuildStatus();
  const [devNoAuth, setDevNoAuth] = useState(false);

  useEffect(() => {
    fetchConfig().then((c) => setDevNoAuth(Boolean(c.devNoAuth))).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app-container">
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
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
