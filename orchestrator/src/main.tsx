import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { RequireAdmin } from './auth/RequireAdmin'
import { SitesProvider } from './state/SitesContext'
import { BuildStatusProvider } from './state/BuildStatusContext'
import { ConfigProvider } from './state/ConfigContext'
import { ToastProvider } from './components/ui/ToastContext'
import { AppLayout } from './components/layout/AppLayout'
import { SiteLayout } from './components/layout/SiteLayout'
import { LoginPage } from './features/auth/LoginPage'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { SitesListPage } from './features/sites/SitesListPage'
import { NotFoundPage } from './features/NotFoundPage'
import { RouteError } from './features/RouteError'

// Pages lourdes chargées à la demande : la page de connexion et la liste des sites
// n'embarquent ni le CMS, ni l'onboarding, ni le panel d'administration.
const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/forgot-password', element: <ForgotPasswordPage />, errorElement: <RouteError /> },
  { path: '/reset-password', element: <ResetPasswordPage />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            errorElement: <RouteError />,
            children: [
              { path: '/', element: <Navigate to="/sites" replace /> },
              { path: '/sites', element: <SitesListPage /> },
              { path: '/onboarding', lazy: async () => ({ Component: (await import('./features/onboarding/OnboardingPage')).OnboardingPage }) },
              {
                path: '/sites/:slug',
                element: <SiteLayout />,
                children: [
                  { index: true, element: <Navigate to="design" replace /> },
                  { path: 'design', lazy: async () => ({ Component: (await import('./features/design/DesignPage')).DesignPage }) },
                  { path: 'cms', lazy: async () => ({ Component: (await import('./features/cms/CmsPage')).CmsPage }) },
                  { path: 'blog', lazy: async () => ({ Component: (await import('./features/blog/BlogPage')).BlogPage }) },
                  { path: 'deploy', lazy: async () => ({ Component: (await import('./features/deploy/DeployPage')).DeployPage }) },
                  { path: 'messages', lazy: async () => ({ Component: (await import('./features/messages/MessagesPage')).MessagesPage }) },
                ],
              },
              {
                element: <RequireAdmin />,
                children: [
                  { path: '/admin-panel', lazy: async () => ({ Component: (await import('./features/admin/AdminPanel')).AdminPanel }) },
                ],
              },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <ConfigProvider>
          <SitesProvider>
            <BuildStatusProvider>
              <RouterProvider router={router} />
            </BuildStatusProvider>
          </SitesProvider>
        </ConfigProvider>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
)
