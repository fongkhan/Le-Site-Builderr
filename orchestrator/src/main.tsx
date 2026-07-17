import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { RequireAdmin } from './auth/RequireAdmin'
import { SitesProvider } from './state/SitesContext'
import { ToastProvider } from './components/ui/ToastContext'
import { AppLayout } from './components/layout/AppLayout'
import { SiteLayout } from './components/layout/SiteLayout'
import { LoginPage } from './features/auth/LoginPage'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { SitesListPage } from './features/sites/SitesListPage'
import { OnboardingPage } from './features/onboarding/OnboardingPage'
import { DesignPage } from './features/design/DesignPage'
import { CmsPage } from './features/cms/CmsPage'
import { DeployPage } from './features/deploy/DeployPage'
import { AdminPanel } from './features/admin/AdminPanel'
import { NotFoundPage } from './features/NotFoundPage'

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <Navigate to="/sites" replace /> },
          { path: '/sites', element: <SitesListPage /> },
          { path: '/onboarding', element: <OnboardingPage /> },
          {
            path: '/sites/:slug',
            element: <SiteLayout />,
            children: [
              { index: true, element: <Navigate to="design" replace /> },
              { path: 'design', element: <DesignPage /> },
              { path: 'cms', element: <CmsPage /> },
              { path: 'deploy', element: <DeployPage /> },
            ],
          },
          {
            element: <RequireAdmin />,
            children: [
              { path: '/admin-panel', element: <AdminPanel /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <SitesProvider>
          <RouterProvider router={router} />
        </SitesProvider>
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
)
