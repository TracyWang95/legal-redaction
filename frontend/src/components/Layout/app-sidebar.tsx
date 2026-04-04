/**
 * Application sidebar using ShadCN Sidebar component.
 * Contains navigation links, model config section, data safety badge, and health panel.
 */
import { NavLink, useLocation } from 'react-router-dom';
import { Lock, ShieldCheck } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { useServiceHealth } from '@/hooks/use-service-health';
import { HealthPanel } from '@/components/shared/health-panel';
import {
  PlayIcon,
  BatchIcon,
  HistoryIcon,
  JobsCenterIcon,
  ListIcon,
  RulesIcon,
  ModelIcon,
  TextModelNavIcon,
} from '@/components/shared/nav-icons';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';

interface NavItem {
  path: string;
  label: string;
  sublabel?: string;
  icon: React.FC<{ className?: string }>;
  end?: boolean;
}

export function AppSidebar() {
  const t = useT();
  const location = useLocation();
  const { health, checking, roundTripMs, refresh } = useServiceHealth();

  const navItems: NavItem[] = [
    { path: '/', label: t('nav.playground'), icon: PlayIcon, end: true },
    { path: '/batch', label: t('nav.batch'), sublabel: t('nav.batch.sub'), icon: BatchIcon },
    { path: '/history', label: t('nav.history'), icon: HistoryIcon },
    { path: '/jobs', label: t('nav.jobs'), sublabel: t('nav.jobs.sub'), icon: JobsCenterIcon },
    { path: '/settings/redaction', label: t('nav.redactionList'), sublabel: t('nav.redactionList.sub'), icon: ListIcon, end: true },
    { path: '/settings', label: t('nav.recognitionSettings'), sublabel: t('nav.recognitionSettings.sub'), icon: RulesIcon, end: true },
  ];

  const modelNavItems: NavItem[] = [
    { path: '/model-settings/text', label: t('nav.textModel'), icon: TextModelNavIcon },
    { path: '/model-settings/vision', label: t('nav.visionModel'), icon: ModelIcon },
  ];

  return (
    <Sidebar collapsible="offcanvas">
      {/* Brand header */}
      <SidebarHeader className="h-[52px] flex-row items-center gap-2.5 border-b px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#1d1d1f] shadow-sm">
          <ShieldCheck className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0">
          <span className="block text-sm font-semibold leading-tight tracking-[-0.02em]">
            DataInfra-RedactionEverything
          </span>
          <p className="text-[10px] text-muted-foreground">{t('sidebar.subtitle')}</p>
        </div>
      </SidebarHeader>

      {/* Main navigation */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild isActive={isNavActive(item, location.pathname)} tooltip={item.label}>
                    <NavLink to={item.path} end={item.end} data-testid={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}>
                      <item.icon className="h-[18px] w-[18px]" />
                      {item.sublabel ? (
                        <span className="flex flex-col gap-0.5 leading-snug">
                          <span>{item.label}</span>
                          <span className="text-[10px] font-normal text-muted-foreground line-clamp-2">
                            {item.sublabel}
                          </span>
                        </span>
                      ) : (
                        <span>{item.label}</span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Model config section */}
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.modelConfig')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {modelNavItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild isActive={isNavActive(item, location.pathname)} tooltip={item.label}>
                    <NavLink to={item.path} data-testid={`nav-${item.path.replace(/\//g, '-').replace(/^-/, '')}`}>
                      <item.icon className="h-[18px] w-[18px]" />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Data safety badge + health panel */}
      <SidebarFooter>
        <div className={cn(
          'flex items-center gap-1.5 rounded-md border border-emerald-200/60 bg-emerald-50 px-2 py-1',
          'dark:border-emerald-700/40 dark:bg-emerald-900/30',
        )}>
          <Lock className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-[10px] font-medium leading-tight text-emerald-700 dark:text-emerald-300">
            {t('safety.badge.short')}
          </span>
        </div>
        <HealthPanel health={health} checking={checking} roundTripMs={roundTripMs} onRefresh={refresh} />
      </SidebarFooter>
    </Sidebar>
  );
}

/** Determine if a nav item should be marked active based on the current path */
function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.path;
  return pathname === item.path || pathname.startsWith(item.path + '/');
}
