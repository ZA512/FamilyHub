'use client';

import { lazy, Suspense, useEffect, useState } from 'react';

import type { ModuleConfig, ModuleKey } from '@familyhub/contracts';

import {
  Bell,
  Bookmark,
  CalendarDays,
  CheckSquare2,
  CircleEllipsis,
  Home,
  LoaderCircle,
  MessageCircle,
  Plus,
  Search,
  Settings,
  ShoppingBasket,
  Sparkles,
  Users,
  Utensils,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { HomeView } from './home-view';
import { ShoppingView } from './shopping-view';
import { MembersView } from './members-view';
import { NotificationsView } from './notifications-view';
import { SearchView } from './search-view';
import { SettingsView } from './settings-view';
import { TasksView } from './tasks-view';

const AgendaView = lazy(() =>
  import('./agenda-view').then((module) => ({ default: module.AgendaView })),
);

type ViewId =
  | 'home'
  | 'chat'
  | 'agenda'
  | 'tasks'
  | 'meals'
  | 'shopping'
  | 'bookmarks'
  | 'members'
  | 'settings'
  | 'notifications'
  | 'search';

const primaryNavigation = [
  { id: 'home' as const, label: 'Accueil', icon: Home, badge: undefined },
  { id: 'chat' as const, label: 'Chat', icon: MessageCircle, badge: undefined },
  {
    id: 'agenda' as const,
    label: 'Agenda',
    icon: CalendarDays,
    badge: undefined,
  },
  {
    id: 'tasks' as const,
    label: 'Tâches',
    icon: CheckSquare2,
    badge: undefined,
  },
];

const secondaryNavigation = [
  { id: 'meals' as const, label: 'Repas', icon: Utensils },
  { id: 'shopping' as const, label: 'Courses', icon: ShoppingBasket },
  { id: 'bookmarks' as const, label: 'Bookmarks', icon: Bookmark },
  { id: 'members' as const, label: 'Membres', icon: Users },
];

const mobileNavigation = [
  { id: 'home' as const, label: 'Accueil', icon: Home, badge: undefined },
  { id: 'chat' as const, label: 'Chat', icon: MessageCircle, badge: undefined },
  {
    id: 'agenda' as const,
    label: 'Agenda',
    icon: CalendarDays,
    badge: undefined,
  },
  {
    id: 'tasks' as const,
    label: 'Tâches',
    icon: CheckSquare2,
    badge: undefined,
  },
  {
    id: 'more' as const,
    label: 'Plus',
    icon: CircleEllipsis,
    badge: undefined,
  },
];

const quickCreateOptions = [
  { view: 'chat' as const, label: 'Message', icon: MessageCircle },
  { view: 'agenda' as const, label: 'Événement', icon: CalendarDays },
  { view: 'tasks' as const, label: 'Tâche', icon: CheckSquare2 },
  {
    view: 'shopping' as const,
    label: 'Article de courses',
    icon: ShoppingBasket,
  },
  { view: 'meals' as const, label: 'Repas', icon: Utensils },
  { view: 'bookmarks' as const, label: 'Bookmark', icon: Bookmark },
];

type DashboardPageProps = {
  memberId: string;
  firstName?: string;
  instanceName?: string;
  role: 'ADMIN' | 'MEMBER';
  csrfToken: string;
  onLogout: () => Promise<void>;
};

export default function DashboardPage({
  memberId,
  firstName = 'Maxime',
  instanceName = 'Foyer Girard',
  role,
  csrfToken,
  onLogout,
}: DashboardPageProps) {
  const [displayFirstName, setDisplayFirstName] = useState(firstName);
  const initials = displayFirstName.slice(0, 2).toUpperCase();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [shoppingComposerOpen, setShoppingComposerOpen] = useState(false);
  const [agendaComposerOpen, setAgendaComposerOpen] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>('home');
  const [modules, setModules] = useState<ModuleConfig[] | null>(null);
  const [modulesError, setModulesError] = useState('');
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  function moduleEnabled(key: ModuleKey) {
    return modules?.find((module) => module.key === key)?.enabled ?? true;
  }

  const canCreate = quickCreateOptions.some((option) =>
    moduleEnabled(option.view),
  );
  function navigate(view: ViewId) {
    setActiveView(view);
    setQuickAddOpen(false);
  }

  function startCreation(view: ViewId) {
    navigate(view);
    if (view === 'shopping') setShoppingComposerOpen(true);
    if (view === 'agenda') setAgendaComposerOpen(true);
    if (view === 'tasks') setTaskComposerOpen(true);
  }

  async function toggleModule(key: ModuleKey, enabled: boolean) {
    const response = await fetch(`/api/v1/modules/${key}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) throw new Error('Impossible de modifier ce module.');
    const payload = (await response.json()) as { module: ModuleConfig };
    setModules(
      (current) =>
        current?.map((module) =>
          module.key === payload.module.key ? payload.module : module,
        ) ?? [payload.module],
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/modules', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'Impossible de charger la configuration des modules.',
          );
        return (await response.json()) as { modules: ModuleConfig[] };
      })
      .then((payload) => {
        setModules(payload.modules);
        setModulesError('');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setModulesError(
          reason instanceof Error
            ? reason.message
            : 'Configuration indisponible.',
        );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/notifications', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { unreadCount: number };
      })
      .then((payload) => {
        if (payload) setUnreadNotificationCount(payload.unreadCount);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'start_quick_add',
          title: 'Ouvrir la création rapide',
          description:
            'Ouvre le même menu de création rapide que le bouton Ajouter de FamilyHub.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute() {
            setQuickAddOpen(true);
            return { status: 'opened' };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, []);

  useEffect(() => {
    function openSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setActiveView('search');
        setQuickAddOpen(false);
      }
    }
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, []);

  return (
    <>
      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter au foyer</DialogTitle>
            <DialogDescription>
              Choisissez ce que vous souhaitez créer.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {quickCreateOptions
              .filter((item) => moduleEnabled(item.view))
              .map((item) => (
                <button
                  key={item.label}
                  onClick={() => startCreation(item.view)}
                  className="flex min-h-20 flex-col items-start justify-between rounded-xl border bg-background p-3 text-left font-medium transition-colors hover:bg-muted"
                >
                  <item.icon
                    className="size-5 text-[#087f72]"
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <SidebarProvider>
        <Sidebar collapsible="icon" className="border-r-0">
          <SidebarHeader className="px-3 py-4">
            <div className="flex items-center gap-3 px-1">
              <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Sparkles className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-base font-semibold tracking-tight">
                  FamilyHub
                </p>
                <p className="truncate text-xs text-sidebar-foreground/55">
                  {instanceName}
                </p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Essentiel</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {primaryNavigation
                    .filter((item) => moduleEnabled(item.id))
                    .map((item) => (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          isActive={activeView === item.id}
                          tooltip={item.label}
                          className="h-10 rounded-xl px-3"
                          onClick={() => navigate(item.id)}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {item.badge ? (
                          <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                        ) : null}
                      </SidebarMenuItem>
                    ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Notre espace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {secondaryNavigation
                    .filter((item) => moduleEnabled(item.id))
                    .map((item) => (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          isActive={activeView === item.id}
                          tooltip={item.label}
                          className="h-10 rounded-xl px-3"
                          onClick={() => navigate(item.id)}
                        >
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="px-3 pb-4">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={activeView === 'settings'}
                  tooltip="Paramètres"
                  className="h-10 rounded-xl px-3"
                  onClick={() => navigate('settings')}
                >
                  <Settings aria-hidden="true" />
                  <span>Paramètres</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  tooltip="Mon profil"
                  className="rounded-xl px-2"
                  onClick={() => navigate('settings')}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#d9f4ef] text-xs font-bold text-[#075e55]">
                    {initials}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate font-medium">
                      {displayFirstName}
                    </span>
                    <span className="truncate text-xs text-sidebar-foreground/55">
                      {role === 'ADMIN' ? 'Administrateur' : 'Membre'}
                    </span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0 overflow-x-hidden">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-xl md:px-7">
            <SidebarTrigger
              aria-label="Ouvrir la navigation"
              className="hidden md:inline-flex"
            />
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="md:hidden">
                <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Sparkles className="size-4" aria-hidden="true" />
                </div>
              </div>
              <button
                onClick={() => navigate('search')}
                className="hidden h-9 w-full max-w-sm items-center gap-2 rounded-xl border bg-muted/45 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
              >
                <Search className="size-4" aria-hidden="true" />
                <span>Rechercher dans le foyer</span>
                <kbd className="ml-auto rounded-md border bg-background px-1.5 py-0.5 text-xs">
                  ⌘ K
                </kbd>
              </button>
              <div className="md:hidden">
                <p className="truncate font-semibold">FamilyHub</p>
                <p className="text-xs text-muted-foreground">{instanceName}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                unreadNotificationCount
                  ? `Notifications, ${unreadNotificationCount} non lue${unreadNotificationCount > 1 ? 's' : ''}`
                  : 'Notifications'
              }
              className="relative rounded-xl"
              onClick={() => navigate('notifications')}
            >
              <Bell aria-hidden="true" />
              {unreadNotificationCount ? (
                <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#e49131] px-1 text-[11px] font-bold text-white ring-2 ring-background">
                  {unreadNotificationCount > 99
                    ? '99+'
                    : unreadNotificationCount}
                </span>
              ) : null}
            </Button>
            {canCreate ? (
              <Button
                onClick={() => setQuickAddOpen(true)}
                className="hidden rounded-xl bg-[#087f72] hover:bg-[#076d63] sm:inline-flex"
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                Ajouter
              </Button>
            ) : null}
          </header>

          <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-10 md:pt-8">
            {activeView === 'settings' ? (
              <SettingsView
                role={role}
                modules={modules}
                loadError={modulesError}
                csrfToken={csrfToken}
                onToggle={toggleModule}
                onFirstNameChange={setDisplayFirstName}
                onLogout={onLogout}
              />
            ) : activeView === 'shopping' ? (
              <ShoppingView
                csrfToken={csrfToken}
                composerOpen={shoppingComposerOpen}
                onComposerOpenChange={setShoppingComposerOpen}
              />
            ) : activeView === 'agenda' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement de l’agenda…
                  </div>
                }
              >
                <AgendaView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={agendaComposerOpen}
                  onComposerOpenChange={setAgendaComposerOpen}
                  onOpenTasks={() => navigate('tasks')}
                />
              </Suspense>
            ) : activeView === 'tasks' ? (
              <TasksView
                currentMemberId={memberId}
                role={role}
                csrfToken={csrfToken}
                composerOpen={taskComposerOpen}
                onComposerOpenChange={setTaskComposerOpen}
              />
            ) : activeView === 'members' ? (
              <MembersView role={role} csrfToken={csrfToken} />
            ) : activeView === 'notifications' ? (
              <NotificationsView
                csrfToken={csrfToken}
                onUnreadCountChange={setUnreadNotificationCount}
              />
            ) : activeView === 'search' ? (
              <SearchView onNavigate={navigate} />
            ) : activeView !== 'home' ? (
              <ComingSoonView view={activeView} />
            ) : (
              <HomeView
                firstName={displayFirstName}
                onNavigate={navigate}
                onUnreadCountChange={setUnreadNotificationCount}
              />
            )}
          </div>

          {canCreate ? (
            <Button
              size="icon-lg"
              aria-label="Ajouter"
              onClick={() => setQuickAddOpen(true)}
              className="fixed bottom-20 right-4 z-30 size-12 rounded-2xl bg-[#087f72] shadow-lg hover:bg-[#076d63] sm:hidden"
            >
              <Plus className="size-5" aria-hidden="true" />
            </Button>
          ) : null}

          <nav
            aria-label="Navigation principale"
            className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
          >
            <ul className="grid h-16 grid-cols-5 px-1">
              {mobileNavigation
                .filter((item) => item.id === 'more' || moduleEnabled(item.id))
                .map((item) => (
                  <li key={item.label}>
                    <button
                      onClick={() =>
                        item.id === 'more'
                          ? setQuickAddOpen(true)
                          : navigate(item.id)
                      }
                      className={`relative flex size-full flex-col items-center justify-center gap-1 text-xs ${item.id !== 'more' && activeView === item.id ? 'font-semibold text-[#087f72]' : 'text-muted-foreground'}`}
                    >
                      <item.icon className="size-5" aria-hidden="true" />
                      <span>{item.label}</span>
                      {item.badge ? (
                        <span className="absolute left-[calc(50%+5px)] top-2.5 size-2 rounded-full bg-[#e49131] ring-2 ring-background" />
                      ) : null}
                    </button>
                  </li>
                ))}
            </ul>
          </nav>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}

const viewLabels: Record<
  Exclude<
    ViewId,
    | 'home'
    | 'tasks'
    | 'agenda'
    | 'shopping'
    | 'members'
    | 'settings'
    | 'notifications'
    | 'search'
  >,
  { title: string; description: string }
> = {
  chat: {
    title: 'Chat',
    description:
      'La messagerie familiale arrive dans la prochaine tranche fonctionnelle.',
  },
  meals: {
    title: 'Repas',
    description: 'La planification des repas sera bientôt disponible.',
  },
  bookmarks: {
    title: 'Bookmarks',
    description: 'Le partage de liens sera bientôt disponible.',
  },
};

function ComingSoonView({
  view,
}: {
  view: Exclude<
    ViewId,
    | 'home'
    | 'tasks'
    | 'agenda'
    | 'shopping'
    | 'members'
    | 'settings'
    | 'notifications'
    | 'search'
  >;
}) {
  const content = viewLabels[view];
  return (
    <section className="grid min-h-[55vh] place-items-center text-center">
      <div className="max-w-md">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
          <Sparkles aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          {content.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{content.description}</p>
      </div>
    </section>
  );
}
