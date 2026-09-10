'use client';

import { useEffect, useState } from 'react';

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

const primaryNavigation = [
  { label: 'Accueil', icon: Home, active: true },
  { label: 'Chat', icon: MessageCircle, badge: '3' },
  { label: 'Agenda', icon: CalendarDays },
  { label: 'Tâches', icon: CheckSquare2, badge: '2' },
];

const secondaryNavigation = [
  { label: 'Repas', icon: Utensils },
  { label: 'Courses', icon: ShoppingBasket },
  { label: 'Bookmarks', icon: Bookmark },
  { label: 'Membres', icon: Users },
];

const mobileNavigation = [
  { label: 'Accueil', icon: Home, active: true },
  { label: 'Chat', icon: MessageCircle, badge: true },
  { label: 'Agenda', icon: CalendarDays },
  { label: 'Tâches', icon: CheckSquare2 },
  { label: 'Plus', icon: CircleEllipsis },
];

type DashboardPageProps = {
  firstName?: string;
  instanceName?: string;
};

export default function DashboardPage({
  firstName = 'Maxime',
  instanceName = 'Foyer Girard',
}: DashboardPageProps) {
  const initials = firstName.slice(0, 2).toUpperCase();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'start_quick_add',
          title: 'Ouvrir la création rapide',
          description: 'Ouvre le même menu de création rapide que le bouton Ajouter de FamilyHub.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
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
            <DialogDescription>Choisissez ce que vous souhaitez créer.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Message', icon: MessageCircle },
              { label: 'Événement', icon: CalendarDays },
              { label: 'Tâche', icon: CheckSquare2 },
              { label: 'Article de courses', icon: ShoppingBasket },
              { label: 'Repas', icon: Utensils },
              { label: 'Bookmark', icon: Bookmark },
            ].map((item) => (
              <button key={item.label} className="flex min-h-20 flex-col items-start justify-between rounded-xl border bg-background p-3 text-left font-medium transition-colors hover:bg-muted">
                <item.icon className="size-5 text-[#087f72]" aria-hidden="true" />
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
              <p className="truncate text-base font-semibold tracking-tight">FamilyHub</p>
              <p className="truncate text-xs text-sidebar-foreground/55">{instanceName}</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Essentiel</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {primaryNavigation.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      isActive={item.active}
                      tooltip={item.label}
                      className="h-10 rounded-xl px-3"
                    >
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Notre espace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {secondaryNavigation.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton tooltip={item.label} className="h-10 rounded-xl px-3">
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
              <SidebarMenuButton tooltip="Paramètres" className="h-10 rounded-xl px-3">
                <Settings aria-hidden="true" />
                <span>Paramètres</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Mon profil" className="rounded-xl px-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#d9f4ef] text-xs font-bold text-[#075e55]">
                  {initials}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-medium">{firstName}</span>
                  <span className="truncate text-xs text-sidebar-foreground/55">Administrateur</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-x-hidden">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-xl md:px-7">
          <SidebarTrigger aria-label="Ouvrir la navigation" className="hidden md:inline-flex" />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="md:hidden">
              <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Sparkles className="size-4" aria-hidden="true" />
              </div>
            </div>
            <button className="hidden h-9 w-full max-w-sm items-center gap-2 rounded-xl border bg-muted/45 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted md:flex">
              <Search className="size-4" aria-hidden="true" />
              <span>Rechercher dans le foyer</span>
              <kbd className="ml-auto rounded-md border bg-background px-1.5 py-0.5 text-xs">⌘ K</kbd>
            </button>
            <div className="md:hidden">
              <p className="truncate font-semibold">FamilyHub</p>
              <p className="text-xs text-muted-foreground">{instanceName}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Notifications" className="relative rounded-xl">
            <Bell aria-hidden="true" />
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[#e49131] ring-2 ring-background" />
          </Button>
          <Button onClick={() => setQuickAddOpen(true)} className="hidden rounded-xl bg-[#087f72] hover:bg-[#076d63] sm:inline-flex">
            <Plus data-icon="inline-start" aria-hidden="true" />
            Ajouter
          </Button>
        </header>

        <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-10 md:pt-8">
          <section className="mb-7 flex items-end justify-between gap-4">
            <div>
              <p className="mb-1 text-sm font-medium text-[#087f72]">Mercredi 9 septembre</p>
              <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Bonjour {firstName}</h1>
              <p className="mt-1 text-base text-muted-foreground">Voici ce qui compte aujourd’hui.</p>
            </div>
            <div className="hidden items-center gap-2 rounded-full border bg-card px-3 py-2 text-sm text-muted-foreground lg:flex">
              <span className="size-2 rounded-full bg-[#23a995]" />
              Tout est synchronisé
            </div>
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,.85fr)]">
            <div className="space-y-6">
              <section aria-labelledby="today-title">
                <div className="mb-3 flex items-center justify-between">
                  <h2 id="today-title" className="text-lg font-semibold tracking-tight">Aujourd’hui</h2>
                  <Button variant="ghost" size="sm" className="text-muted-foreground">
                    Voir l’agenda
                    <ChevronRight data-icon="inline-end" aria-hidden="true" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Card className="relative border-0 bg-[#eef8f6] ring-[#087f72]/15">
                    <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-[#087f72]" />
                    <CardHeader className="pl-5">
                      <CardDescription className="font-medium text-[#087f72]">18:30 · Agenda</CardDescription>
                      <CardTitle className="text-base">Rendez-vous chez le dentiste</CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center gap-2 pl-5 text-sm text-muted-foreground">
                      <span className="grid size-6 place-items-center rounded-full bg-white text-[10px] font-bold text-[#075e55]">J</span>
                      Jade · Cabinet du Parc
                    </CardContent>
                  </Card>

                  <Card className="relative border-0 bg-[#fff7e9] ring-[#e49131]/20">
                    <span className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-[#e49131]" />
                    <CardHeader className="pl-5">
                      <CardDescription className="font-medium text-[#a55e10]">À faire · Tâche</CardDescription>
                      <CardTitle className="text-base">Sortir les poubelles</CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-3 pl-5">
                      <span className="text-sm text-muted-foreground">Affectée à vous</span>
                      <Button size="sm" variant="outline" className="rounded-full bg-white">
                        <Check data-icon="inline-start" aria-hidden="true" />
                        Fait
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </section>

              <section aria-labelledby="attention-title">
                <div className="mb-3 flex items-center justify-between">
                  <h2 id="attention-title" className="text-lg font-semibold tracking-tight">À voir</h2>
                  <Badge variant="secondary" className="bg-[#e7f5f2] text-[#075e55]">3 nouveautés</Badge>
                </div>
                <Card className="gap-0 py-0">
                  {[
                    { icon: MessageCircle, color: 'bg-[#e7f5f2] text-[#087f72]', title: 'Parents', detail: '3 nouveaux messages', time: 'Il y a 8 min' },
                    { icon: ShoppingBasket, color: 'bg-[#fff3df] text-[#a55e10]', title: 'Liste de courses', detail: 'Jade demande : shampoing', time: 'Il y a 35 min' },
                    { icon: CheckSquare2, color: 'bg-[#eef0ff] text-[#5651a8]', title: 'Préparer les affaires de sport', detail: 'Nouvelle tâche affectée', time: 'Hier' },
                  ].map((item, index) => (
                    <button
                      key={item.title}
                      className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/45 ${index ? 'border-t' : ''}`}
                    >
                      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${item.color}`}>
                        <item.icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{item.title}</span>
                        <span className="block truncate text-sm text-muted-foreground">{item.detail}</span>
                      </span>
                      <span className="hidden text-xs text-muted-foreground sm:block">{item.time}</span>
                      <ChevronRight className="size-4 text-muted-foreground/60" aria-hidden="true" />
                    </button>
                  ))}
                </Card>
              </section>
            </div>

            <aside className="space-y-6">
              <section aria-labelledby="meal-title">
                <div className="mb-3 flex items-center justify-between">
                  <h2 id="meal-title" className="text-lg font-semibold tracking-tight">Ce soir</h2>
                  <Button variant="ghost" size="icon-sm" aria-label="Options du repas">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </div>
                <Card className="border-0 bg-[#102b3f] text-white ring-0 shadow-[0_18px_45px_-28px_rgba(16,43,63,.8)]">
                  <CardHeader>
                    <CardDescription className="text-white/60">Dîner · 4 personnes</CardDescription>
                    <CardTitle className="text-xl">Curry de légumes</CardTitle>
                    <CardAction>
                      <span className="grid size-10 place-items-center rounded-xl bg-white/10">
                        <Utensils className="size-4" aria-hidden="true" />
                      </span>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <div className="flex -space-x-1.5" aria-label="Préférences des membres">
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

              <section aria-labelledby="activity-title">
                <h2 id="activity-title" className="mb-3 text-lg font-semibold tracking-tight">Activité récente</h2>
                <Card className="gap-0 py-1">
                  {[
                    ['JG', 'Jade a ajouté un bookmark', 'Idées week-end · il y a 1 h'],
                    ['L', 'Léo a terminé une corvée', 'Vider le lave-vaisselle · il y a 2 h'],
                    ['MG', 'Vous avez modifié une page', 'Vacances en Bretagne · hier'],
                  ].map(([initials, title, detail]) => (
                    <div key={title} className="flex gap-3 px-4 py-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-foreground/70">{initials}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug">{title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
                      </div>
                    </div>
                  ))}
                </Card>
              </section>
            </aside>
          </div>
        </div>

        <Button
          size="icon-lg"
          aria-label="Ajouter"
          onClick={() => setQuickAddOpen(true)}
          className="fixed bottom-20 right-4 z-30 size-12 rounded-2xl bg-[#087f72] shadow-lg hover:bg-[#076d63] sm:hidden"
        >
          <Plus className="size-5" aria-hidden="true" />
        </Button>

        <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
          <ul className="grid h-16 grid-cols-5 px-1">
            {mobileNavigation.map((item) => (
              <li key={item.label}>
                <button className={`relative flex size-full flex-col items-center justify-center gap-1 text-xs ${item.active ? 'font-semibold text-[#087f72]' : 'text-muted-foreground'}`}>
                  <item.icon className="size-5" aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.badge ? <span className="absolute left-[calc(50%+5px)] top-2.5 size-2 rounded-full bg-[#e49131] ring-2 ring-background" /> : null}
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
