'use client';

import { useEffect, useState } from 'react';

import type { ModuleConfig, ModuleKey } from '@familyhub/contracts';

import {
  Bell,
  Bookmark,
  CalendarDays,
  Check,
  CheckSquare2,
  ChevronRight,
  CircleEllipsis,
  Home,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShoppingBasket,
  Sparkles,
  Users,
  Utensils,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { ShoppingView } from './shopping-view';
import { MembersView } from './members-view';
import { NotificationsView } from './notifications-view';
import { SettingsView } from './settings-view';

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
  { id: 'home' as const, label: 'Accueil', icon: Home },
  { id: 'chat' as const, label: 'Chat', icon: MessageCircle, badge: '3' },
  { id: 'agenda' as const, label: 'Agenda', icon: CalendarDays },
  { id: 'tasks' as const, label: 'Tâches', icon: CheckSquare2, badge: '2' },
];

const secondaryNavigation = [
  { id: 'meals' as const, label: 'Repas', icon: Utensils },
  { id: 'shopping' as const, label: 'Courses', icon: ShoppingBasket },
  { id: 'bookmarks' as const, label: 'Bookmarks', icon: Bookmark },
  { id: 'members' as const, label: 'Membres', icon: Users },
];

const mobileNavigation = [
  { id: 'home' as const, label: 'Accueil', icon: Home },
  { id: 'chat' as const, label: 'Chat', icon: MessageCircle, badge: true },
  { id: 'agenda' as const, label: 'Agenda', icon: CalendarDays },
  { id: 'tasks' as const, label: 'Tâches', icon: CheckSquare2 },
  { id: 'more' as const, label: 'Plus', icon: CircleEllipsis },
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

const attentionItems = [
  {
    view: 'chat' as const,
    icon: MessageCircle,
    color: 'bg-[#e7f5f2] text-[#087f72]',
    title: 'Parents',
    detail: '3 nouveaux messages',
    time: 'Il y a 8 min',
  },
  {
    view: 'shopping' as const,
    icon: ShoppingBasket,
    color: 'bg-[#fff3df] text-[#a55e10]',
    title: 'Liste de courses',
    detail: 'Ouvrir la liste partagée',
    time: 'Maintenant',
  },
  {
    view: 'tasks' as const,
    icon: CheckSquare2,
    color: 'bg-[#eef0ff] text-[#5651a8]',
    title: 'Préparer les affaires de sport',
    detail: 'Nouvelle tâche affectée',
    time: 'Hier',
  },
];

const recentActivityItems = [
  {
    module: 'bookmarks' as const,
    initials: 'JG',
    title: 'Jade a ajouté un bookmark',
    detail: 'Idées week-end · il y a 1 h',
  },
  {
    module: 'tasks' as const,
    initials: 'L',
    title: 'Léo a terminé une corvée',
    detail: 'Vider le lave-vaisselle · il y a 2 h',
  },
  {
    module: 'pages' as const,
    initials: 'MG',
    title: 'Vous avez modifié une page',
    detail: 'Vacances en Bretagne · hier',
  },
];

type DashboardPageProps = {
  firstName?: string;
  instanceName?: string;
  role: 'ADMIN' | 'MEMBER';
  csrfToken: string;
  onLogout: () => Promise<void>;
};

export default function DashboardPage({
  firstName = 'Maxime',
  instanceName = 'Foyer Girard',
  role,
  csrfToken,
  onLogout,
}: DashboardPageProps) {
  const [displayFirstName, setDisplayFirstName] = useState(firstName);
  const initials = displayFirstName.slice(0, 2).toUpperCase();
  const todayLabel = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [shoppingComposerOpen, setShoppingComposerOpen] = useState(false);
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
  const visibleAttentionItems = attentionItems.filter((item) =>
    moduleEnabled(item.view),
  );
  const visibleActivityItems = recentActivityItems.filter((item) =>
    moduleEnabled(item.module),
  );

  function navigate(view: ViewId) {
    setActiveView(view);
    setQuickAddOpen(false);
  }

  function startCreation(view: ViewId) {
    navigate(view);
    if (view === 'shopping') setShoppingComposerOpen(true);
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
            ) : activeView === 'members' ? (
              <MembersView role={role} csrfToken={csrfToken} />
            ) : activeView === 'notifications' ? (
              <NotificationsView
                csrfToken={csrfToken}
                onUnreadCountChange={setUnreadNotificationCount}
              />
            ) : activeView !== 'home' ? (
              <ComingSoonView view={activeView} />
            ) : (
              <>
                <section className="mb-7 flex items-end justify-between gap-4">
                  <div>
                    <p className="mb-1 text-sm font-medium text-[#087f72]">
                      {todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}
                    </p>
                    <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                      Bonjour {displayFirstName}
                    </h1>
                    <p className="mt-1 text-base text-muted-foreground">
                      Voici ce qui compte aujourd’hui.
                    </p>
                  </div>
                  <div className="hidden items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm text-muted-foreground lg:flex">
                    <span className="size-2 rounded-full bg-[#23a995]" />
                    Tout est synchronisé
                  </div>
                </section>

                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,.85fr)]">
                  <div className="space-y-6">
                    {moduleEnabled('agenda') || moduleEnabled('tasks') ? (
                      <section aria-labelledby="today-title">
                        <div className="mb-3 flex items-center justify-between">
                          <h2
                            id="today-title"
                            className="text-lg font-semibold tracking-tight"
                          >
                            Aujourd’hui
                          </h2>
                          {moduleEnabled('agenda') ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground"
                              onClick={() => navigate('agenda')}
                            >
                              Voir l’agenda
                              <ChevronRight
                                data-icon="inline-end"
                                aria-hidden="true"
                              />
                            </Button>
                          ) : null}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {moduleEnabled('agenda') ? (
                            <Card className="relative border-0 bg-[#eef8f6] ring-[#087f72]/15">
                              <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-[#087f72]" />
                              <CardHeader className="pl-5">
                                <CardDescription className="font-medium text-[#087f72]">
                                  18:30 · Agenda
                                </CardDescription>
                                <CardTitle className="text-base">
                                  Rendez-vous chez le dentiste
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="flex items-center gap-2 pl-5 text-sm text-muted-foreground">
                                <span className="grid size-6 place-items-center rounded-full bg-white text-[10px] font-bold text-[#075e55]">
                                  J
                                </span>
                                Jade · Cabinet du Parc
                              </CardContent>
                            </Card>
                          ) : null}

                          {moduleEnabled('tasks') ? (
                            <Card className="relative border-0 bg-[#fff7e9] ring-[#e49131]/20">
                              <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-[#e49131]" />
                              <CardHeader className="pl-5">
                                <CardDescription className="font-medium text-[#a55e10]">
                                  À faire · Tâche
                                </CardDescription>
                                <CardTitle className="text-base">
                                  Sortir les poubelles
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="flex items-center justify-between gap-3 pl-5">
                                <span className="text-sm text-muted-foreground">
                                  Affectée à vous
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-full bg-white"
                                  onClick={() => navigate('tasks')}
                                >
                                  <Check
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />
                                  Fait
                                </Button>
                              </CardContent>
                            </Card>
                          ) : null}
                        </div>
                      </section>
                    ) : null}

                    {visibleAttentionItems.length ? (
                      <section aria-labelledby="attention-title">
                        <div className="mb-3 flex items-center justify-between">
                          <h2
                            id="attention-title"
                            className="text-lg font-semibold tracking-tight"
                          >
                            À voir
                          </h2>
                          <Badge
                            variant="secondary"
                            className="bg-[#e7f5f2] text-[#075e55]"
                          >
                            {visibleAttentionItems.length} nouveauté
                            {visibleAttentionItems.length > 1 ? 's' : ''}
                          </Badge>
                        </div>
                        <Card className="gap-0 py-0">
                          {visibleAttentionItems.map((item, index) => (
                            <button
                              key={item.title}
                              onClick={() => navigate(item.view)}
                              className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/45 ${index ? 'border-t' : ''}`}
                            >
                              <span
                                className={`grid size-10 shrink-0 place-items-center rounded-xl ${item.color}`}
                              >
                                <item.icon
                                  className="size-4"
                                  aria-hidden="true"
                                />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium">
                                  {item.title}
                                </span>
                                <span className="block truncate text-sm text-muted-foreground">
                                  {item.detail}
                                </span>
                              </span>
                              <span className="hidden text-xs text-muted-foreground sm:block">
                                {item.time}
                              </span>
                              <ChevronRight
                                className="size-4 text-muted-foreground/60"
                                aria-hidden="true"
                              />
                            </button>
                          ))}
                        </Card>
                      </section>
                    ) : null}
                  </div>

                  <aside className="space-y-6">
                    {moduleEnabled('meals') ? (
                      <section aria-labelledby="meal-title">
                        <div className="mb-3 flex items-center justify-between">
                          <h2
                            id="meal-title"
                            className="text-lg font-semibold tracking-tight"
                          >
                            Ce soir
                          </h2>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Options du repas"
                            onClick={() => navigate('meals')}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </div>
                        <Card className="border-0 bg-[#102b3f] text-white ring-0 shadow-[0_18px_45px_-28px_rgba(16,43,63,.8)]">
                          <CardHeader>
                            <CardDescription className="text-white/60">
                              Dîner · 4 personnes
                            </CardDescription>
                            <CardTitle className="text-xl">
                              Curry de légumes
                            </CardTitle>
                            <CardAction>
                              <span className="grid size-10 place-items-center rounded-xl bg-white/10">
                                <Utensils
                                  className="size-4"
                                  aria-hidden="true"
                                />
                              </span>
                            </CardAction>
                          </CardHeader>
                          <CardContent>
                            <div
                              className="flex -space-x-1.5"
                              aria-label="Préférences des membres"
                            >
                              {['MG', 'JG', 'L', 'N'].map((initials, index) => (
                                <span
                                  key={initials}
                                  className="grid size-8 place-items-center rounded-full border-2 border-[#102b3f] bg-[#d9f4ef] text-[10px] font-bold text-[#075e55]"
                                  style={{ zIndex: 4 - index }}
                                >
                                  {initials}
                                </span>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </section>
                    ) : null}

                    {visibleActivityItems.length ? (
                      <section aria-labelledby="activity-title">
                        <h2
                          id="activity-title"
                          className="mb-3 text-lg font-semibold tracking-tight"
                        >
                          Activité récente
                        </h2>
                        <Card className="gap-0 py-1">
                          {visibleActivityItems.map((item) => (
                            <div
                              key={item.title}
                              className="flex gap-3 px-4 py-3"
                            >
                              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-foreground/70">
                                {item.initials}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium leading-snug">
                                  {item.title}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {item.detail}
                                </p>
                              </div>
                            </div>
                          ))}
                        </Card>
                      </section>
                    ) : null}
                  </aside>
                </div>
              </>
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
    'home' | 'shopping' | 'members' | 'settings' | 'notifications'
  >,
  { title: string; description: string }
> = {
  chat: {
    title: 'Chat',
    description:
      'La messagerie familiale arrive dans la prochaine tranche fonctionnelle.',
  },
  agenda: {
    title: 'Agenda',
    description: 'Les événements partagés seront bientôt reliés à cette vue.',
  },
  tasks: {
    title: 'Tâches',
    description: 'La gestion des tâches et corvées sera bientôt disponible.',
  },
  meals: {
    title: 'Repas',
    description: 'La planification des repas sera bientôt disponible.',
  },
  bookmarks: {
    title: 'Bookmarks',
    description: 'Le partage de liens sera bientôt disponible.',
  },
  search: {
    title: 'Recherche',
    description: 'La recherche globale sera bientôt disponible.',
  },
};

function ComingSoonView({
  view,
}: {
  view: Exclude<
    ViewId,
    'home' | 'shopping' | 'members' | 'settings' | 'notifications'
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
