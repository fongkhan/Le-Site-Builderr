import { useState, useEffect, useRef } from 'react';

// Interfaces
interface FeatureFlags {
  blog_or_news: boolean;
  e_commerce: boolean;
  multi_store: boolean;
}

interface StackRequirements {
  astro_mode: string;
  need_payload: boolean;
  need_medusajs: boolean;
  need_stripe: boolean;
}

interface OnboardingResult {
  site_name: string;
  features: FeatureFlags;
  stack_requirements: StackRequirements;
}

interface Theme {
  colors: {
    primary: string;
    secondary: string;
    background: string;
    text: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  radius: string;
}

interface Block {
  blockType: string;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  backgroundImage?: string;
  items?: { title: string; description: string }[];
  products?: { name: string; price: string; image: string }[];
  images?: string[];
}

interface PageDoc {
  title: string;
  slug: string;
  layout: Block[];
}

interface PagesData {
  docs: PageDoc[];
}

interface BuildStatus {
  inProgress: boolean;
  status: string;
  lastCompleted: string | null;
  error: string | null;
  lockExists: boolean;
  logs: string;
}

const BACKEND_URL = 'http://localhost:4000';

export default function App() {
  const [activeTab, setActiveTab] = useState<'onboarding' | 'design' | 'cms' | 'deploy'>('onboarding');

  // --- STATE ONBOARDING ---
  const [promptText, setPromptText] = useState('Je veux un site pour ma boulangerie à Clamart, j\'ai deux boutiques et je veux vendre mes croissants en ligne. Je veux pouvoir mettre à jour le menu moi-même.');
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingResult, setOnboardingResult] = useState<OnboardingResult | null>(null);

  // --- STATE DESIGN ---
  const [theme, setTheme] = useState<Theme>({
    colors: {
      primary: '#8b5a2b',
      secondary: '#f5e6cc',
      background: '#fafafa',
      text: '#2d241e'
    },
    fonts: {
      heading: 'Playfair Display',
      body: 'Inter'
    },
    radius: '12px'
  });
  const [selectedAmbiance, setSelectedAmbiance] = useState<string>('chaleureux');
  const [designSaving, setDesignSaving] = useState(false);

  // --- STATE CMS ---
  const [pagesData, setPagesData] = useState<PagesData>({ docs: [] });
  const [selectedPageIdx] = useState(0);
  const [cmsSaving, setCmsSaving] = useState(false);
  const [editingBlockIdx, setEditingBlockIdx] = useState<number | null>(null);

  // --- STATE DEPLOY ---
  const [buildStatus, setBuildStatus] = useState<BuildStatus>({
    inProgress: false,
    status: 'idle',
    lastCompleted: null,
    error: null,
    lockExists: false,
    logs: ''
  });
  const [deployLoading, setDeployLoading] = useState(false);
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial data
  useEffect(() => {
    fetchTheme();
    fetchPages();
    fetchBuildStatus();

    // Poll build status every 2 seconds
    const interval = setInterval(fetchBuildStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildStatus.logs]);

  const fetchTheme = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/theme`);
      if (res.ok) {
        const data = await res.json();
        setTheme(data.theme ? data.theme : defaultThemeMock);
      }
    } catch (e) {
      console.error("Impossible de récupérer le thème", e);
    }
  };

  const fetchPages = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/pages`);
      if (res.ok) {
        const data = await res.json();
        setPagesData(data);
      }
    } catch (e) {
      console.error("Impossible de récupérer les pages", e);
    }
  };

  const fetchBuildStatus = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/build-status`);
      if (res.ok) {
        const data = await res.json();
        setBuildStatus(data);
      }
    } catch (e) {
      // Ignorer silencieusement si le serveur n'est pas encore lancé
    }
  };

  const defaultThemeMock: Theme = {
    colors: { primary: '#8b5a2b', secondary: '#f5e6cc', background: '#fafafa', text: '#2d241e' },
    fonts: { heading: 'Playfair Display', body: 'Inter' },
    radius: '12px'
  };

  // --- ACTIONS ---

  const handleOnboard = async () => {
    setOnboardingLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText })
      });
      if (res.ok) {
        const data = (await res.json()) as OnboardingResult;
        setOnboardingResult(data);
      }
    } catch (e) {
      alert("Erreur lors de la qualification. Assurez-vous que le serveur Express tourne sur le port 4000.");
    } finally {
      setOnboardingLoading(false);
    }
  };

  const applyAmbiance = async (ambiance: string) => {
    setSelectedAmbiance(ambiance);
    try {
      const res = await fetch(`${BACKEND_URL}/api/extract-design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambiance })
      });
      if (res.ok) {
        const data = await res.json();
        setTheme(data.theme);
      }
    } catch (e) {
      console.error("Erreur extraction thème", e);
    }
  };

  const saveTheme = async () => {
    setDesignSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/theme`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme })
      });
      if (res.ok) {
        alert("Thème enregistré et appliqué aux fichiers Astro client-template/src/styles/theme.css !");
      }
    } catch (e) {
      alert("Erreur lors de la sauvegarde du thème.");
    } finally {
      setDesignSaving(false);
    }
  };

  const savePages = async (updatedData: PagesData) => {
    setCmsSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedData)
      });
      if (res.ok) {
        setPagesData(updatedData);
      }
    } catch (e) {
      alert("Erreur lors de l'enregistrement des pages.");
    } finally {
      setCmsSaving(false);
    }
  };

  const triggerDeploy = async () => {
    setDeployLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/webhook/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.status === 429) {
        alert("🔒 Build refusé : Un build est déjà en cours ! Le système de verrouillage (lockfile) a correctement bloqué la requête concurrente.");
      } else if (res.ok) {
        // Le build a démarré
        fetchBuildStatus();
      }
    } catch (e) {
      alert("Impossible de contacter le webhook de build.");
    } finally {
      setDeployLoading(false);
    }
  };

  const simulateConcurrency = async () => {
    // Envoie deux requêtes de build simultanées pour tester le lockfile
    triggerDeploy();
    setTimeout(triggerDeploy, 100);
  };

  // Modifier les blocs du CMS
  const handleBlockChange = (blockIdx: number, field: string, value: any) => {
    const updated = { ...pagesData };
    const block = updated.docs[selectedPageIdx].layout[blockIdx];
    (block as any)[field] = value;
    setPagesData(updated);
  };

  const handleBlockNestedChange = (blockIdx: number, nestedField: string, index: number, field: string, value: any) => {
    const updated = { ...pagesData };
    const block = updated.docs[selectedPageIdx].layout[blockIdx] as any;
    block[nestedField][index][field] = value;
    setPagesData(updated);
  };

  const addBlock = (type: string) => {
    const updated = { ...pagesData };
    let newBlock: Block = { blockType: type };
    if (type === 'hero') {
      newBlock = {
        blockType: 'hero',
        title: 'Nouveau titre Hero',
        subtitle: 'Une description intéressante ici.',
        ctaText: 'Bouton d\'action',
        backgroundImage: ''
      };
    } else if (type === 'features') {
      newBlock = {
        blockType: 'features',
        title: 'Nos Services',
        items: [
          { title: 'Service 1', description: 'Description du service 1.' },
          { title: 'Service 2', description: 'Description du service 2.' }
        ]
      };
    } else if (type === 'product-grid') {
      newBlock = {
        blockType: 'product-grid',
        title: 'Produits Disponibles',
        products: [
          { name: 'Produit A', price: '10.00 €', image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=300' }
        ]
      };
    } else if (type === 'gallery') {
      newBlock = {
        blockType: 'gallery',
        title: 'Galerie Photos',
        images: [
          'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=300',
          'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=300'
        ]
      };
    }
    updated.docs[selectedPageIdx].layout.push(newBlock);
    savePages(updated);
  };

  const removeBlock = (blockIdx: number) => {
    const updated = { ...pagesData };
    updated.docs[selectedPageIdx].layout.splice(blockIdx, 1);
    savePages(updated);
    if (editingBlockIdx === blockIdx) {
      setEditingBlockIdx(null);
    }
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const updated = { ...pagesData };
    const layout = updated.docs[selectedPageIdx].layout;
    if (direction === 'up' && index > 0) {
      const temp = layout[index];
      layout[index] = layout[index - 1];
      layout[index - 1] = temp;
    } else if (direction === 'down' && index < layout.length - 1) {
      const temp = layout[index];
      layout[index] = layout[index + 1];
      layout[index + 1] = temp;
    }
    savePages(updated);
  };

  const activePage = pagesData.docs[selectedPageIdx];

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-container">
          <div className="logo-icon">M</div>
          <div>
            <h1 className="logo-text">MetaSite Builder</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI-Driven Composable SaaS</span>
          </div>
        </div>
        <nav className="nav-tabs">
          <button 
            className={`nav-tab ${activeTab === 'onboarding' ? 'active' : ''}`}
            onClick={() => setActiveTab('onboarding')}
          >
            <SparklesIcon /> Onboarding IA
          </button>
          <button 
            className={`nav-tab ${activeTab === 'design' ? 'active' : ''}`}
            onClick={() => setActiveTab('design')}
          >
            <PaletteIcon /> Design Prédictif
          </button>
          <button 
            className={`nav-tab ${activeTab === 'cms' ? 'active' : ''}`}
            onClick={() => setActiveTab('cms')}
          >
            <BlocksIcon /> Éditeur de Blocs (CMS)
          </button>
          <button 
            className={`nav-tab ${activeTab === 'deploy' ? 'active' : ''}`}
            onClick={() => setActiveTab('deploy')}
          >
            <CpuIcon /> Déploiement o2switch
            {buildStatus.inProgress && <span className="indicator-live pulse-glow" style={{ background: '#10b981', width: 8, height: 8, borderRadius: '50%', marginLeft: 4 }}></span>}
          </button>
        </nav>
      </header>

      {/* Main Content */}
      <main className="main-content">
        
        {/* TAB 1: ONBOARDING IA */}
        {activeTab === 'onboarding' && (
          <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div className="glass-panel">
              <h2 style={{ marginBottom: 15, fontSize: '1.75rem' }}>1. Décrivez votre projet en langage naturel</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
                Notre moteur d'intelligence artificielle analyse votre besoin fonctionnel pour déterminer dynamiquement l'infrastructure optimale et la stack à provisionner sur o2switch.
              </p>
              <textarea 
                className="input-text"
                rows={4}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Exemple: Je veux un portfolio pour mes photos d'art avec une galerie et une page de contact..."
              />
              <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                <button 
                  className="btn btn-primary" 
                  onClick={handleOnboard}
                  disabled={onboardingLoading}
                >
                  {onboardingLoading ? 'Analyse LLM en cours...' : 'Générer l\'Architecture & la Stack'}
                </button>
              </div>
            </div>

            {onboardingResult && (
              <div className="grid-2col animate-slide">
                {/* Stack selection Card */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                    🛠️ Spécifications techniques déduites
                  </h3>
                  <div>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Nom du Site Extrait :</span>
                    <h2 style={{ color: 'white', marginTop: 4 }}>{onboardingResult.site_name}</h2>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Fonctionnalités requises :</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: onboardingResult.features.blog_or_news ? 'var(--accent-emerald)' : '#ef4444' }}>
                          {onboardingResult.features.blog_or_news ? '● Actif' : '○ Inactif'}
                        </span>
                        <span>Contenu Dynamique / Blog</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: onboardingResult.features.e_commerce ? 'var(--accent-emerald)' : '#ef4444' }}>
                          {onboardingResult.features.e_commerce ? '● Actif' : '○ Inactif'}
                        </span>
                        <span>Vente E-commerce</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: onboardingResult.features.multi_store ? 'var(--accent-emerald)' : '#ef4444' }}>
                          {onboardingResult.features.multi_store ? '● Actif' : '○ Inactif'}
                        </span>
                        <span>Multi-boutique & Stocks complexes</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Architecture Client o2switch :</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', padding: '4px 10px', borderRadius: 4, fontSize: '0.875rem' }}>
                        Astro: Mode {onboardingResult.stack_requirements.astro_mode.toUpperCase()}
                      </span>
                      {onboardingResult.stack_requirements.need_payload && (
                        <span className="badge" style={{ background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.3)', padding: '4px 10px', borderRadius: 4, fontSize: '0.875rem' }}>
                          Payload CMS (1 Processus Node)
                        </span>
                      )}
                      {onboardingResult.stack_requirements.need_medusajs && (
                        <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '4px 10px', borderRadius: 4, fontSize: '0.875rem' }}>
                          MedusaJS API (1 Processus Node)
                        </span>
                      )}
                      {onboardingResult.stack_requirements.need_stripe && (
                        <span className="badge" style={{ background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', padding: '4px 10px', borderRadius: 4, fontSize: '0.875rem' }}>
                          Intégration Stripe Checkout
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Routing Rules Card */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                    ⚡ Routage d'Infrastructure Intelligent
                  </h3>
                  <p style={{ fontSize: '0.95rem' }}>
                    Le système applique la règle d'optimisation de ressources o2switch suivante :
                  </p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ 
                      padding: 12, 
                      borderRadius: 8, 
                      background: onboardingResult.stack_requirements.astro_mode === 'ssg' && !onboardingResult.stack_requirements.need_payload ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                      border: onboardingResult.stack_requirements.astro_mode === 'ssg' && !onboardingResult.stack_requirements.need_payload ? '1px solid var(--accent-blue)' : '1px solid transparent'
                    }}>
                      <strong>Landing Page Simple (Astro SSG)</strong>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>0 processus Node actif en continu. Pages 100% statiques. Fichiers plats légers. Consommation serveur nulle.</p>
                    </div>

                    <div style={{ 
                      padding: 12, 
                      borderRadius: 8, 
                      background: onboardingResult.stack_requirements.astro_mode === 'ssg' && onboardingResult.stack_requirements.need_payload && !onboardingResult.stack_requirements.need_medusajs ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                      border: onboardingResult.stack_requirements.astro_mode === 'ssg' && onboardingResult.stack_requirements.need_payload && !onboardingResult.stack_requirements.need_medusajs ? '1px solid var(--accent-blue)' : '1px solid transparent'
                    }}>
                      <strong>Site Vitrine Administrable (Astro SSG + Payload CMS)</strong>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>1 processus Node.js actif. Recompilation statique déclenchée via webhook lors de la modification de contenu.</p>
                    </div>

                    <div style={{ 
                      padding: 12, 
                      borderRadius: 8, 
                      background: onboardingResult.stack_requirements.astro_mode === 'hybrid' ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                      border: onboardingResult.stack_requirements.astro_mode === 'hybrid' ? '1px solid var(--accent-blue)' : '1px solid transparent'
                    }}>
                      <strong>Commerce Complexe (Astro Hybride + Payload + MedusaJS)</strong>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>2 processus Node.js actifs. Rendu hybride ultrarapide : pages statiques pré-rendues combinées à des requêtes API clients vers Medusa pour les stocks temps réel.</p>
                    </div>
                  </div>

                  <button className="btn btn-primary" style={{ marginTop: 'auto' }} onClick={() => setActiveTab('design')}>
                    Étape suivante : Personnaliser le Design →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: DESIGN PREDICTIF */}
        {activeTab === 'design' && (
          <div className="animate-slide grid-2col">
            {/* Design Extractor Control */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h2 style={{ fontSize: '1.75rem' }}>2. Design Prédictif & Extraction Graphique</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                Simulez l'analyse visuelle d'un logo ou d'une capture d'écran téléchargée en choisissant une ambiance de design ci-dessous :
              </p>

              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: 8 }}>
                  Sélectionner une ambiance visuelle (Simulation Vision LLM)
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button 
                    onClick={() => applyAmbiance('chaleureux')} 
                    className={`btn ${selectedAmbiance === 'chaleureux' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    🍞 Boulangerie / Chaleureux
                  </button>
                  <button 
                    onClick={() => applyAmbiance('nature')} 
                    className={`btn ${selectedAmbiance === 'nature' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    🌿 Éco / Nature / Vert
                  </button>
                  <button 
                    onClick={() => applyAmbiance('techno')} 
                    className={`btn ${selectedAmbiance === 'techno' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    ⚡ SaaS / Techno / Sombre
                  </button>
                  <button 
                    onClick={() => applyAmbiance('minimal')} 
                    className={`btn ${selectedAmbiance === 'minimal' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    ⚫ Studio / Minimaliste / Noir
                  </button>
                </div>
              </div>

              {/* Theme Variable Customizers */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 15, borderTop: '1px solid var(--border-color)', paddingTop: 15 }}>
                <h3 style={{ fontSize: '1.1rem' }}>Ajustement manuel des variables de thème</h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Couleur Primaire</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input 
                        type="color" 
                        value={theme.colors.primary} 
                        onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, primary: e.target.value } })}
                        style={{ border: 'none', background: 'none', width: 32, height: 32, cursor: 'pointer' }}
                      />
                      <input 
                        type="text" 
                        value={theme.colors.primary} 
                        onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, primary: e.target.value } })}
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: '4px 8px', borderRadius: 4, width: '100%' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Couleur Secondaire</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input 
                        type="color" 
                        value={theme.colors.secondary} 
                        onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, secondary: e.target.value } })}
                        style={{ border: 'none', background: 'none', width: 32, height: 32, cursor: 'pointer' }}
                      />
                      <input 
                        type="text" 
                        value={theme.colors.secondary} 
                        onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, secondary: e.target.value } })}
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: '4px 8px', borderRadius: 4, width: '100%' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Couleur de Fond</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input 
                        type="color" 
                        value={theme.colors.background} 
                        onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, background: e.target.value } })}
                        style={{ border: 'none', background: 'none', width: 32, height: 32, cursor: 'pointer' }}
                      />
                      <input 
                        type="text" 
                        value={theme.colors.background} 
                        onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, background: e.target.value } })}
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: '4px 8px', borderRadius: 4, width: '100%' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Couleur du Texte</label>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input 
                        type="color" 
                        value={theme.colors.text} 
                        onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, text: e.target.value } })}
                        style={{ border: 'none', background: 'none', width: 32, height: 32, cursor: 'pointer' }}
                      />
                      <input 
                        type="text" 
                        value={theme.colors.text} 
                        onChange={(e) => setTheme({ ...theme, colors: { ...theme.colors, text: e.target.value } })}
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: '4px 8px', borderRadius: 4, width: '100%' }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Police Titre</label>
                    <select 
                      value={theme.fonts.heading}
                      onChange={(e) => setTheme({ ...theme, fonts: { ...theme.fonts, heading: e.target.value } })}
                      style={{ width: '100%', background: '#0f172a', border: '1px solid var(--border-color)', color: 'white', padding: 8, borderRadius: 4 }}
                    >
                      <option value="Playfair Display">Playfair Display</option>
                      <option value="Outfit">Outfit</option>
                      <option value="Space Grotesk">Space Grotesk</option>
                      <option value="Lora">Lora</option>
                      <option value="Inter">Inter</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Police Corps</label>
                    <select 
                      value={theme.fonts.body}
                      onChange={(e) => setTheme({ ...theme, fonts: { ...theme.fonts, body: e.target.value } })}
                      style={{ width: '100%', background: '#0f172a', border: '1px solid var(--border-color)', color: 'white', padding: 8, borderRadius: 4 }}
                    >
                      <option value="Inter">Inter</option>
                      <option value="DM Sans">DM Sans</option>
                      <option value="Karla">Karla</option>
                      <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Bordures arrondies (border-radius)</label>
                  <input 
                    type="text" 
                    value={theme.radius} 
                    onChange={(e) => setTheme({ ...theme, radius: e.target.value })}
                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', color: 'white', padding: 8, borderRadius: 4 }}
                    placeholder="e.g. 8px, 12px, 0px"
                  />
                </div>
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', gap: 10 }}>
                <button className="btn btn-primary" onClick={saveTheme} disabled={designSaving}>
                  {designSaving ? 'Enregistrement...' : 'Enregistrer le Thème'}
                </button>
                <button className="btn btn-secondary" onClick={() => setActiveTab('cms')}>
                  Passer à l'Éditeur de Pages →
                </button>
              </div>
            </div>

            {/* Design Extractor Preview */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                🎨 Rendu en direct des tokens CSS
              </h3>
              
              <div 
                style={{
                  backgroundColor: theme.colors.background,
                  color: theme.colors.text,
                  borderRadius: theme.radius,
                  fontFamily: `'${theme.fonts.body}', sans-serif`,
                  padding: 30,
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                  border: '1px solid rgba(0,0,0,0.1)',
                  minHeight: 350
                }}
              >
                <h2 style={{ fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text, border: 'none', padding: 0 }}>
                  Aperçu de Titre de Page
                </h2>
                <p>
                  Ce paragraphe utilise la police de corps <strong>{theme.fonts.body}</strong>. Les composants du site respectent les tokens générés de manière étanche.
                </p>
                <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
                  <button 
                    style={{
                      backgroundColor: theme.colors.primary,
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: theme.radius,
                      padding: '10px 20px',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    Bouton Primaire
                  </button>
                  <button 
                    style={{
                      backgroundColor: theme.colors.secondary,
                      color: theme.colors.text,
                      border: `1px solid ${theme.colors.primary}33`,
                      borderRadius: theme.radius,
                      padding: '10px 20px',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    Bouton Secondaire
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: BLOCKS BUILDER (CMS) */}
        {activeTab === 'cms' && (
          <div className="animate-slide" style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '30px', alignItems: 'start' }}>
            
            {/* Blocks List & Settings */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
              <h2 style={{ fontSize: '1.5rem' }}>🗃️ CMS Blocks (Payload) {cmsSaving && <span style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', marginLeft: 10 }}>💾 Enregistrement...</span>}</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Configurez les sections de votre page. Modifiez leur ordre et leur contenu. Les modifications sont enregistrées sur le serveur local.
              </p>

              {activePage && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {activePage.layout.map((block, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        background: editingBlockIdx === idx ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255,255,255,0.02)',
                        border: editingBlockIdx === idx ? '1px solid var(--accent-blue)' : '1px solid var(--border-color)',
                        borderRadius: 8,
                        padding: 12
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <strong style={{ textTransform: 'capitalize', fontSize: '0.95rem' }}>
                          {idx + 1}. {block.blockType}
                        </strong>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => moveBlock(idx, 'up')} disabled={idx === 0} style={{ padding: 4, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>▲</button>
                          <button onClick={() => moveBlock(idx, 'down')} disabled={idx === activePage.layout.length - 1} style={{ padding: 4, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>▼</button>
                          <button onClick={() => removeBlock(idx)} style={{ padding: 4, background: 'none', border: 'none', color: 'var(--accent-rose)', cursor: 'pointer' }}>✕</button>
                        </div>
                      </div>

                      {/* Champs d'édition rapides pour le bloc sélectionné */}
                      {editingBlockIdx === idx ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                          {block.blockType === 'hero' && (
                            <>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Titre Hero</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.title || ''} onChange={(e) => handleBlockChange(idx, 'title', e.target.value)} />
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sous-titre</label>
                              <textarea className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.subtitle || ''} onChange={(e) => handleBlockChange(idx, 'subtitle', e.target.value)} />
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Texte Bouton</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.ctaText || ''} onChange={(e) => handleBlockChange(idx, 'ctaText', e.target.value)} />
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Image de Fond (URL)</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.backgroundImage || ''} onChange={(e) => handleBlockChange(idx, 'backgroundImage', e.target.value)} />
                            </>
                          )}

                          {block.blockType === 'features' && (
                            <>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Titre du Bloc</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.title || ''} onChange={(e) => handleBlockChange(idx, 'title', e.target.value)} />
                              {block.items && block.items.map((item, itemIdx) => (
                                <div key={itemIdx} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Élément {itemIdx+1}</label>
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} value={item.title} onChange={(e) => handleBlockNestedChange(idx, 'items', itemIdx, 'title', e.target.value)} />
                                  <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} value={item.description} onChange={(e) => handleBlockNestedChange(idx, 'items', itemIdx, 'description', e.target.value)} />
                                </div>
                              ))}
                            </>
                          )}

                          {block.blockType === 'product-grid' && (
                            <>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Titre du Bloc</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.title || ''} onChange={(e) => handleBlockChange(idx, 'title', e.target.value)} />
                              {block.products && block.products.map((prod, prodIdx) => (
                                <div key={prodIdx} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Produit {prodIdx+1}</label>
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} value={prod.name} onChange={(e) => handleBlockNestedChange(idx, 'products', prodIdx, 'name', e.target.value)} />
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} value={prod.price} onChange={(e) => handleBlockNestedChange(idx, 'products', prodIdx, 'price', e.target.value)} />
                                </div>
                              ))}
                            </>
                          )}

                          {block.blockType === 'gallery' && (
                            <>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Titre du Bloc</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.title || ''} onChange={(e) => handleBlockChange(idx, 'title', e.target.value)} />
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Images pré-chargées.</span>
                            </>
                          )}

                          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.875rem', marginTop: 5 }} onClick={() => { savePages(pagesData); setEditingBlockIdx(null); }}>
                            Fermer & Sauvegarder
                          </button>
                        </div>
                      ) : (
                        <button 
                          className="btn btn-secondary" 
                          style={{ width: '100%', padding: '6px 10px', fontSize: '0.8rem', display: 'block', textAlign: 'center', marginTop: 6 }}
                          onClick={() => setEditingBlockIdx(idx)}
                        >
                          Éditer le contenu
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Ajouter des blocs */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 15, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ajouter un bloc :</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button className="btn btn-secondary" style={{ padding: 8, fontSize: '0.8rem' }} onClick={() => addBlock('hero')}>+ Hero</button>
                  <button className="btn btn-secondary" style={{ padding: 8, fontSize: '0.8rem' }} onClick={() => addBlock('features')}>+ Features</button>
                  <button className="btn btn-secondary" style={{ padding: 8, fontSize: '0.8rem' }} onClick={() => addBlock('product-grid')}>+ ProductGrid</button>
                  <button className="btn btn-secondary" style={{ padding: 8, fontSize: '0.8rem' }} onClick={() => addBlock('gallery')}>+ Gallery</button>
                </div>
              </div>

              <button className="btn btn-primary" style={{ marginTop: 15 }} onClick={() => setActiveTab('deploy')}>
                Passer au Déploiement o2switch →
              </button>
            </div>

            {/* Live Visual WYSIWYG Page Preview */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                <h3>🖥️ Rendu Client en direct (Astro preview)</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--accent-emerald)' }}>● Synchronisation active</span>
              </div>

              {/* simulated browser canvas utilizing theme values */}
              <div 
                className="simulated-browser"
                style={{
                  backgroundColor: theme.colors.background,
                  color: theme.colors.text,
                  borderRadius: 12,
                  fontFamily: `'${theme.fonts.body}', sans-serif`,
                  border: '1px solid rgba(0,0,0,0.15)',
                  overflow: 'hidden',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                  minHeight: 500,
                }}
              >
                {activePage && activePage.layout.map((block, index) => {
                  if (block.blockType === 'hero') {
                    return (
                      <div 
                        key={index}
                        style={{
                          backgroundColor: theme.colors.primary,
                          color: '#ffffff',
                          backgroundImage: block.backgroundImage ? `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url(${block.backgroundImage})` : 'none',
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          padding: '60px 20px',
                          textAlign: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          minHeight: '280px'
                        }}
                      >
                        <h1 style={{ color: '#ffffff', fontFamily: `'${theme.fonts.heading}', serif`, fontSize: '2.5rem', marginBottom: 12 }}>
                          {block.title}
                        </h1>
                        <p style={{ color: theme.colors.secondary, fontSize: '1.1rem', maxWidth: 600, marginBottom: 20 }}>
                          {block.subtitle}
                        </p>
                        {block.ctaText && (
                          <button style={{ backgroundColor: theme.colors.secondary, color: theme.colors.text, border: 'none', borderRadius: theme.radius, padding: '10px 20px', fontWeight: 600 }}>
                            {block.ctaText}
                          </button>
                        )}
                      </div>
                    );
                  }

                  if (block.blockType === 'features') {
                    return (
                      <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.background }}>
                        <h2 style={{ textAlign: 'center', marginBottom: 30, fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text }}>
                          {block.title}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                          {block.items && block.items.map((item, subIdx) => (
                            <div key={subIdx} style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.05)', padding: 20, borderRadius: theme.radius, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                              <h3 style={{ color: theme.colors.text, fontSize: '1.1rem', marginBottom: 8 }}>{item.title}</h3>
                              <p style={{ color: '#666', fontSize: '0.85rem' }}>{item.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  if (block.blockType === 'product-grid') {
                    return (
                      <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.secondary + '22' }}>
                        <h2 style={{ textAlign: 'center', marginBottom: 30, fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text }}>
                          {block.title}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                          {block.products && block.products.map((prod, subIdx) => (
                            <div key={subIdx} style={{ background: '#ffffff', borderRadius: theme.radius, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' }}>
                              <img src={prod.image} alt={prod.name} style={{ width: '100%', height: '140px', objectFit: 'cover' }} />
                              <div style={{ padding: 15 }}>
                                <h4 style={{ color: theme.colors.text, marginBottom: 4 }}>{prod.name}</h4>
                                <span style={{ color: theme.colors.primary, fontWeight: 700 }}>{prod.price}</span>
                                <button style={{ width: '100%', border: 'none', background: theme.colors.primary, color: 'white', borderRadius: theme.radius, padding: '6px', marginTop: 10, cursor: 'pointer', fontSize: '0.85rem' }}>Acheter</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  if (block.blockType === 'gallery') {
                    return (
                      <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.background }}>
                        <h2 style={{ textAlign: 'center', marginBottom: 30, fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text }}>
                          {block.title}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                          {block.images && block.images.map((img, subIdx) => (
                            <div key={subIdx} style={{ height: 100, overflow: 'hidden', borderRadius: theme.radius }}>
                              <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </div>

          </div>
        )}

        {/* TAB 4: DEPLOYMENT o2switch (WEBHOOK & LOCKFILE) */}
        {activeTab === 'deploy' && (
          <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div className="grid-2col">
              
              {/* Deploy Controls */}
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <h2 style={{ fontSize: '1.75rem' }}>4. Pipeline de compilation & Déploiement</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                  Le déploiement déclenche la recompilation statique d'Astro via un webhook sécurisé. Pour gérer les limites de ressources de l'hébergement o2switch, un verrou (Lockfile) physique bloque les compilations concurrentes.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 8, border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Statut du Build :</span>
                    <span style={{ 
                      color: buildStatus.status === 'running' ? 'var(--accent-blue)' : 
                             buildStatus.status === 'success' ? 'var(--accent-emerald)' : 
                             buildStatus.status === 'error' ? 'var(--accent-rose)' : 'var(--text-muted)',
                      fontWeight: 'bold',
                      textTransform: 'uppercase'
                    }}>
                      {buildStatus.status}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Verrou cPanel (`build.lock`) :</span>
                    <span style={{ 
                      color: buildStatus.lockExists ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                      fontWeight: 'bold'
                    }}>
                      {buildStatus.lockExists ? '🔒 POSÉ (Verrouillé)' : '🔓 LIBRE (Prêt)'}
                    </span>
                  </div>

                  {buildStatus.lastCompleted && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <span>Dernier succès :</span>
                      <span>{buildStatus.lastCompleted}</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={triggerDeploy}
                    disabled={buildStatus.inProgress || deployLoading}
                    style={{ width: '100%' }}
                  >
                    {buildStatus.inProgress ? 'Compilation Astro en cours...' : '🚀 Lancer la Recompilation (Webhook)'}
                  </button>

                  <button 
                    className="btn btn-secondary" 
                    onClick={simulateConcurrency}
                    disabled={buildStatus.inProgress || deployLoading}
                    style={{ width: '100%', borderColor: 'rgba(244,63,94,0.3)', color: '#fca5a5' }}
                  >
                    ⚡ Simuler Surcharge (Double-Clic Concurrence)
                  </button>
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: 15 }}>
                  <strong>Note technique :</strong> Le dossier compilé final sera copié dans <code>/simulated_public_html</code> du projet, ce qui correspond au dossier de distribution de production o2switch.
                </div>
              </div>

              {/* Webhook logs Console */}
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <h3 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                  📄 Console de logs en direct
                </h3>
                <div className="terminal">
                  {buildStatus.logs || 'Console initialisée. En attente de build...'}
                  <div ref={logsEndRef} />
                </div>
              </div>

            </div>
          </div>
        )}

      </main>
    </div>
  );
}

// Inline SVGs for beautiful look without assets issues
function SparklesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v16M19 12H5M18.4 5.6l-12.8 12.8M18.4 18.4L5.6 5.6"/>
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.92 0 1.63-.77 1.63-1.7 0-.42-.16-.82-.44-1.12-.27-.29-.44-.68-.44-1.11 0-.97.77-1.76 1.76-1.76H16c4.42 0 8-3.58 8-8 0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

function BlocksIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );
}

function CpuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
      <rect x="9" y="9" width="6" height="6"/>
      <line x1="9" y1="1" x2="9" y2="4"/>
      <line x1="15" y1="1" x2="15" y2="4"/>
      <line x1="9" y1="20" x2="9" y2="23"/>
      <line x1="15" y1="20" x2="15" y2="23"/>
      <line x1="20" y1="9" x2="23" y2="9"/>
      <line x1="20" y1="15" x2="23" y2="15"/>
      <line x1="1" y1="9" x2="4" y2="9"/>
      <line x1="1" y1="15" x2="4" y2="15"/>
    </svg>
  );
}
