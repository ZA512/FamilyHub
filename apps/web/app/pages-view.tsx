import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { localeTag } from '@/lib/i18n';
import { EditorContent, useEditor } from '@tiptap/react';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import {
  ArrowLeft,
  Bold,
  BookOpenText,
  Columns3,
  Folder,
  Globe2,
  Heading2,
  History,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
  Quote,
  Redo2,
  Rows3,
  Search,
  Table2,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';

import {
  emptyPageContent,
  type FamilyGroup,
  type FamilyMember,
  type FamilyPage,
  type FamilyPageSummary,
  type PageContentNode,
  type PageDocument,
  type PageRevision,
  type PageVisibility,
} from '@familyhub/contracts';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type PageScope = 'all' | 'mine' | 'shared';

type PagesViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

type PageDraft = {
  title: string;
  content: PageDocument;
  folder: string | null;
  tags: string[];
  visibility: PageVisibility;
  groupIds: string[];
  memberIds: string[];
  linkedPageIds: string[];
};

const visibilityLabels: Record<PageVisibility, string> = {
  PRIVATE: 'Privée',
  ALL_MEMBERS: 'Tout le foyer',
  GROUPS: 'Certains groupes',
  SELECTED_USERS: 'Certaines personnes',
};

export function PagesView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: PagesViewProps) {
  const [pages, setPages] = useState<FamilyPageSummary[]>([]);
  const [referencePages, setReferencePages] = useState<FamilyPageSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<FamilyPage | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [scope, setScope] = useState<PageScope>('all');
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState('');
  const [editingPage, setEditingPage] = useState<FamilyPage | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<PageRevision[]>([]);
  const [toDelete, setToDelete] = useState<FamilyPage | null>(null);
  const loadingPage = Boolean(selectedId && selectedPage?.id !== selectedId);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/members', { signal: controller.signal }),
      fetch('/api/v1/groups', { signal: controller.signal }),
    ])
      .then(async ([membersResponse, groupsResponse]) => {
        if (!membersResponse.ok || !groupsResponse.ok) {
          throw new Error('Impossible de charger les options de partage.');
        }
        return Promise.all([
          membersResponse.json() as Promise<{ members: FamilyMember[] }>,
          groupsResponse.json() as Promise<{ groups: FamilyGroup[] }>,
        ]);
      })
      .then(([memberPayload, groupPayload]) => {
        setMembers(
          memberPayload.members.filter(
            (member) =>
              member.status === 'ACTIVE' && member.id !== currentMemberId,
          ),
        );
        setGroups(groupPayload.groups);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error ? reason.message : 'Partage indisponible.',
          );
        }
      });
    return () => controller.abort();
  }, [currentMemberId]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ scope, limit: '30' });
      if (query.trim()) params.set('q', query.trim());
      if (folder) params.set('folder', folder);
      if (tag) params.set('tag', tag);
      fetch(`/api/v1/pages?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Impossible de charger les pages.');
          return (await response.json()) as {
            pages: FamilyPageSummary[];
            hasMore: boolean;
          };
        })
        .then((payload) => {
          setPages(payload.pages);
          setHasMore(payload.hasMore);
          setSelectedId((current) =>
            current && payload.pages.some((page) => page.id === current)
              ? current
              : (payload.pages[0]?.id ?? null),
          );
          setError('');
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              reason instanceof Error ? reason.message : 'Pages indisponibles.',
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [folder, query, reloadToken, scope, tag]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/pages?scope=all&limit=100', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { pages: FamilyPageSummary[] };
      })
      .then((payload) => payload && setReferencePages(payload.pages))
      .catch(() => undefined);
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/v1/pages/${selectedId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Impossible d’ouvrir cette page.');
        return (await response.json()) as { page: FamilyPage };
      })
      .then((payload) => {
        setSelectedPage(payload.page);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error ? reason.message : 'Page indisponible.',
          );
          setSelectedId(null);
        }
      });
    return () => controller.abort();
  }, [selectedId]);

  const folders = useMemo(
    () =>
      [
        ...new Set(
          pages
            .map((page) => page.folder)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort((left, right) => left.localeCompare(right, localeTag())),
    [pages],
  );
  const tags = useMemo(
    () =>
      [...new Set(pages.flatMap((page) => page.tags))].sort((left, right) =>
        left.localeCompare(right, localeTag()),
      ),
    [pages],
  );

  function openNew() {
    setEditingPage(null);
    setScope('all');
    onComposerOpenChange(true);
  }

  function openEdit() {
    if (!selectedPage?.editable) return;
    setEditingPage(selectedPage);
    onComposerOpenChange(true);
  }

  function closeEditor() {
    if (submitting) return;
    setEditingPage(null);
    onComposerOpenChange(false);
  }

  async function savePage(draft: PageDraft) {
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        editingPage ? `/api/v1/pages/${editingPage.id}` : '/api/v1/pages',
        {
          method: editingPage ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            ...draft,
            ...(editingPage
              ? { version: editingPage.version }
              : { clientMutationId: crypto.randomUUID() }),
          }),
        },
      );
      if (response.status === 409) {
        throw new Error(
          'Cette page a été modifiée ailleurs. Rechargez-la avant de réessayer.',
        );
      }
      if (!response.ok) throw new Error('La page n’a pas pu être enregistrée.');
      const payload = (await response.json()) as { page: FamilyPage };
      setSelectedId(payload.page.id);
      setSelectedPage(payload.page);
      setEditingPage(null);
      onComposerOpenChange(false);
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function openHistory() {
    if (!selectedPage) return;
    setHistoryOpen(true);
    setRevisions([]);
    try {
      const response = await fetch(
        `/api/v1/pages/${selectedPage.id}/revisions`,
      );
      if (!response.ok) throw new Error('Impossible de charger l’historique.');
      const payload = (await response.json()) as { revisions: PageRevision[] };
      setRevisions(payload.revisions);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Historique indisponible.',
      );
    }
  }

  async function restoreRevision(revision: PageRevision) {
    if (!selectedPage || restoring) return;
    setRestoring(true);
    try {
      const response = await fetch(`/api/v1/pages/${selectedPage.id}/restore`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          revisionId: revision.id,
          version: selectedPage.version,
        }),
      });
      if (response.status === 409) {
        throw new Error(
          'La page ou ses destinataires ont changé. Rechargez avant de restaurer.',
        );
      }
      if (!response.ok)
        throw new Error('Cette version n’a pas pu être restaurée.');
      const payload = (await response.json()) as { page: FamilyPage };
      setSelectedPage(payload.page);
      setHistoryOpen(false);
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Restauration impossible.',
      );
    } finally {
      setRestoring(false);
    }
  }

  async function deletePage() {
    if (!toDelete) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/pages/${toDelete.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('Suppression impossible.');
      setToDelete(null);
      setSelectedId(null);
      setSelectedPage(null);
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMore() {
    const oldest = pages.at(-1);
    if (!oldest || !hasMore) return;
    const params = new URLSearchParams({
      scope,
      limit: '30',
      before: oldest.updatedAt,
      beforeId: oldest.id,
    });
    if (query.trim()) params.set('q', query.trim());
    if (folder) params.set('folder', folder);
    if (tag) params.set('tag', tag);
    try {
      const response = await fetch(`/api/v1/pages?${params}`);
      if (!response.ok) throw new Error('Impossible de charger la suite.');
      const payload = (await response.json()) as {
        pages: FamilyPageSummary[];
        hasMore: boolean;
      };
      setPages((current) => [
        ...current,
        ...payload.pages.filter(
          (page) => !current.some((item) => item.id === page.id),
        ),
      ]);
      setHasMore(payload.hasMore);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      );
    }
  }

  return (
    <>
      {composerOpen ? (
        <PageEditorDialog
          open
          page={editingPage}
          pages={referencePages}
          members={members}
          groups={groups}
          submitting={submitting}
          error={error}
          onClose={closeEditor}
          onSave={(draft) => void savePage(draft)}
        />
      ) : null}

      <HistoryDialog
        open={historyOpen}
        revisions={revisions}
        editable={Boolean(selectedPage?.editable)}
        restoring={restoring}
        onOpenChange={setHistoryOpen}
        onRestore={(revision) => void restoreRevision(revision)}
      />

      <AlertDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette page ?</AlertDialogTitle>
            <AlertDialogDescription>
              Elle disparaîtra du foyer et des liens créés depuis les autres
              pages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => void deletePage()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              <Trash2 aria-hidden="true" /> Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section>
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-sm font-medium text-[#087f72]">
              Mémoire du foyer
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Pages
            </h1>
          </div>
          <Button
            onClick={openNew}
            className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
          >
            <Plus aria-hidden="true" /> Nouvelle page
          </Button>
        </div>

        {error && !composerOpen ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            value={scope}
            onValueChange={(value) => setScope(value as PageScope)}
          >
            <TabsList>
              <TabsTrigger value="all">Toutes</TabsTrigger>
              <TabsTrigger value="mine">Mes pages</TabsTrigger>
              <TabsTrigger value="shared">Partagées</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full lg:max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher dans les pages…"
              aria-label="Rechercher dans les pages"
              className="pl-9 pr-9"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Effacer la recherche"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>

        {folders.length || tags.length || folder || tag ? (
          <div
            className="mb-4 flex flex-wrap gap-2"
            aria-label="Filtres des pages"
          >
            {folder || tag ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFolder('');
                  setTag('');
                }}
              >
                <X aria-hidden="true" /> Effacer les filtres
              </Button>
            ) : null}
            {folders.map((item) => (
              <Button
                key={`folder:${item}`}
                size="sm"
                variant={folder === item ? 'default' : 'outline'}
                className={folder === item ? 'bg-[#087f72]' : ''}
                onClick={() => setFolder(folder === item ? '' : item)}
              >
                <Folder aria-hidden="true" /> {item}
              </Button>
            ))}
            {tags.map((item) => (
              <Button
                key={`tag:${item}`}
                size="sm"
                variant={tag === item ? 'default' : 'outline'}
                className={tag === item ? 'bg-[#087f72]' : ''}
                onClick={() => setTag(tag === item ? '' : item)}
              >
                #{item}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="grid min-h-[58vh] overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside
            className={`${selectedId ? 'hidden lg:block' : 'block'} border-r bg-muted/20`}
            aria-label="Liste des pages"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <LoaderCircle className="animate-spin" aria-hidden="true" />{' '}
                Chargement…
              </div>
            ) : pages.length ? (
              <div className="divide-y">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => setSelectedId(page.id)}
                    className={`w-full px-4 py-4 text-left transition-colors hover:bg-muted/55 ${selectedId === page.id ? 'bg-[#e7f5f2]' : ''}`}
                  >
                    <span className="line-clamp-1 font-medium">
                      {page.title}
                    </span>
                    {page.excerpt ? (
                      <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {page.excerpt}
                      </span>
                    ) : null}
                    <span className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      {page.folder ? (
                        <>
                          <Folder className="size-3" aria-hidden="true" />{' '}
                          {page.folder}
                        </>
                      ) : (
                        `Par ${page.createdByName}`
                      )}
                    </span>
                  </button>
                ))}
                {hasMore ? (
                  <div className="p-3 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void loadMore()}
                    >
                      Charger la suite
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center p-8 text-center">
                <BookOpenText
                  className="mb-3 text-[#087f72]"
                  aria-hidden="true"
                />
                <p className="font-medium">Aucune page</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Créez la première mémoire utile du foyer.
                </p>
              </div>
            )}
          </aside>

          <main
            className={`${selectedId ? 'block' : 'hidden lg:block'} min-w-0`}
          >
            {loadingPage ? (
              <div className="flex min-h-[58vh] items-center justify-center gap-3 text-muted-foreground">
                <LoaderCircle className="animate-spin" aria-hidden="true" />{' '}
                Ouverture de la page…
              </div>
            ) : selectedId && selectedPage?.id === selectedId ? (
              <PageReader
                page={selectedPage}
                pages={referencePages}
                onBack={() => setSelectedId(null)}
                onEdit={openEdit}
                onHistory={() => void openHistory()}
                onDelete={() => setToDelete(selectedPage)}
                onInternalLink={setSelectedId}
              />
            ) : (
              <div className="hidden min-h-[58vh] place-items-center text-center text-muted-foreground lg:grid">
                <div>
                  <BookOpenText className="mx-auto mb-3" aria-hidden="true" />
                  <p>Choisissez une page à consulter.</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </section>
    </>
  );
}

function PageReader({
  page,
  pages,
  onBack,
  onEdit,
  onHistory,
  onDelete,
  onInternalLink,
}: {
  page: FamilyPage;
  pages: FamilyPageSummary[];
  onBack: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
  onInternalLink: (id: string) => void;
}) {
  const linkedPages = page.linkedPageIds
    .map((id) => pages.find((item) => item.id === id))
    .filter((item): item is FamilyPageSummary => Boolean(item));
  return (
    <article className="px-5 py-5 sm:px-8 sm:py-7">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 mb-2 lg:hidden"
          >
            <ArrowLeft aria-hidden="true" /> Toutes les pages
          </Button>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {page.folder ? (
              <Badge variant="secondary">
                <Folder aria-hidden="true" /> {page.folder}
              </Badge>
            ) : null}
            {page.visibility === 'PRIVATE' ? (
              <Lock className="size-3.5" aria-hidden="true" />
            ) : page.visibility === 'ALL_MEMBERS' ? (
              <Globe2 className="size-3.5" aria-hidden="true" />
            ) : (
              <Users className="size-3.5" aria-hidden="true" />
            )}
            <span>
              {page.editable
                ? visibilityLabels[page.visibility]
                : `Partagée par ${page.createdByName}`}
            </span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {page.title}
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Mise à jour {formatDate(page.updatedAt)} · version {page.version}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onHistory}
            aria-label={`Historique de ${page.title}`}
          >
            <History aria-hidden="true" />
          </Button>
          {page.editable ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={onEdit}
                aria-label={`Modifier ${page.title}`}
              >
                <Pencil aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                aria-label={`Supprimer ${page.title}`}
                className="hover:text-red-600"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {page.tags.length ? (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {page.tags.map((item) => (
            <Badge key={item} variant="outline">
              #{item}
            </Badge>
          ))}
        </div>
      ) : null}
      <RichContent content={page.content} onInternalLink={onInternalLink} />
      {linkedPages.length ? (
        <aside className="mt-8 border-t pt-5">
          <h3 className="mb-2 text-sm font-semibold">Pages liées</h3>
          <div className="flex flex-wrap gap-2">
            {linkedPages.map((linked) => (
              <Button
                key={linked.id}
                variant="outline"
                size="sm"
                onClick={() => onInternalLink(linked.id)}
              >
                <Link2 aria-hidden="true" /> {linked.title}
              </Button>
            ))}
          </div>
        </aside>
      ) : null}
    </article>
  );
}

function PageEditorDialog({
  open,
  page,
  pages,
  members,
  groups,
  submitting,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  page: FamilyPage | null;
  pages: FamilyPageSummary[];
  members: FamilyMember[];
  groups: FamilyGroup[];
  submitting: boolean;
  error: string;
  onClose: () => void;
  onSave: (draft: PageDraft) => void;
}) {
  const [content, setContent] = useState<PageDocument>(
    page?.content ?? emptyPageContent,
  );
  const [linkedPageIds, setLinkedPageIds] = useState(page?.linkedPageIds ?? []);
  const [visibility, setVisibility] = useState<PageVisibility>(
    page?.visibility ?? 'PRIVATE',
  );
  const [selectedMembers, setSelectedMembers] = useState(page?.memberIds ?? []);
  const [selectedGroups, setSelectedGroups] = useState(page?.groupIds ?? []);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tags = formText(data, 'tags')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    onSave({
      title: formText(data, 'title'),
      content,
      folder: formText(data, 'folder').trim() || null,
      tags,
      visibility,
      groupIds: visibility === 'GROUPS' ? selectedGroups : [],
      memberIds: visibility === 'SELECTED_USERS' ? selectedMembers : [],
      linkedPageIds,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[94dvh] max-w-5xl flex-col overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4 sm:px-6">
          <DialogTitle>
            {page ? 'Modifier la page' : 'Nouvelle page'}
          </DialogTitle>
          <DialogDescription>
            Écrivez comme dans un document, puis choisissez qui peut la
            consulter.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {error ? (
              <p
                role="alert"
                className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="page-title">Titre</Label>
                <Input
                  id="page-title"
                  name="title"
                  required
                  maxLength={160}
                  defaultValue={page?.title ?? ''}
                  placeholder="Ex. Informations de la maison"
                  className="text-base font-medium"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="page-folder">Dossier</Label>
                <Input
                  id="page-folder"
                  name="folder"
                  maxLength={80}
                  defaultValue={page?.folder ?? ''}
                  placeholder="Ex. Maison"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="page-tags">Tags</Label>
                <Input
                  id="page-tags"
                  name="tags"
                  defaultValue={page?.tags.join(', ') ?? ''}
                  placeholder="pratique, vacances"
                />
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <Label>Contenu</Label>
              <RichEditor
                content={page?.content ?? emptyPageContent}
                pages={pages.filter((item) => item.id !== page?.id)}
                onChange={(nextContent, nextLinks) => {
                  setContent(nextContent);
                  setLinkedPageIds(nextLinks);
                }}
              />
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="page-visibility">Partager avec</Label>
                <Select
                  value={visibility}
                  onValueChange={(value) =>
                    setVisibility(value as PageVisibility)
                  }
                >
                  <SelectTrigger id="page-visibility" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(visibilityLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {visibility === 'GROUPS' ? (
                <AudienceChoices
                  label="Groupes autorisés"
                  entries={groups.map((group) => ({
                    id: group.id,
                    label: group.name,
                  }))}
                  selected={selectedGroups}
                  onChange={setSelectedGroups}
                />
              ) : visibility === 'SELECTED_USERS' ? (
                <AudienceChoices
                  label="Personnes autorisées"
                  entries={members.map((member) => ({
                    id: member.id,
                    label: member.firstName,
                  }))}
                  selected={selectedMembers}
                  onChange={setSelectedMembers}
                />
              ) : null}
            </div>
          </div>
          <DialogFooter className="border-t px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                (visibility === 'GROUPS' && !selectedGroups.length) ||
                (visibility === 'SELECTED_USERS' && !selectedMembers.length)
              }
              className="bg-[#087f72] hover:bg-[#076d63]"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              {page ? 'Enregistrer' : 'Créer la page'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RichEditor({
  content,
  pages,
  onChange,
}: {
  content: PageDocument;
  pages: FamilyPageSummary[];
  onChange: (content: PageDocument, linkedPageIds: string[]) => void;
}) {
  const [insertOpen, setInsertOpen] = useState<'link' | 'image' | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: editorExtensions,
    content,
    onCreate: ({ editor: current }) =>
      emitEditorChange(current.getJSON() as PageDocument, onChange),
    onUpdate: ({ editor: current }) =>
      emitEditorChange(current.getJSON() as PageDocument, onChange),
  });

  if (!editor)
    return (
      <div className="min-h-72 animate-pulse rounded-xl border bg-muted/30" />
    );

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div
        className="flex flex-wrap items-center gap-1 border-b bg-muted/25 p-2"
        role="toolbar"
        aria-label="Mise en forme"
      >
        <ToolButton
          label="Annuler"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
        >
          <Undo2 />
        </ToolButton>
        <ToolButton
          label="Rétablir"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
        >
          <Redo2 />
        </ToolButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolButton
          label="Titre"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 />
        </ToolButton>
        <ToolButton
          label="Gras"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolButton>
        <ToolButton
          label="Italique"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolButton>
        <ToolButton
          label="Liste"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolButton>
        <ToolButton
          label="Liste numérotée"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolButton>
        <ToolButton
          label="Cases à cocher"
          active={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecks />
        </ToolButton>
        <ToolButton
          label="Citation"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </ToolButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolButton
          label="Ajouter un lien"
          active={editor.isActive('link')}
          onClick={() => setInsertOpen('link')}
        >
          <Link2 />
        </ToolButton>
        <ToolButton
          label="Ajouter une image"
          onClick={() => setInsertOpen('image')}
        >
          <ImagePlus />
        </ToolButton>
        <ToolButton
          label="Ajouter un tableau"
          active={editor.isActive('table')}
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <Table2 />
        </ToolButton>
        {editor.isActive('table') ? (
          <>
            <ToolButton
              label="Ajouter une ligne"
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              <Rows3 />
            </ToolButton>
            <ToolButton
              label="Ajouter une colonne"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              <Columns3 />
            </ToolButton>
            <ToolButton
              label="Supprimer le tableau"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              <Trash2 />
            </ToolButton>
          </>
        ) : null}
      </div>
      <EditorContent
        editor={editor}
        className="family-page-editor family-page-content"
      />
      <InsertDialog
        mode={insertOpen}
        pages={pages}
        onClose={() => setInsertOpen(null)}
        onExternalLink={(url) =>
          editor
            .chain()
            .focus()
            .extendMarkRange('link')
            .setLink({ href: url })
            .run()
        }
        onInternalLink={(id) =>
          editor
            .chain()
            .focus()
            .extendMarkRange('link')
            .setLink({ href: `familyhub://page/${id}` })
            .run()
        }
        onRemoveLink={() => editor.chain().focus().unsetLink().run()}
        onImage={(url, alt) =>
          editor.chain().focus().setImage({ src: url, alt }).run()
        }
      />
    </div>
  );
}

function RichContent({
  content,
  onInternalLink,
}: {
  content: PageDocument;
  onInternalLink: (id: string) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: editorExtensions,
    content,
    editorProps: {
      handleClick: (_view, _position, event) => {
        const anchor = (event.target as Element).closest('a');
        const href = anchor?.getAttribute('href');
        const match = href?.match(/^familyhub:\/\/page\/([0-9a-f-]{36})$/i);
        if (!match?.[1]) return false;
        event.preventDefault();
        onInternalLink(match[1]);
        return true;
      },
    },
  });
  useEffect(() => {
    editor?.commands.setContent(content);
  }, [content, editor]);
  return <EditorContent editor={editor} className="family-page-content" />;
}

const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, protocols: ['familyhub'] },
    code: false,
    codeBlock: false,
    strike: false,
    underline: false,
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ allowBase64: false, HTMLAttributes: { loading: 'lazy' } }),
  TableKit.configure({ table: { resizable: false } }),
];

function emitEditorChange(
  content: PageDocument,
  onChange: (content: PageDocument, linkedPageIds: string[]) => void,
) {
  const linked = new Set<string>();
  function visit(node: PageContentNode) {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') {
        const href = mark.attrs?.href;
        const match = (typeof href === 'string' ? href : '').match(
          /^familyhub:\/\/page\/([0-9a-f-]{36})$/i,
        );
        if (match?.[1]) linked.add(match[1]);
      }
    }
    for (const child of node.content ?? []) visit(child);
  }
  visit(content);
  onChange(content, [...linked]);
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={active ? 'secondary' : 'ghost'}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="size-8 [&_svg]:size-4"
    >
      {children}
    </Button>
  );
}

function InsertDialog({
  mode,
  pages,
  onClose,
  onExternalLink,
  onInternalLink,
  onRemoveLink,
  onImage,
}: {
  mode: 'link' | 'image' | null;
  pages: FamilyPageSummary[];
  onClose: () => void;
  onExternalLink: (url: string) => void;
  onInternalLink: (id: string) => void;
  onRemoveLink: () => void;
  onImage: (url: string, alt: string) => void;
}) {
  const [internalId, setInternalId] = useState('');
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (mode === 'image') onImage(formText(data, 'url'), formText(data, 'alt'));
    else if (internalId) onInternalLink(internalId);
    else onExternalLink(formText(data, 'url'));
    onClose();
  }
  return (
    <Dialog open={Boolean(mode)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'image' ? 'Ajouter une image' : 'Ajouter un lien'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'image'
              ? 'Utilisez l’adresse HTTPS d’une image.'
              : 'Liez un site ou une autre page du foyer.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'link' && pages.length ? (
            <div className="space-y-2">
              <Label htmlFor="internal-page">Page du foyer</Label>
              <Select
                value={internalId}
                onValueChange={(value) => setInternalId(value ?? '')}
              >
                <SelectTrigger id="internal-page" className="w-full">
                  <SelectValue placeholder="Choisir une page (facultatif)" />
                </SelectTrigger>
                <SelectContent>
                  {pages.map((page) => (
                    <SelectItem key={page.id} value={page.id}>
                      {page.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {!internalId ? (
            <div className="space-y-2">
              <Label htmlFor="insert-url">Adresse</Label>
              <Input
                id="insert-url"
                name="url"
                type="url"
                required
                placeholder="https://…"
              />
            </div>
          ) : null}
          {mode === 'image' ? (
            <div className="space-y-2">
              <Label htmlFor="image-alt">Description de l’image</Label>
              <Input
                id="image-alt"
                name="alt"
                required
                maxLength={500}
                placeholder="Ce que montre l’image"
              />
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            {mode === 'link' ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onRemoveLink();
                  onClose();
                }}
              >
                Retirer le lien
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">Ajouter</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AudienceChoices({
  label,
  entries,
  selected,
  onChange,
}: {
  label: string;
  entries: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded-xl border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      {entries.length ? (
        entries.map((entry) => (
          <label
            key={entry.id}
            className="flex items-center gap-3 py-1 text-sm"
          >
            <Checkbox
              checked={selected.includes(entry.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...selected, entry.id]
                    : selected.filter((id) => id !== entry.id),
                )
              }
            />
            {entry.label}
          </label>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">Aucun choix disponible.</p>
      )}
    </fieldset>
  );
}

function HistoryDialog({
  open,
  revisions,
  editable,
  restoring,
  onOpenChange,
  onRestore,
}: {
  open: boolean;
  revisions: PageRevision[];
  editable: boolean;
  restoring: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (revision: PageRevision) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Historique de la page</DialogTitle>
          <DialogDescription>
            Chaque enregistrement crée une version que vous pouvez restaurer.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] divide-y overflow-y-auto rounded-xl border">
          {revisions.length ? (
            revisions.map((revision) => (
              <div
                key={revision.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="grid size-9 place-items-center rounded-xl bg-muted text-sm font-semibold">
                  v{revision.revisionNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{revision.editedByName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(revision.createdAt)}
                  </p>
                </div>
                {revision.current ? (
                  <Badge>Actuelle</Badge>
                ) : editable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoring}
                    onClick={() => onRestore(revision)}
                  >
                    Restaurer
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />{' '}
              Chargement…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(localeTag(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formText(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}
