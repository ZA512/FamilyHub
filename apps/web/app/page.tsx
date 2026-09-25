'use client';

import { lazy, Suspense, useEffect, useState } from 'react';

import type { ModuleConfig, ModuleKey } from '@familyhub/contracts';

import {
  Bell,
  Bookmark,
  CalendarDays,
  ChartBar,
  CheckSquare2,
  CircleEllipsis,
  ContactRound,
  FileText,
  Home,
  LibraryBig,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Music2,
  NotebookText,
  Plus,
  Search,
  Settings,
  ShoppingBasket,
  Sparkles,
  Users,
  Utensils,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  applyTheme,
  parsePersonalPreferences,
  preferencesStorageKey,
  type PersonalPreferences,
} from '@/lib/personal-preferences';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
const MealsView = lazy(() =>
  import('./meals-view').then((module) => ({ default: module.MealsView })),
);
const ChatView = lazy(() =>
  import('./chat-view').then((module) => ({ default: module.ChatView })),
);
const BookmarksView = lazy(() =>
  import('./bookmarks-view').then((module) => ({
    default: module.BookmarksView,
  })),
);
const PagesView = lazy(() =>
  import('./pages-view').then((module) => ({ default: module.PagesView })),
);
const CollectionsView = lazy(() =>
  import('./collections-view').then((module) => ({
    default: module.CollectionsView,
  })),
);
const PollsView = lazy(() =>
  import('./polls-view').then((module) => ({ default: module.PollsView })),
);
const IdeasView = lazy(() =>
  import('./ideas-view').then((module) => ({ default: module.IdeasView })),
);
const ContactsView = lazy(() =>
  import('./contacts-view').then((module) => ({
    default: module.ContactsView,
  })),
);
const DocumentsView = lazy(() =>
  import('./documents-view').then((module) => ({
    default: module.DocumentsView,
  })),
);
const MusicView = lazy(() =>
  import('./music-view').then((module) => ({ default: module.MusicView })),
);

type ViewId =
  | 'home'
  | 'chat'
  | 'agenda'
  | 'tasks'
  | 'meals'
  | 'shopping'
  | 'bookmarks'
  | 'pages'
  | 'collections'
  | 'polls'
  | 'ideas'
  | 'contacts'
  | 'documents'
  | 'music'
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
  { id: 'pages' as const, label: 'Pages', icon: NotebookText },
  { id: 'collections' as const, label: 'Collections', icon: LibraryBig },
  { id: 'polls' as const, label: 'Sondages', icon: ChartBar },
  { id: 'ideas' as const, label: 'Boîte à idées', icon: Lightbulb },
  { id: 'contacts' as const, label: 'Contacts', icon: ContactRound },
  { id: 'documents' as const, label: 'Documents', icon: FileText },
  { id: 'music' as const, label: 'Musique', icon: Music2 },
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
  { view: 'chat' as const, label: 'Nouveau message', icon: MessageCircle },
  { view: 'agenda' as const, label: 'Événement', icon: CalendarDays },
  { view: 'tasks' as const, label: 'Tâche', icon: CheckSquare2 },
  {
    view: 'shopping' as const,
    label: 'Article de courses',
    icon: ShoppingBasket,
  },
  { view: 'meals' as const, label: 'Repas', icon: Utensils },
  { view: 'bookmarks' as const, label: 'Bookmark', icon: Bookmark },
  { view: 'pages' as const, label: 'Page', icon: NotebookText },
  { view: 'collections' as const, label: 'Collection', icon: LibraryBig },
  { view: 'polls' as const, label: 'Sondage', icon: ChartBar },
  { view: 'ideas' as const, label: 'Idée', icon: Lightbulb },
  { view: 'contacts' as const, label: 'Contact', icon: ContactRound },
  { view: 'documents' as const, label: 'Document', icon: FileText },
];

type DashboardPageProps = {
  memberId: string;
  instanceId: string;
  firstName?: string;
  avatarUrl?: string | null;
  instanceName?: string;
  role: 'ADMIN' | 'MEMBER';
  csrfToken: string;
  onAvatarUrlChange: (avatarUrl: string | null) => void;
  onLogout: () => Promise<void>;
};

export default function DashboardPage({
  memberId,
  instanceId,
  firstName = 'Maxime',
  avatarUrl = null,
  instanceName = 'Foyer Girard',
  role,
  csrfToken,
  onAvatarUrlChange,
  onLogout,
}: DashboardPageProps) {
  const [displayFirstName, setDisplayFirstName] = useState(firstName);
  const [displayAvatarUrl, setDisplayAvatarUrl] = useState(avatarUrl);
  const initials = displayFirstName.slice(0, 2).toUpperCase();
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [moreNavigationOpen, setMoreNavigationOpen] = useState(false);
  const [shoppingComposerOpen, setShoppingComposerOpen] = useState(false);
  const [agendaComposerOpen, setAgendaComposerOpen] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [mealComposerOpen, setMealComposerOpen] = useState(false);
  const [chatComposerOpen, setChatComposerOpen] = useState(false);
  const [bookmarkComposerOpen, setBookmarkComposerOpen] = useState(false);
  const [pageComposerOpen, setPageComposerOpen] = useState(false);
  const [collectionComposerOpen, setCollectionComposerOpen] = useState(false);
  const [pollComposerOpen, setPollComposerOpen] = useState(false);
  const [ideaComposerOpen, setIdeaComposerOpen] = useState(false);
  const [contactComposerOpen, setContactComposerOpen] = useState(false);
  const [documentComposerOpen, setDocumentComposerOpen] = useState(false);
  const [activeView, setActiveView] = useState<ViewId>(() =>
    window.location.pathname.startsWith('/music') ? 'music' : 'home');
  const [modules, setModules] = useState<ModuleConfig[] | null>(null);
  const [modulesError, setModulesError] = useState('');
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [personalPreferences, setPersonalPreferences] =
    useState<PersonalPreferences>(() =>
      parsePersonalPreferences(
        localStorage.getItem(preferencesStorageKey(instanceId, memberId)),
      ),
    );

  function moduleEnabled(key: ModuleKey) {
    return modules?.find((module) => module.key === key)?.enabled ?? true;
  }

  function moduleVisible(key: ModuleKey) {
    return (
      moduleEnabled(key) && !personalPreferences.hiddenModules.includes(key)
    );
  }

  const canCreate = quickCreateOptions.some((option) =>
    moduleVisible(option.view),
  );
  const activeViewInMoreNavigation =
    activeView === 'settings' ||
    secondaryNavigation.some((item) => item.id === activeView);

  function navigate(view: ViewId) {
    if (view === 'music') {
      window.history.pushState({}, '', '/music');
    } else if (window.location.pathname.startsWith('/music')) {
      window.history.pushState({}, '', '/');
    }
    setActiveView(view);
    setQuickAddOpen(false);
    setMoreNavigationOpen(false);
  }

  useEffect(() => {
    const onPop = () => setActiveView(window.location.pathname.startsWith('/music') ? 'music' : 'home');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function startCreation(view: ViewId) {
    navigate(view);
    if (view === 'shopping') setShoppingComposerOpen(true);
    if (view === 'agenda') setAgendaComposerOpen(true);
    if (view === 'tasks') setTaskComposerOpen(true);
    if (view === 'meals') setMealComposerOpen(true);
    if (view === 'chat') setChatComposerOpen(true);
    if (view === 'bookmarks') setBookmarkComposerOpen(true);
    if (view === 'pages') setPageComposerOpen(true);
    if (view === 'collections') setCollectionComposerOpen(true);
    if (view === 'polls') setPollComposerOpen(true);
    if (view === 'ideas') setIdeaComposerOpen(true);
    if (view === 'contacts') setContactComposerOpen(true);
    if (view === 'documents') setDocumentComposerOpen(true);
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
    const storageKey = preferencesStorageKey(instanceId, memberId);
    localStorage.setItem(storageKey, JSON.stringify(personalPreferences));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const refreshTheme = () =>
      applyTheme(
        personalPreferences.theme,
        media.matches,
        document.documentElement,
      );
    refreshTheme();
    media.addEventListener('change', refreshTheme);
    return () => media.removeEventListener('change', refreshTheme);
  }, [instanceId, memberId, personalPreferences]);

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
    function updateConnectionState() {
      setIsOnline(navigator.onLine);
    }
    window.addEventListener('online', updateConnectionState);
    window.addEventListener('offline', updateConnectionState);
    return () => {
      window.removeEventListener('online', updateConnectionState);
      window.removeEventListener('offline', updateConnectionState);
    };
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
        setMoreNavigationOpen(false);
      }
    }
    window.addEventListener('keydown', openSearch);
    return () => window.removeEventListener('keydown', openSearch);
  }, []);

  return (
    <>
      <Sheet open={moreNavigationOpen} onOpenChange={setMoreNavigationOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[80dvh] overflow-y-auto rounded-t-3xl pb-[calc(1rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <SheetHeader className="pr-12">
            <SheetTitle>Tous les modules</SheetTitle>
            <SheetDescription>
              Accédez aux autres espaces de votre foyer.
            </SheetDescription>
          </SheetHeader>
          <nav
            aria-label="Autres modules"
            className="grid grid-cols-2 gap-2 px-4"
          >
            {secondaryNavigation
              .filter((item) => item.id === 'members' || moduleVisible(item.id))
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={activeView === item.id ? 'page' : undefined}
                  onClick={() => navigate(item.id)}
                  className={`flex min-h-20 flex-col items-start justify-between rounded-xl border p-3 text-left font-medium transition-colors hover:bg-muted ${activeView === item.id ? 'border-primary bg-accent text-accent-foreground' : 'bg-background'}`}
                >
                  <item.icon
                    className="size-5 text-primary"
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </button>
              ))}
            <button
              type="button"
              aria-current={activeView === 'settings' ? 'page' : undefined}
              onClick={() => navigate('settings')}
              className={`flex min-h-20 flex-col items-start justify-between rounded-xl border p-3 text-left font-medium transition-colors hover:bg-muted ${activeView === 'settings' ? 'border-primary bg-accent text-accent-foreground' : 'bg-background'}`}
            >
              <Settings className="size-5 text-primary" aria-hidden="true" />
              <span>Paramètres</span>
            </button>
          </nav>
        </SheetContent>
      </Sheet>

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
              .filter((item) => moduleVisible(item.view))
              .map((item) => (
                <button
                  key={item.label}
                  onClick={() => startCreation(item.view)}
                  className="flex min-h-20 flex-col items-start justify-between rounded-xl border bg-background p-3 text-left font-medium transition-colors hover:bg-muted"
                >
                  <item.icon
                    className="size-5 text-primary"
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
                    .filter((item) => moduleVisible(item.id))
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
                    .filter(
                      (item) => item.id === 'members' || moduleVisible(item.id),
                    )
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
                  <Avatar className="size-8">
                    {displayAvatarUrl ? (
                      <AvatarImage src={displayAvatarUrl} alt="" />
                    ) : null}
                    <AvatarFallback className="bg-accent text-xs font-bold text-accent-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
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
                className="hidden rounded-xl bg-primary hover:bg-primary/80 sm:inline-flex"
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                Ajouter
              </Button>
            ) : null}
          </header>

          {!isOnline ? (
            <output className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
              <WifiOff className="size-4" aria-hidden="true" />
              Hors connexion · courses et tâches modifiables, agenda et repas
              consultables
            </output>
          ) : null}

          <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-10 md:pt-8">
            {activeView === 'settings' ? (
              <SettingsView
                role={role}
                modules={modules}
                loadError={modulesError}
                csrfToken={csrfToken}
                onToggle={toggleModule}
                personalPreferences={personalPreferences}
                onPersonalPreferencesChange={setPersonalPreferences}
                onFirstNameChange={setDisplayFirstName}
                onAvatarUrlChange={(nextAvatarUrl) => {
                  setDisplayAvatarUrl(nextAvatarUrl);
                  onAvatarUrlChange(nextAvatarUrl);
                }}
                onLogout={onLogout}
              />
            ) : activeView === 'shopping' ? (
              <ShoppingView
                currentMemberId={memberId}
                currentMemberName={displayFirstName}
                currentMemberAvatarUrl={displayAvatarUrl}
                instanceId={instanceId}
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
                  instanceId={instanceId}
                  csrfToken={csrfToken}
                  composerOpen={agendaComposerOpen}
                  onComposerOpenChange={setAgendaComposerOpen}
                  onOpenTasks={() => navigate('tasks')}
                />
              </Suspense>
            ) : activeView === 'tasks' ? (
              <TasksView
                currentMemberId={memberId}
                currentMemberName={displayFirstName}
                instanceId={instanceId}
                role={role}
                csrfToken={csrfToken}
                composerOpen={taskComposerOpen}
                onComposerOpenChange={setTaskComposerOpen}
              />
            ) : activeView === 'meals' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des repas…
                  </div>
                }
              >
                <MealsView
                  currentMemberId={memberId}
                  instanceId={instanceId}
                  role={role}
                  csrfToken={csrfToken}
                  composerOpen={mealComposerOpen}
                  onComposerOpenChange={setMealComposerOpen}
                />
              </Suspense>
            ) : activeView === 'chat' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des messages…
                  </div>
                }
              >
                <ChatView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={chatComposerOpen}
                  onComposerOpenChange={setChatComposerOpen}
                />
              </Suspense>
            ) : activeView === 'bookmarks' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des bookmarks…
                  </div>
                }
              >
                <BookmarksView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={bookmarkComposerOpen}
                  onComposerOpenChange={setBookmarkComposerOpen}
                />
              </Suspense>
            ) : activeView === 'pages' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des pages…
                  </div>
                }
              >
                <PagesView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={pageComposerOpen}
                  onComposerOpenChange={setPageComposerOpen}
                />
              </Suspense>
            ) : activeView === 'collections' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des collections…
                  </div>
                }
              >
                <CollectionsView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={collectionComposerOpen}
                  onComposerOpenChange={setCollectionComposerOpen}
                />
              </Suspense>
            ) : activeView === 'polls' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des sondages…
                  </div>
                }
              >
                <PollsView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={pollComposerOpen}
                  onComposerOpenChange={setPollComposerOpen}
                />
              </Suspense>
            ) : activeView === 'ideas' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des idées…
                  </div>
                }
              >
                <IdeasView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={ideaComposerOpen}
                  onComposerOpenChange={setIdeaComposerOpen}
                  onNavigate={navigate}
                />
              </Suspense>
            ) : activeView === 'contacts' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des contacts…
                  </div>
                }
              >
                <ContactsView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={contactComposerOpen}
                  onComposerOpenChange={setContactComposerOpen}
                />
              </Suspense>
            ) : activeView === 'documents' ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground">
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                    Chargement des documents…
                  </div>
                }
              >
                <DocumentsView
                  currentMemberId={memberId}
                  csrfToken={csrfToken}
                  composerOpen={documentComposerOpen}
                  onComposerOpenChange={setDocumentComposerOpen}
                />
              </Suspense>
            ) : activeView === 'music' ? (
              <Suspense fallback={<div className="flex min-h-[55vh] items-center justify-center gap-3 text-muted-foreground"><LoaderCircle className="animate-spin" aria-hidden="true" />Chargement de la musique…</div>}>
                <MusicView csrfToken={csrfToken} memberId={memberId} onOpenSettings={() => navigate('settings')} />
              </Suspense>
            ) : activeView === 'members' ? (
              <MembersView
                role={role}
                currentMemberId={memberId}
                csrfToken={csrfToken}
                musicEnabled={moduleVisible('music')}
              />
            ) : activeView === 'notifications' ? (
              <NotificationsView
                csrfToken={csrfToken}
                onUnreadCountChange={setUnreadNotificationCount}
              />
            ) : activeView === 'search' ? (
              <SearchView onNavigate={navigate} />
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
              className="fixed bottom-20 right-4 z-30 size-12 rounded-2xl bg-primary shadow-lg hover:bg-primary/80 sm:hidden"
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
                .filter((item) => item.id === 'more' || moduleVisible(item.id))
                .map((item) => (
                  <li key={item.label}>
                    <button
                      onClick={() =>
                        item.id === 'more'
                          ? setMoreNavigationOpen(true)
                          : navigate(item.id)
                      }
                      aria-current={
                        item.id === 'more'
                          ? activeViewInMoreNavigation
                            ? 'page'
                            : undefined
                          : activeView === item.id
                            ? 'page'
                            : undefined
                      }
                      className={`relative flex size-full flex-col items-center justify-center gap-1 text-xs ${item.id === 'more' ? (activeViewInMoreNavigation ? 'font-semibold text-primary' : 'text-muted-foreground') : activeView === item.id ? 'font-semibold text-primary' : 'text-muted-foreground'}`}
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
