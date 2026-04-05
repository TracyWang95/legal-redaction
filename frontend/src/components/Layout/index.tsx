
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
        {}
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
