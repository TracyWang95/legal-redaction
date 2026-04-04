/**
 * Layout shell.
 * Composes SidebarProvider + AppSidebar + AppHeader + Outlet.
 * All inline icons, health polling, and nav logic have been extracted
 * into app-sidebar.tsx, app-header.tsx, and shared hooks.
 */
import { Outlet, useLocation } from 'react-router-dom';
import { ToastContainer } from '@/components/Toast';
import { OfflineBanner } from '@/components/OfflineBanner';
import { OnboardingGuide } from '@/components/OnboardingGuide';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { AppHeader } from './app-header';

export const Layout: React.FC = () => {
  const location = useLocation();

  return (
    <SidebarProvider>
      <OfflineBanner />
      <AppSidebar />
      <SidebarInset>
        <AppHeader />
        {/* Content area: single scroll container per page */}
        <div
          key={location.pathname}
          className="flex flex-1 flex-col overflow-hidden animate-fade-in"
        >
          <Outlet />
        </div>
      </SidebarInset>

      <ToastContainer />
      <OnboardingGuide />
    </SidebarProvider>
  );
};

export default Layout;
