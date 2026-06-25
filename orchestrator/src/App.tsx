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
  items?: { title?: string; description?: string; question?: string; answer?: string }[];
  products?: { name: string; price: string; image: string }[];
  images?: string[];
  testimonials?: { quote: string; author: string; role: string; avatar: string }[];
  plans?: {
    name: string;
    price: string;
    description: string;
    features: { feature: string }[];
    ctaText: string;
    isPopular: boolean;
  }[];
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
  buildingSite?: string | null;
}

const BACKEND_URL = 'http://localhost:4000';

export default function App() {
  const [activeTab, setActiveTab] = useState<'cpanel' | 'onboarding' | 'design' | 'cms' | 'deploy'>('cpanel');

  // --- STATE CPANEL ---
  const [sites, setSites] = useState<any[]>([]);
  const [activeSiteSlug, setActiveSiteSlug] = useState<string>('');
  const [scannedSites, setScannedSites] = useState<any[]>([]);
  const [scanningLoading, setScanningLoading] = useState(false);
  const [scanPath, setScanPath] = useState('simulated_public_html');
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteDomain, setNewSiteDomain] = useState('');
  const [newSiteStack, setNewSiteStack] = useState('Astro SSG');
  const [newSiteDocumentRoot, setNewSiteDocumentRoot] = useState('');
  const [newSiteRepositoryPath, setNewSiteRepositoryPath] = useState('');
  const [showAdvancedCreate, setShowAdvancedCreate] = useState(false);
  const [newSiteLoading, setNewSiteLoading] = useState(false);
  const [deleteFilesOnRemove, setDeleteFilesOnRemove] = useState(true);

  // Edit Site Modal State
  const [editSite, setEditSite] = useState<any | null>(null);
  const [editSiteName, setEditSiteName] = useState('');
  const [editSiteDomain, setEditSiteDomain] = useState('');
  const [editSiteDocumentRoot, setEditSiteDocumentRoot] = useState('');
  const [editSiteRepositoryPath, setEditSiteRepositoryPath] = useState('');
  const [editSiteStack, setEditSiteStack] = useState('Astro SSG');
  const [editSiteLoading, setEditSiteLoading] = useState(false);

  // File Manager Modal State
  const [fileManagerSite, setFileManagerSite] = useState<any | null>(null);
  const [fileManagerType, setFileManagerType] = useState<'documentRoot' | 'repository'>('documentRoot');
  const [fileList, setFileList] = useState<any[]>([]);
  const [fileListLoading, setFileListLoading] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [selectedFileLoading, setSelectedFileLoading] = useState(false);

  // --- STATE ONBOARDING ---
  const [siteName, setSiteName] = useState('Boulangerie Artisanale');
  const [activityDescription, setActivityDescription] = useState('Des pains croustillants et des viennoiseries pur beurre cuits sur place tous les jours.');
  const [onboardFeatures, setOnboardFeatures] = useState<FeatureFlags>({
    blog_or_news: false,
    e_commerce: true,
    multi_store: false
  });
  const [onboardAmbiance, setOnboardAmbiance] = useState<string>('chaleureux');
  const [inspirationUrl, setInspirationUrl] = useState('');
  const [inspirationSourceType, setInspirationSourceType] = useState<'preset' | 'image'>('preset');
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
  const [designSaving, setDesignSaving] = useState(false);
  const [aiProvider, setAiProvider] = useState<'openai' | 'anthropic' | 'gemini'>('openai');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [savedTheme, setSavedTheme] = useState<Theme | null>(null);
  const [availableProviders, setAvailableProviders] = useState<{openai: boolean; anthropic: boolean; gemini: boolean}>({ openai: true, anthropic: true, gemini: true });

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
    logs: '',
    buildingSite: null
  });
  const [deployLoading, setDeployLoading] = useState(false);
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial data
  useEffect(() => {
    fetchConfig();
    fetchSites();
    fetchBuildStatus();

    // Poll build status every 2 seconds
    const interval = setInterval(fetchBuildStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeSiteSlug) {
      fetchTheme();
      fetchPages();
    }
  }, [activeSiteSlug]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildStatus.logs]);

  const fetchSites = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sites`);
      if (res.ok) {
        const data = await res.json();
        setSites(data);
        if (data.length > 0 && !activeSiteSlug) {
          setActiveSiteSlug(data[0].slug);
        }
      }
    } catch (e) {
      console.error("Impossible de récupérer la liste des sites", e);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/config`);
      if (res.ok) {
        const data = await res.json();
        setAvailableProviders(data.availableProviders);
        const providers = data.availableProviders;
        if (providers[data.defaultProvider]) {
          setAiProvider(data.defaultProvider);
        } else {
          const firstAvailable = Object.keys(providers).find(k => providers[k as keyof typeof providers]);
          if (firstAvailable) {
            setAiProvider(firstAvailable as any);
          }
        }
      }
    } catch (e) {
      console.error("Impossible de récupérer la config du serveur", e);
    }
  };

  const fetchTheme = async () => {
    if (!activeSiteSlug) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/theme?site=${activeSiteSlug}`);
      if (res.ok) {
        const data = await res.json();
        const themeVal = data.theme ? data.theme : defaultThemeMock;
        setTheme(themeVal);
        setSavedTheme(themeVal);
      }
    } catch (e) {
      console.error("Impossible de récupérer le thème", e);
    }
  };

  const fetchPages = async () => {
    if (!activeSiteSlug) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/pages?site=${activeSiteSlug}`);
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

  // Re-load file manager list when type or site slug changes
  useEffect(() => {
    if (fileManagerSite) {
      const reloadFiles = async () => {
        setFileListLoading(true);
        setSelectedFileContent(null);
        setSelectedFilePath(null);
        try {
          const res = await fetch(`${BACKEND_URL}/api/sites/${fileManagerSite.slug}/files?type=${fileManagerType}`);
          if (res.ok) {
            const data = await res.json();
            setFileList(data);
          }
        } catch (e) {
          console.error("Erreur de rechargement des fichiers", e);
        } finally {
          setFileListLoading(false);
        }
      };
      reloadFiles();
    }
  }, [fileManagerType, fileManagerSite?.slug]);

  const openFileManager = async (site: any, type: 'documentRoot' | 'repository' = 'documentRoot') => {
    setFileManagerSite(site);
    setFileManagerType(type);
    setFileListLoading(true);
    setSelectedFileContent(null);
    setSelectedFilePath(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sites/${site.slug}/files?type=${type}`);
      if (res.ok) {
        const data = await res.json();
        setFileList(data);
      }
    } catch (e) {
      console.error("Erreur de chargement des fichiers", e);
    } finally {
      setFileListLoading(false);
    }
  };

  const viewFile = async (filePath: string) => {
    if (!fileManagerSite) return;
    setSelectedFilePath(filePath);
    setSelectedFileLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sites/${fileManagerSite.slug}/files/view?path=${encodeURIComponent(filePath)}&type=${fileManagerType}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedFileContent(data.content);
      } else {
        setSelectedFileContent("Impossible d'afficher le contenu (binaire ou fichier trop volumineux).");
      }
    } catch (e) {
      setSelectedFileContent("Erreur de lecture du fichier.");
    } finally {
      setSelectedFileLoading(false);
    }
  };

  const deleteSite = async (slug: string, deleteFiles: boolean) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le site "${slug}" ?`)) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/sites/${slug}?deleteFiles=${deleteFiles}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        alert("Site supprimé avec succès de la base cPanel.");
        fetchSites();
        if (activeSiteSlug === slug) {
          setActiveSiteSlug('');
        }
      }
    } catch (e) {
      alert("Erreur lors de la suppression du site.");
    }
  };

  const handleEditClick = (site: any) => {
    setEditSite(site);
    setEditSiteName(site.name);
    setEditSiteDomain(site.domain);
    setEditSiteDocumentRoot(site.documentRoot);
    setEditSiteRepositoryPath(site.repositoryPath || '');
    setEditSiteStack(site.stack);
  };

  const saveEditSite = async () => {
    if (!editSite) return;
    setEditSiteLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sites/${editSite.slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editSiteName,
          domain: editSiteDomain,
          documentRoot: editSiteDocumentRoot,
          repositoryPath: editSiteRepositoryPath,
          stack: editSiteStack
        })
      });
      if (res.ok) {
        alert("Configuration du site mise à jour avec succès.");
        setEditSite(null);
        fetchSites();
      } else {
        const err = await res.json();
        alert(`Erreur : ${err.error}`);
      }
    } catch (e) {
      alert("Erreur de mise à jour.");
    } finally {
      setEditSiteLoading(false);
    }
  };

  const scanSites = async () => {
    setScanningLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sites/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanPath })
      });
      if (res.ok) {
        const data = await res.json();
        setScannedSites(data);
        if (data.length === 0) {
          alert("Aucun nouveau site détecté dans le répertoire spécifié.");
        }
      } else {
        const err = await res.json();
        alert(`Erreur : ${err.error}`);
      }
    } catch (e) {
      alert("Erreur lors du scan.");
    } finally {
      setScanningLoading(false);
    }
  };

  const importSite = async (scanned: any) => {
    const stack = prompt("Stack technique de ce site :", scanned.stack || "HTML statique");
    if (stack === null) return;
    const docRoot = prompt("Chemin Document Root :", scanned.documentRoot);
    if (docRoot === null) return;
    const repoPath = prompt("Chemin Repository (CMS/Back-end - Optionnel) :", scanned.repositoryPath || "");
    if (repoPath === null) return;

    try {
      const res = await fetch(`${BACKEND_URL}/api/sites/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ...scanned, 
          stack, 
          documentRoot: docRoot, 
          repositoryPath: repoPath 
        })
      });
      if (res.ok) {
        alert(`Site "${scanned.name}" importé avec succès dans cPanel !`);
        fetchSites();
        setScannedSites(scannedSites.filter(s => s.slug !== scanned.slug));
      }
    } catch (e) {
      alert("Erreur lors de l'importation.");
    }
  };

  const createSite = async () => {
    if (!newSiteName) return alert("Le nom du site est requis.");
    setNewSiteLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: newSiteName, 
          domain: newSiteDomain, 
          stack: newSiteStack,
          documentRoot: newSiteDocumentRoot || undefined,
          repositoryPath: newSiteRepositoryPath || undefined
        })
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Site "${data.site.name}" créé avec succès !`);
        setNewSiteName('');
        setNewSiteDomain('');
        setNewSiteDocumentRoot('');
        setNewSiteRepositoryPath('');
        setShowAdvancedCreate(false);
        fetchSites();
        setActiveSiteSlug(data.site.slug);
        setActiveTab('design');
      } else {
        const err = await res.json();
        alert(`Erreur : ${err.error}`);
      }
    } catch (e) {
      alert("Erreur lors de la création du site.");
    } finally {
      setNewSiteLoading(false);
    }
  };

  const handleOnboard = async () => {
    setOnboardingLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: siteName,
          description: activityDescription,
          features: onboardFeatures,
          ambiance: inspirationSourceType === 'preset' ? onboardAmbiance : undefined,
          image: inspirationSourceType === 'image' ? uploadedImage : undefined,
          inspirationUrl: inspirationUrl || undefined,
          provider: aiProvider 
        })
      });
      if (res.ok) {
        const data = await res.json();
        setOnboardingResult(data.qualification);
        setPagesData(data.pages);
        if (data.theme) {
          setTheme(data.theme);
          setSavedTheme(data.theme);
        }
        if (data.site) {
          fetchSites();
          setActiveSiteSlug(data.site.slug);
        }
        alert(`✨ Le site "${data.site ? data.site.name : siteName}" et son design graphique ont été créés avec succès par l'IA !`);
      } else {
        const errData = await res.json();
        alert(`Erreur IA : ${errData.error || 'Erreur lors de la qualification.'}`);
      }
    } catch (e) {
      alert("Erreur lors de la qualification. Assurez-vous que le serveur Express tourne sur le port 4000 et que vos clés API sont configurées.");
    } finally {
      setOnboardingLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      setUploadedImage(base64String);
    };
    reader.readAsDataURL(file);
  };

  const saveTheme = async () => {
    if (!activeSiteSlug) return;
    setDesignSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/theme?site=${activeSiteSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme })
      });
      if (res.ok) {
        setSavedTheme(theme);
        alert("Thème enregistré et appliqué aux fichiers Astro client-template/src/styles/theme.css !");
      }
    } catch (e) {
      alert("Erreur lors de la sauvegarde du thème.");
    } finally {
      setDesignSaving(false);
    }
  };

  const resetTheme = () => {
    if (savedTheme) {
      setTheme(savedTheme);
      setUploadedImage(null);
    }
  };

  const savePages = async (updatedData: PagesData) => {
    if (!activeSiteSlug) return;
    setCmsSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/pages?site=${activeSiteSlug}`, {
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
    if (!activeSiteSlug) return;
    setDeployLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/webhook/rebuild?site=${activeSiteSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.status === 429) {
        alert("🔒 Build refusé : Un build est déjà en cours ! Le système de verrouillage (lockfile) a correctement bloqué la requête concurrente.");
      } else if (res.ok) {
        fetchBuildStatus();
      }
    } catch (e) {
      alert("Impossible de contacter le webhook de build.");
    } finally {
      setDeployLoading(false);
    }
  };

  const simulateConcurrency = async () => {
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
    } else if (type === 'testimonials') {
      newBlock = {
        blockType: 'testimonials',
        title: 'Ce que nos clients disent',
        testimonials: [
          { quote: 'Le meilleur pain de la région ! Croustillant et savoureux.', author: 'Marie Dupont', role: 'Cliente régulière', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150' },
          { quote: 'Des viennoiseries au vrai goût de beurre. Un régal chaque matin.', author: 'Jean Martin', role: 'Habitant de Clamart', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150' }
        ]
      };
    } else if (type === 'faq') {
      newBlock = {
        blockType: 'faq',
        title: 'Questions Fréquentes',
        items: [
          { question: 'Proposez-vous des produits sans gluten ?', answer: 'Nous fabriquons principalement des pains au levain traditionnel contenant du gluten, mais nous avons une gamme de gâteaux sans farine de blé.' },
          { question: 'Quels sont vos horaires de cuisson ?', answer: 'Nos fournées ont lieu à 7h00, 11h30 et 16h30 pour vous garantir du pain chaud toute la journée.' }
        ]
      };
    } else if (type === 'pricing') {
      newBlock = {
        blockType: 'pricing',
        title: 'Nos Formules Petit-Déjeuner',
        plans: [
          { name: 'Formule Matin', price: '4.50 €', description: 'Pour bien commencer la journée.', features: [{ feature: '1 Viennoiserie' }, { feature: '1 Café ou Thé' }, { feature: '1/2 Baguette beurre' }], ctaText: 'Commander', isPopular: false },
          { name: 'Formule Brunch', price: '12.50 €', description: 'Le week-end ou pour les gourmands.', features: [{ feature: '2 Viennoiseries' }, { feature: '1 Jus de fruits frais' }, { feature: '1 Pain chaud au choix' }, { feature: 'Assiette jambon-fromage' }], ctaText: 'Réserver', isPopular: true }
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

  const isThemeModified = savedTheme && JSON.stringify(theme) !== JSON.stringify(savedTheme);

  const isAiThinking = onboardingLoading;
  let aiThinkingText = '';
  if (onboardingLoading) {
    aiThinkingText = "Génération de l'ébauche, du contenu et du design...";
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="logo-container">
            <div className="logo-icon">M</div>
            <div>
              <h1 className="logo-text">MetaSite Builder</h1>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>AI-Driven Composable SaaS</span>
            </div>
          </div>
          {isAiThinking && (
            <div 
              className="pulse-glow animate-slide" 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                background: 'rgba(99, 102, 241, 0.12)', 
                border: '1px solid rgba(99, 102, 241, 0.3)', 
                padding: '6px 14px', 
                borderRadius: 20,
                color: '#a5b4fc',
                fontSize: '0.825rem',
                fontWeight: 600,
                marginLeft: 15
              }}
            >
              <span style={{ display: 'inline-block', width: 8, height: 8, background: '#818cf8', borderRadius: '50%', animation: 'pulse 1.5s infinite' }}></span>
              <span>🧠 Réflexion : {aiThinkingText}</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          {sites.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Site Actif :</span>
              <select 
                value={activeSiteSlug} 
                onChange={(e) => setActiveSiteSlug(e.target.value)}
                style={{ 
                  background: 'rgba(255,255,255,0.05)', 
                  border: '1px solid var(--border-color)', 
                  color: 'white', 
                  padding: '6px 12px', 
                  borderRadius: 6,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                {sites.map(s => (
                  <option key={s.slug} value={s.slug} style={{ background: '#0f172a' }}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <nav className="nav-tabs">
            <button 
              className={`nav-tab ${activeTab === 'cpanel' ? 'active' : ''}`}
              onClick={() => setActiveTab('cpanel')}
            >
              <CPanelIcon /> cPanel Dashboard
            </button>
            <button 
              className={`nav-tab ${activeTab === 'onboarding' ? 'active' : ''}`}
              onClick={() => setActiveTab('onboarding')}
            >
              <SparklesIcon /> Onboarding IA
            </button>
            <button 
              className={`nav-tab ${activeTab === 'design' ? 'active' : ''}`}
              onClick={() => setActiveTab('design')}
              disabled={!activeSiteSlug}
            >
              <PaletteIcon /> Design Prédictif
            </button>
            <button 
              className={`nav-tab ${activeTab === 'cms' ? 'active' : ''}`}
              onClick={() => setActiveTab('cms')}
              disabled={!activeSiteSlug}
            >
              <BlocksIcon /> Éditeur de Blocs (CMS)
            </button>
            <button 
              className={`nav-tab ${activeTab === 'deploy' ? 'active' : ''}`}
              onClick={() => setActiveTab('deploy')}
              disabled={!activeSiteSlug}
            >
              <CpuIcon /> Déploiement o2switch
              {buildStatus.inProgress && <span className="indicator-live pulse-glow" style={{ background: '#10b981', width: 8, height: 8, borderRadius: '50%', marginLeft: 4 }}></span>}
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        
        {/* TAB 0: CPANEL DASHBOARD */}
        {activeTab === 'cpanel' && (
          <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            {/* cPanel Stats Banner */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-blue)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Sites Enregistrés</span>
                <span style={{ fontSize: '2rem', fontWeight: 800 }}>{sites.length}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)' }}>● Tous en ligne</span>
              </div>
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-purple)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Espace Disque (cPanel)</span>
                <span style={{ fontSize: '2rem', fontWeight: 800 }}>1.45 MB <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-muted)' }}>/ 10 GB</span></span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>0.01% utilisé</span>
              </div>
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-emerald)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Sécurité SSL</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-emerald)', margin: 'auto 0' }}>🔒 Let's Encrypt</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-emerald)' }}>Actif (Auto-renouvellement)</span>
              </div>
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '4px solid var(--accent-rose)' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Build Courant</span>
                {buildStatus.inProgress ? (
                  <>
                    <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-blue)', animation: 'pulse 1.5s infinite', margin: 'auto 0' }}>⚙️ Recompilation...</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Site : {buildStatus.buildingSite}</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-muted)', margin: 'auto 0' }}>Prêt 🔓</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Aucun build actif</span>
                  </>
                )}
              </div>
            </div>

            {/* Quick Actions Panel: Scan & Add */}
            <div className="grid-2col">
              {/* Quick Scan with custom path */}
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                  🔍 Détecter d'autres sites
                </h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  Scannez un répertoire pour identifier des dossiers de sites web non répertoriés (contenant <code>index.html</code> pour un build statique ou <code>package.json</code> pour un dépôt source).
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Chemin à scanner (absolu ou relatif)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input 
                      type="text" 
                      className="input-text" 
                      style={{ padding: 8, fontSize: '0.875rem', flex: 1 }} 
                      value={scanPath} 
                      onChange={(e) => setScanPath(e.target.value)} 
                      placeholder="Ex: simulated_public_html"
                    />
                    <button 
                      className="btn btn-secondary" 
                      onClick={scanSites} 
                      disabled={scanningLoading}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {scanningLoading ? "Recherche..." : "Scanner"}
                    </button>
                  </div>
                </div>

                {scannedSites.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-purple)' }}>
                      Dossiers détectés et non répertoriés :
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {scannedSites.map(scanned => (
                        <div 
                          key={scanned.slug} 
                          style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center', 
                            background: 'rgba(255,255,255,0.02)', 
                            border: '1px solid var(--border-color)', 
                            borderRadius: 8, 
                            padding: '8px 12px' 
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: '0.9rem', color: 'white' }}>{scanned.name}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              WebRoot : <code>{scanned.documentRoot}</code>
                              {scanned.repositoryPath && (
                                <> | Repo : <code>{scanned.repositoryPath}</code></>
                              )}
                            </div>
                          </div>
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '6px 12px', fontSize: '0.8rem', borderColor: 'rgba(168,85,247,0.4)', color: '#d8b4fe' }}
                            onClick={() => importSite(scanned)}
                          >
                            Importer
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Create Site */}
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                  🆕 Enregistrer un nouveau site
                </h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  Enregistrez manuellement un nouveau site dans la base cPanel et initialisez sa configuration.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Nom du Site</label>
                    <input 
                      type="text" 
                      className="input-text" 
                      style={{ padding: 8, fontSize: '0.875rem' }} 
                      value={newSiteName} 
                      onChange={(e) => setNewSiteName(e.target.value)} 
                      placeholder="Coiffeur Lyon"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Domaine personnalisé (Optionnel)</label>
                    <input 
                      type="text" 
                      className="input-text" 
                      style={{ padding: 8, fontSize: '0.875rem' }} 
                      value={newSiteDomain} 
                      onChange={(e) => setNewSiteDomain(e.target.value)} 
                      placeholder="coiffeur.lyon.site"
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Stack technique</label>
                  <select 
                    value={newSiteStack}
                    onChange={(e) => setNewSiteStack(e.target.value)}
                    style={{ width: '100%', background: '#0f172a', border: '1px solid var(--border-color)', color: 'white', padding: 8, borderRadius: 4, fontSize: '0.875rem' }}
                  >
                    <option value="Astro SSG">Astro SSG (Recommandé)</option>
                    <option value="Astro Hybride + Payload + Medusa">Astro Hybride + CMS</option>
                    <option value="Static HTML">HTML/CSS Statique</option>
                  </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 }}>
                  <button 
                    type="button"
                    className="btn-link"
                    style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => setShowAdvancedCreate(!showAdvancedCreate)}
                  >
                    {showAdvancedCreate ? "▲ Masquer les chemins personnalisés" : "▼ Configurer des chemins personnalisés (o2switch)"}
                  </button>
                </div>

                {showAdvancedCreate && (
                  <div className="animate-slide" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, background: 'rgba(255,255,255,0.01)', padding: '12px', borderRadius: 8, border: '1px dashed var(--border-color)' }}>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Dossier Web public (Document Root)</label>
                      <input 
                        type="text" 
                        className="input-text" 
                        style={{ padding: 8, fontSize: '0.875rem' }} 
                        value={newSiteDocumentRoot} 
                        onChange={(e) => setNewSiteDocumentRoot(e.target.value)} 
                        placeholder="Ex: C:/site/simulated_public_html/mon-site"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Dossier Code Source (Repository - Payload/Medusa)</label>
                      <input 
                        type="text" 
                        className="input-text" 
                        style={{ padding: 8, fontSize: '0.875rem' }} 
                        value={newSiteRepositoryPath} 
                        onChange={(e) => setNewSiteRepositoryPath(e.target.value)} 
                        placeholder="Ex: C:/site/repositories/mon-site-backend"
                      />
                    </div>
                  </div>
                )}

                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', marginTop: 'auto' }} 
                  onClick={createSite}
                  disabled={newSiteLoading}
                >
                  {newSiteLoading ? "Création..." : "Initialiser et Enregistrer"}
                </button>
              </div>
            </div>

            {/* Sites List Panel */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h3 style={{ fontSize: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                🌐 Liste des sites hébergés (Structure cPanel)
              </h3>
              
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      <th style={{ padding: '12px 10px' }}>Site / Projet</th>
                      <th style={{ padding: '12px 10px' }}>Domaine / Lien de test</th>
                      <th style={{ padding: '12px 10px' }}>Racine & Sources (o2switch paths)</th>
                      <th style={{ padding: '12px 10px' }}>Stack Technique</th>
                      <th style={{ padding: '12px 10px' }}>SSL</th>
                      <th style={{ padding: '12px 10px' }}>Source</th>
                      <th style={{ padding: '12px 10px' }}>Statut</th>
                      <th style={{ padding: '12px 10px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map(site => {
                      const isActive = activeSiteSlug === site.slug;
                      return (
                        <tr 
                          key={site.slug} 
                          style={{ 
                            borderBottom: '1px solid var(--border-color)', 
                            background: isActive ? 'rgba(99, 102, 241, 0.03)' : 'transparent',
                            fontSize: '0.9rem' 
                          }}
                        >
                          <td style={{ padding: '16px 10px', fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {site.name}
                              {isActive && (
                                <span style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid var(--accent-blue)', color: '#a5b4fc', fontSize: '0.7rem', padding: '2px 6px', borderRadius: 10, fontWeight: 700 }}>
                                  ACTIF
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>slug: {site.slug}</span>
                          </td>
                          <td style={{ padding: '16px 10px' }}>
                            <a 
                              href={`${BACKEND_URL}/sites/${site.slug}/index.html`} 
                              target="_blank" 
                              rel="noreferrer"
                              style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 500 }}
                            >
                              {site.domain} ↗
                            </a>
                          </td>
                          <td style={{ padding: '16px 10px', fontSize: '0.8rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div>
                                <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>WebRoot :</span>{' '}
                                <code style={{ color: '#93c5fd' }}>{site.documentRoot}</code>
                              </div>
                              {site.repositoryPath && (
                                <div>
                                  <span style={{ color: '#c084fc', fontWeight: 600 }}>Repo :</span>{' '}
                                  <code style={{ color: '#e9d5ff' }}>{site.repositoryPath}</code>
                                </div>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '16px 10px' }}>
                            <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem' }}>
                              {site.stack}
                            </span>
                          </td>
                          <td style={{ padding: '16px 10px', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                            {site.sslStatus === 'active' ? '🔒 Let\'s Encrypt' : '⚠ Non sécurisé'}
                          </td>
                          <td style={{ padding: '16px 10px', fontSize: '0.8rem' }}>
                            {site.createdWithTool ? (
                              <span style={{ color: '#c084fc' }}>🛠️ Généré</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>📁 Importé</span>
                            )}
                          </td>
                          <td style={{ padding: '16px 10px' }}>
                            <span 
                              style={{ 
                                display: 'inline-block',
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: site.status === 'active' ? 'var(--accent-emerald)' : 
                                            site.status === 'error' ? 'var(--accent-rose)' : '#fbbf24',
                                marginRight: 6
                              }}
                            />
                            <span style={{ textTransform: 'capitalize' }}>
                              {site.status === 'active' ? 'Actif (Déployé)' : 
                               site.status === 'error' ? 'Erreur build' : 'Brouillon'}
                            </span>
                          </td>
                          <td style={{ padding: '16px 10px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              {!isActive && (
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                                  onClick={() => setActiveSiteSlug(site.slug)}
                                >
                                  Activer
                                </button>
                              )}
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '4px 10px', fontSize: '0.8rem', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' }}
                                onClick={() => handleEditClick(site)}
                              >
                                ✏️ Modifier
                              </button>
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                                onClick={() => openFileManager(site)}
                              >
                                📁 Fichiers
                              </button>
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '4px 10px', fontSize: '0.8rem', borderColor: 'rgba(244,63,94,0.4)', color: '#f87171' }}
                                onClick={() => deleteSite(site.slug, deleteFilesOnRemove)}
                              >
                                Supprimer
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Deletion configuration */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                <input 
                  type="checkbox" 
                  id="chk-delete-files"
                  checked={deleteFilesOnRemove}
                  onChange={(e) => setDeleteFilesOnRemove(e.target.checked)}
                  style={{ width: 16, height: 16 }}
                />
                <label htmlFor="chk-delete-files" style={{ cursor: 'pointer' }}>
                  Lors de la suppression d'un site, supprimer également ses fichiers physiques dans le dossier <code>/simulated_public_html/</code>.
                </label>
              </div>

            </div>
          </div>
        )}

        {/* TAB 1: ONBOARDING IA */}
        {activeTab === 'onboarding' && (
          <div className="animate-slide" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
            <div className="glass-panel">
              <h2 style={{ marginBottom: 15, fontSize: '1.75rem' }}>1. Configurez votre nouveau site web</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
                Remplissez les informations ci-dessous. Notre moteur d'intelligence artificielle concevra instantanément l'architecture de la stack, l'ébauche de contenu et le design graphique.
              </p>

              {/* Sélecteur de fournisseur d'IA */}
              <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)' }}>Sélectionner le modèle d'IA :</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {availableProviders.openai && (
                    <button 
                      onClick={() => setAiProvider('openai')} 
                      className={`btn ${aiProvider === 'openai' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                    >
                      OpenAI
                    </button>
                  )}
                  {availableProviders.anthropic && (
                    <button 
                      onClick={() => setAiProvider('anthropic')} 
                      className={`btn ${aiProvider === 'anthropic' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                    >
                      Claude 3.5 Sonnet
                    </button>
                  )}
                  {availableProviders.gemini && (
                    <button 
                      onClick={() => setAiProvider('gemini')} 
                      className={`btn ${aiProvider === 'gemini' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                    >
                      Gemini 3.5 Flash
                    </button>
                  )}
                </div>
              </div>

              <div 
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleOnboard();
                  }
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
              >
                {/* Site Name and Description */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 15 }}>
                  <div>
                    <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>Nom du site / projet :</label>
                    <input 
                      type="text" 
                      className="input-text" 
                      style={{ padding: '10px 14px' }}
                      value={siteName} 
                      onChange={(e) => setSiteName(e.target.value)} 
                      placeholder="Ex: Salon Coiff'Elle, Boulangerie Clamart..."
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>Activité et Description :</label>
                    <textarea 
                      className="input-text"
                      rows={3}
                      value={activityDescription}
                      onChange={(e) => setActivityDescription(e.target.value)}
                      placeholder="Décrivez votre activité, vos services ou produits..."
                    />
                  </div>
                </div>

                {/* Features Selection */}
                <div>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: 10 }}>Fonctionnalités requises :</label>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={onboardFeatures.e_commerce} 
                        onChange={(e) => setOnboardFeatures({ ...onboardFeatures, e_commerce: e.target.checked })}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Vente en ligne / Boutique (E-commerce)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={onboardFeatures.blog_or_news} 
                        onChange={(e) => setOnboardFeatures({ ...onboardFeatures, blog_or_news: e.target.checked })}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Blog / Actualités / Réalisations</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={onboardFeatures.multi_store} 
                        onChange={(e) => setOnboardFeatures({ ...onboardFeatures, multi_store: e.target.checked })}
                        style={{ width: 18, height: 18 }}
                      />
                      <span>Plusieurs boutiques physiques</span>
                    </label>
                  </div>
                </div>

                {/* Visual Inspiration Source */}
                <div>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: 10 }}>Inspiration Graphique (Design de départ) :</label>
                  
                  {/* Selector between preset or image */}
                  <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
                    <button
                      type="button"
                      onClick={() => setInspirationSourceType('preset')}
                      className={`btn ${inspirationSourceType === 'preset' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '6px 12px', fontSize: '0.85rem', flex: 1 }}
                    >
                      🎨 Utiliser une ambiance prédéfinie
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspirationSourceType('image')}
                      className={`btn ${inspirationSourceType === 'image' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '6px 12px', fontSize: '0.85rem', flex: 1 }}
                    >
                      📸 Extraire depuis une image ou un logo (Vision)
                    </button>
                  </div>

                  {inspirationSourceType === 'preset' ? (
                    /* Ambiance Buttons */
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                      <button 
                        type="button"
                        onClick={() => setOnboardAmbiance('chaleureux')} 
                        className={`btn ${onboardAmbiance === 'chaleureux' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: 10, fontSize: '0.9rem' }}
                      >
                        🍞 Boulangerie / Chaleureux
                      </button>
                      <button 
                        type="button"
                        onClick={() => setOnboardAmbiance('nature')} 
                        className={`btn ${onboardAmbiance === 'nature' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: 10, fontSize: '0.9rem' }}
                      >
                        🌿 Éco / Nature / Vert
                      </button>
                      <button 
                        type="button"
                        onClick={() => setOnboardAmbiance('techno')} 
                        className={`btn ${onboardAmbiance === 'techno' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: 10, fontSize: '0.9rem' }}
                      >
                        ⚡ SaaS / Techno / Sombre
                      </button>
                      <button 
                        type="button"
                        onClick={() => setOnboardAmbiance('minimal')} 
                        className={`btn ${onboardAmbiance === 'minimal' ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: 10, fontSize: '0.9rem' }}
                      >
                        ⚫ Studio / Minimaliste / Chic
                      </button>
                    </div>
                  ) : (
                    /* Image Upload Drag & Drop Zone */
                    <div 
                      style={{
                        border: '2px dashed var(--border-color)',
                        borderRadius: 8,
                        padding: '20px 10px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: 'rgba(255,255,255,0.01)',
                        position: 'relative',
                        transition: 'all 0.2s',
                        borderColor: uploadedImage ? 'var(--accent-blue)' : 'var(--border-color)'
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            const base64String = reader.result as string;
                            setUploadedImage(base64String);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    >
                      <input 
                        type="file" 
                        accept="image/*" 
                        onChange={handleImageUpload} 
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          opacity: 0,
                          cursor: 'pointer'
                        }}
                      />
                      {uploadedImage ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                          <img src={uploadedImage} alt="Inspiration" style={{ maxHeight: 70, borderRadius: 4, objectFit: 'contain' }} />
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Logo / Image d'inspiration chargé.
                          </span>
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setUploadedImage(null);
                            }}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '0.75rem', zIndex: 10, borderColor: 'rgba(244, 63, 94, 0.4)', color: '#f87171' }}
                          >
                            Supprimer
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                          </svg>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Glissez-déposez une image / logo ici ou cliquez pour choisir
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Optional Inspiration URL */}
                <div>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>URL d'un site web d'inspiration (Optionnel) :</label>
                  <input 
                    type="text" 
                    className="input-text" 
                    style={{ padding: '10px 14px' }}
                    value={inspirationUrl} 
                    onChange={(e) => setInspirationUrl(e.target.value)} 
                    placeholder="Ex: apple.com, stripe.com, o2switch.fr..."
                  />
                </div>

                <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={handleOnboard}
                    disabled={onboardingLoading}
                    style={{ width: '100%', padding: '14px 20px', fontSize: '1.05rem' }}
                  >
                    {onboardingLoading ? 'Analyse & Génération par l\'IA...' : '✨ Générer l\'Ébauche & l\'Architecture du Site'}
                  </button>
                </div>
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
            {/* Design Customization Panel */}
            <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h2 style={{ fontSize: '1.75rem' }}>2. Personnalisation du Design & Thème</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: 5 }}>
                Ajustez manuellement les couleurs, les polices et les arrondis pour peaufiner l'identité visuelle de votre site.
              </p>

              {/* Theme Variable Customizers */}
              <div 
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    saveTheme();
                  }
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: 15, borderTop: '1px solid var(--border-color)', paddingTop: 15 }}
              >
                <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  Ajustement manuel des variables de thème
                  {isThemeModified && (
                    <span className="badge animate-slide" style={{ background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', color: '#fda4af', padding: '4px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 }}>
                      ⚠️ Brouillon non sauvegardé
                    </span>
                  )}
                </h3>

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

              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveTheme} disabled={designSaving}>
                    {designSaving ? 'Enregistrement...' : 'Enregistrer le Thème'}
                  </button>
                  {isThemeModified && (
                    <button className="btn btn-secondary" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }} onClick={resetTheme}>
                      Réinitialiser
                    </button>
                  )}
                </div>
                <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setActiveTab('cms')}>
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
                        <div 
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                              e.preventDefault();
                              savePages(pagesData);
                              setEditingBlockIdx(null);
                            }
                          }}
                          style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}
                        >
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

                          {block.blockType === 'testimonials' && (
                            <>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Titre du Bloc</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.title || ''} onChange={(e) => handleBlockChange(idx, 'title', e.target.value)} />
                              {block.testimonials && block.testimonials.map((testi, testiIdx) => (
                                <div key={testiIdx} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Témoignage {testiIdx+1}</label>
                                  <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} value={testi.quote} onChange={(e) => handleBlockNestedChange(idx, 'testimonials', testiIdx, 'quote', e.target.value)} />
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Auteur" value={testi.author} onChange={(e) => handleBlockNestedChange(idx, 'testimonials', testiIdx, 'author', e.target.value)} />
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Rôle" value={testi.role} onChange={(e) => handleBlockNestedChange(idx, 'testimonials', testiIdx, 'role', e.target.value)} />
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} placeholder="Avatar (URL)" value={testi.avatar} onChange={(e) => handleBlockNestedChange(idx, 'testimonials', testiIdx, 'avatar', e.target.value)} />
                                </div>
                              ))}
                            </>
                          )}

                          {block.blockType === 'faq' && (
                            <>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Titre du Bloc</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.title || ''} onChange={(e) => handleBlockChange(idx, 'title', e.target.value)} />
                              {block.items && block.items.map((item, itemIdx) => (
                                <div key={itemIdx} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Question {itemIdx+1}</label>
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Question" value={item.question || ''} onChange={(e) => handleBlockNestedChange(idx, 'items', itemIdx, 'question', e.target.value)} />
                                  <textarea className="input-text" style={{ padding: 4, fontSize: '0.825rem' }} placeholder="Réponse" value={item.answer || ''} onChange={(e) => handleBlockNestedChange(idx, 'items', itemIdx, 'answer', e.target.value)} />
                                </div>
                              ))}
                            </>
                          )}

                          {block.blockType === 'pricing' && (
                            <>
                              <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Titre du Bloc</label>
                              <input type="text" className="input-text" style={{ padding: 6, fontSize: '0.875rem' }} value={block.title || ''} onChange={(e) => handleBlockChange(idx, 'title', e.target.value)} />
                              {block.plans && block.plans.map((plan, planIdx) => (
                                <div key={planIdx} style={{ border: '1px solid rgba(255,255,255,0.05)', padding: 6, borderRadius: 4, marginTop: 4 }}>
                                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Plan {planIdx+1}</label>
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Nom du plan" value={plan.name} onChange={(e) => handleBlockNestedChange(idx, 'plans', planIdx, 'name', e.target.value)} />
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Prix" value={plan.price} onChange={(e) => handleBlockNestedChange(idx, 'plans', planIdx, 'price', e.target.value)} />
                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Description" value={plan.description} onChange={(e) => handleBlockNestedChange(idx, 'plans', planIdx, 'description', e.target.value)} />
                                  
                                  <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>Caractéristiques (séparées par des virgules)</label>
                                  <input 
                                    type="text" 
                                    className="input-text" 
                                    style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} 
                                    value={plan.features ? plan.features.map((f: any) => f.feature).join(', ') : ''} 
                                    onChange={(e) => {
                                      const feats = e.target.value.split(',').map(s => ({ feature: s.trim() })).filter(f => f.feature.length > 0);
                                      handleBlockNestedChange(idx, 'plans', planIdx, 'features', feats);
                                    }} 
                                  />

                                  <input type="text" className="input-text" style={{ padding: 4, fontSize: '0.825rem', marginBottom: 4 }} placeholder="Texte CTA" value={plan.ctaText} onChange={(e) => handleBlockNestedChange(idx, 'plans', planIdx, 'ctaText', e.target.value)} />
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                    <input 
                                      type="checkbox" 
                                      id={`popular-${idx}-${planIdx}`}
                                      checked={plan.isPopular || false} 
                                      onChange={(e) => handleBlockNestedChange(idx, 'plans', planIdx, 'isPopular', e.target.checked)} 
                                    />
                                    <label htmlFor={`popular-${idx}-${planIdx}`} style={{ fontSize: '0.75rem', color: 'white', cursor: 'pointer' }}>Plan populaire</label>
                                  </div>
                                </div>
                              ))}
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
                  <button className="btn btn-secondary" style={{ padding: 8, fontSize: '0.8rem' }} onClick={() => addBlock('testimonials')}>+ Témoignages</button>
                  <button className="btn btn-secondary" style={{ padding: 8, fontSize: '0.8rem' }} onClick={() => addBlock('faq')}>+ FAQ</button>
                  <button className="btn btn-secondary" style={{ padding: 8, fontSize: '0.8rem' }} onClick={() => addBlock('pricing')}>+ Tarifs</button>
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

                  if (block.blockType === 'testimonials') {
                    return (
                      <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.background }}>
                        <h2 style={{ textAlign: 'center', marginBottom: 30, fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text }}>
                          {block.title}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
                          {block.testimonials && block.testimonials.map((testi, subIdx) => (
                            <div 
                              key={subIdx} 
                              style={{ 
                                background: '#ffffff', 
                                border: '1px solid rgba(0,0,0,0.05)', 
                                padding: 20, 
                                borderRadius: theme.radius, 
                                boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12
                              }}
                            >
                              <p style={{ color: '#4b5563', fontSize: '0.9rem', fontStyle: 'italic', flex: 1, margin: 0 }}>
                                "{testi.quote}"
                              </p>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {testi.avatar && (
                                  <img src={testi.avatar} alt={testi.author} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                                )}
                                <div>
                                  <h4 style={{ margin: 0, color: theme.colors.text, fontSize: '0.9rem', fontWeight: 600 }}>{testi.author}</h4>
                                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{testi.role}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  if (block.blockType === 'faq') {
                    return (
                      <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.secondary + '11' }}>
                        <h2 style={{ textAlign: 'center', marginBottom: 30, fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text }}>
                          {block.title}
                        </h2>
                        <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {block.items && block.items.map((item, subIdx) => (
                            <div 
                              key={subIdx} 
                              style={{ 
                                background: '#ffffff', 
                                border: '1px solid rgba(0,0,0,0.05)', 
                                padding: 16, 
                                borderRadius: theme.radius, 
                                boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
                              }}
                            >
                              <h4 style={{ color: theme.colors.text, fontSize: '0.95rem', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: 0 }}>
                                <span>{item.question}</span>
                                <span style={{ color: theme.colors.primary }}>▼</span>
                              </h4>
                              <p style={{ color: '#4b5563', fontSize: '0.85rem', marginTop: 8, lineHeight: 1.5, margin: '8px 0 0 0' }}>
                                {item.answer}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  if (block.blockType === 'pricing') {
                    return (
                      <div key={index} style={{ padding: '40px 20px', backgroundColor: theme.colors.background }}>
                        <h2 style={{ textAlign: 'center', marginBottom: 30, fontFamily: `'${theme.fonts.heading}', serif`, color: theme.colors.text }}>
                          {block.title}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, maxWidth: 800, margin: '0 auto', alignItems: 'stretch' }}>
                          {block.plans && block.plans.map((plan, subIdx) => (
                            <div 
                              key={subIdx} 
                              style={{ 
                                background: '#ffffff', 
                                border: plan.isPopular ? `2px solid ${theme.colors.primary}` : '1px solid rgba(0,0,0,0.05)', 
                                padding: 24, 
                                borderRadius: theme.radius, 
                                boxShadow: plan.isPopular ? '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)' : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                                display: 'flex',
                                flexDirection: 'column',
                                position: 'relative',
                                transform: plan.isPopular ? 'scale(1.03)' : 'none',
                                zIndex: plan.isPopular ? 2 : 1
                              }}
                            >
                              {plan.isPopular && (
                                <span 
                                  style={{ 
                                    position: 'absolute', 
                                    top: -12, 
                                    left: '50%', 
                                    transform: 'translateX(-50%)', 
                                    backgroundColor: theme.colors.primary, 
                                    color: '#ffffff', 
                                    padding: '2px 10px', 
                                    borderRadius: 12, 
                                    fontSize: '0.7rem', 
                                    fontWeight: 700, 
                                    textTransform: 'uppercase' 
                                  }}
                                >
                                  Populaire
                                </span>
                              )}
                              <h3 style={{ margin: 0, fontSize: '1.2rem', color: theme.colors.text }}>{plan.name}</h3>
                              <p style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: 4, minHeight: 32, margin: '4px 0 0 0' }}>{plan.description}</p>
                              <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 15, marginBottom: 15 }}>
                                <span style={{ fontSize: '2rem', fontWeight: 800, color: theme.colors.text }}>{plan.price}</span>
                              </div>
                              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px 0', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                                {plan.features && plan.features.map((f, fIdx) => (
                                  <li key={fIdx} style={{ fontSize: '0.825rem', color: '#4b5563', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ color: theme.colors.primary, fontWeight: 'bold' }}>✓</span>
                                    <span>{f.feature}</span>
                                  </li>
                                ))}
                              </ul>
                              <button 
                                style={{ 
                                  width: '100%', 
                                  border: 'none', 
                                  backgroundColor: plan.isPopular ? theme.colors.primary : theme.colors.secondary, 
                                  color: plan.isPopular ? '#ffffff' : theme.colors.text, 
                                  borderRadius: theme.radius, 
                                  padding: '10px 14px', 
                                  fontWeight: 600, 
                                  cursor: 'pointer',
                                  fontSize: '0.875rem' 
                                }}
                              >
                                {plan.ctaText}
                              </button>
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

      {/* FILE MANAGER MODAL */}
      {fileManagerSite && (
        <div 
          className="animate-slide"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(5, 7, 12, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20
          }}
        >
          <div 
            className="glass-panel" 
            style={{ 
              width: '100%', 
              maxWidth: '950px', 
              height: '80vh', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 0,
              padding: 0,
              overflow: 'hidden',
              borderColor: 'rgba(99, 102, 241, 0.3)'
            }}
          >
            {/* Modal Header */}
            <div 
              style={{ 
                padding: '16px 24px', 
                borderBottom: '1px solid var(--border-color)', 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                background: 'rgba(0,0,0,0.2)'
              }}
            >
              <div>
                <h3 style={{ fontSize: '1.2rem', color: 'white' }}>
                  📁 Gestionnaire de Fichiers cPanel
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Site : <strong>{fileManagerSite.name}</strong>
                </span>
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '6px 12px', fontSize: '0.85rem' }} 
                onClick={() => setFileManagerSite(null)}
              >
                Fermer
              </button>
            </div>

            {/* Folder Mode Switcher */}
            <div 
              style={{ 
                padding: '10px 24px', 
                background: 'rgba(255,255,255,0.02)', 
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                gap: 15,
                alignItems: 'center',
                flexWrap: 'wrap'
              }}
            >
              <button
                className={`btn ${fileManagerType === 'documentRoot' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                onClick={() => setFileManagerType('documentRoot')}
              >
                🌐 Dossier Web Public (Document Root)
              </button>
              
              <button
                className={`btn ${fileManagerType === 'repository' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '6px 14px', fontSize: '0.8rem' }}
                onClick={() => {
                  if (!fileManagerSite.repositoryPath) {
                    alert("Ce site n'a pas de dossier de repository source configuré. Modifiez le site pour en rajouter un.");
                    return;
                  }
                  setFileManagerType('repository');
                }}
                disabled={!fileManagerSite.repositoryPath}
              >
                💻 Code Source (Repository / CMS)
              </button>

              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                Chemin : <code>{fileManagerType === 'repository' ? fileManagerSite.repositoryPath : fileManagerSite.documentRoot}</code>
              </span>
            </div>

            {/* Modal Body */}
            <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', flex: 1, overflow: 'hidden' }}>
              {/* Files list panel */}
              <div 
                style={{ 
                  borderRight: '1px solid var(--border-color)', 
                  overflowY: 'auto', 
                  padding: 15,
                  background: 'rgba(0,0,0,0.1)'
                }}
              >
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12, fontWeight: 700 }}>
                  STRUCTURE DU DOSSIER
                </h4>
                {fileListLoading ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: 20 }}>
                    Chargement des fichiers...
                  </div>
                ) : fileList.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: 20 }}>
                    {fileManagerType === 'documentRoot' 
                      ? "Le dossier public est vide. Lancez la recompilation dans l'onglet Déploiement pour générer les fichiers."
                      : "Le dossier du dépôt est vide ou n'existe pas. Assurez-vous que le chemin est correct."}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {fileList.map(file => (
                      <div 
                        key={file.path} 
                        style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'space-between', 
                          padding: '6px 8px', 
                          borderRadius: 4, 
                          background: selectedFilePath === file.path ? 'rgba(99,102,241,0.15)' : 'transparent',
                          cursor: file.isDir ? 'default' : 'pointer',
                          fontSize: '0.85rem',
                          userSelect: 'none'
                        }}
                        onClick={() => {
                          if (!file.isDir) viewFile(file.path);
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                          <span style={{ fontSize: '1rem' }}>{file.isDir ? '📁' : '📄'}</span>
                          <span 
                            style={{ 
                              textOverflow: 'ellipsis', 
                              overflow: 'hidden', 
                              whiteSpace: 'nowrap',
                              color: file.isDir ? '#93c5fd' : 'white',
                              textDecoration: file.isDir ? 'none' : 'underline',
                              fontWeight: file.isDir ? '600' : 'normal'
                            }}
                          >
                            {file.path}
                          </span>
                        </div>
                        {!file.isDir && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {(file.size / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Code viewer pane */}
              <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#05070c' }}>
                <div 
                  style={{ 
                    padding: '10px 20px', 
                    background: 'rgba(255,255,255,0.01)', 
                    borderBottom: '1px solid rgba(255,255,255,0.05)', 
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)'
                  }}
                >
                  Contenu : {selectedFilePath ? <code>{selectedFilePath}</code> : 'Aucun fichier sélectionné'}
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: 20, fontFamily: 'Courier New, monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                  {selectedFileLoading ? (
                    <div style={{ color: 'var(--accent-blue)', textAlign: 'center', padding: 40 }}>
                      Lecture du fichier en cours...
                    </div>
                  ) : selectedFileContent !== null ? (
                    <pre style={{ margin: 0, color: '#34d399' }}>{selectedFileContent}</pre>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
                      Sélectionnez un fichier dans la liste de gauche pour afficher son contenu.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SITE MODAL */}
      {editSite && (
        <div 
          className="animate-slide"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(5, 7, 12, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20
          }}
        >
          <div 
            className="glass-panel" 
            style={{ 
              width: '100%', 
              maxWidth: '600px', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: 20,
              borderColor: 'rgba(99, 102, 241, 0.3)'
            }}
          >
            <div 
              style={{ 
                borderBottom: '1px solid var(--border-color)', 
                paddingBottom: 15,
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center'
              }}
            >
              <h3 style={{ fontSize: '1.25rem', color: 'white' }}>
                ✏️ Modifier la configuration du site
              </h3>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '6px 12px', fontSize: '0.85rem' }} 
                onClick={() => setEditSite(null)}
              >
                Fermer
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Nom du site *</label>
                <input 
                  type="text" 
                  className="input-text" 
                  value={editSiteName} 
                  onChange={(e) => setEditSiteName(e.target.value)} 
                />
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Domaine personnalisé</label>
                <input 
                  type="text" 
                  className="input-text" 
                  value={editSiteDomain} 
                  onChange={(e) => setEditSiteDomain(e.target.value)} 
                />
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Document Root (Dossier Web public)</label>
                <input 
                  type="text" 
                  className="input-text" 
                  value={editSiteDocumentRoot} 
                  onChange={(e) => setEditSiteDocumentRoot(e.target.value)} 
                />
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Repository Path (Code Payload/Medusa - Optionnel)</label>
                <input 
                  type="text" 
                  className="input-text" 
                  value={editSiteRepositoryPath} 
                  onChange={(e) => setEditSiteRepositoryPath(e.target.value)} 
                />
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Stack technique</label>
                <select 
                  value={editSiteStack}
                  onChange={(e) => setEditSiteStack(e.target.value)}
                  style={{ width: '100%', background: '#0f172a', border: '1px solid var(--border-color)', color: 'white', padding: 10, borderRadius: 4, fontSize: '0.9rem' }}
                >
                  <option value="Astro SSG">Astro SSG</option>
                  <option value="Astro Hybride + Payload + Medusa">Astro Hybride + CMS</option>
                  <option value="Static HTML">HTML/CSS Statique</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: 15, marginTop: 10 }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => setEditSite(null)}
              >
                Annuler
              </button>
              <button 
                className="btn btn-primary" 
                onClick={saveEditSite}
                disabled={editSiteLoading}
              >
                {editSiteLoading ? "Enregistrement..." : "Enregistrer"}
              </button>
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

function CPanelIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
      <line x1="15" y1="3" x2="15" y2="21"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
    </svg>
  );
}
