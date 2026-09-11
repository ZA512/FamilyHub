import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  Bookmark,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Lock,
  Pencil,
  Plus,
  Search,
  Star,
  ThumbsUp,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import type {
  BookmarkVisibility,
  FamilyBookmark,
  FamilyGroup,
  FamilyMember,
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
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from '@/components/ui/textarea';

type BookmarkScope = 'mine' | 'recommended' | 'favorites' | 'all';

type BookmarksViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

const visibilityLabels: Record<BookmarkVisibility, string> = {
  PRIVATE: 'Privé',
  ALL_MEMBERS: 'Tout le foyer',
  GROUPS: 'Certains groupes',
  SELECTED_USERS: 'Certaines personnes',
};

export function BookmarksView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: BookmarksViewProps) {
  const [bookmarks, setBookmarks] = useState<FamilyBookmark[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [scope, setScope] = useState<BookmarkScope>('all');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [edited, setEdited] = useState<FamilyBookmark | null>(null);
  const [toDelete, setToDelete] = useState<FamilyBookmark | null>(null);
  const [visibility, setVisibility] = useState<BookmarkVisibility>('PRIVATE');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

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
      const params = new URLSearchParams({ scope, limit: '24' });
      if (query.trim()) params.set('q', query.trim());
      if (tag) params.set('tag', tag);
      fetch(`/api/v1/bookmarks?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok)
            throw new Error('Impossible de charger les bookmarks.');
          return (await response.json()) as {
            bookmarks: FamilyBookmark[];
            hasMore: boolean;
          };
        })
        .then((payload) => {
          setBookmarks(payload.bookmarks);
          setHasMore(payload.hasMore);
          setError('');
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              reason instanceof Error
                ? reason.message
                : 'Bookmarks indisponibles.',
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
  }, [query, reloadToken, scope, tag]);

  const availableTags = useMemo(
    () =>
      [...new Set(bookmarks.flatMap((bookmark) => bookmark.tags))].sort(
        (left, right) => left.localeCompare(right, 'fr'),
      ),
    [bookmarks],
  );

  function openNew() {
    setEdited(null);
    setVisibility('PRIVATE');
    setSelectedMembers([]);
    setSelectedGroups([]);
    setError('');
    onComposerOpenChange(true);
  }

  function openEdit(bookmark: FamilyBookmark) {
    setEdited(bookmark);
    setVisibility(bookmark.visibility);
    setSelectedMembers(bookmark.memberIds);
    setSelectedGroups(bookmark.groupIds);
    setError('');
    onComposerOpenChange(true);
  }

  function closeComposer() {
    setEdited(null);
    setVisibility('PRIVATE');
    setSelectedMembers([]);
    setSelectedGroups([]);
    onComposerOpenChange(false);
  }

  async function saveBookmark(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const tagEntry = data.get('tags');
    try {
      const response = await fetch(
        edited ? `/api/v1/bookmarks/${edited.id}` : '/api/v1/bookmarks',
        {
          method: edited ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            url: data.get('url'),
            title: data.get('title'),
            description: data.get('description'),
            personalComment: data.get('personalComment'),
            tags: (typeof tagEntry === 'string' ? tagEntry : '')
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
            visibility,
            groupIds: visibility === 'GROUPS' ? selectedGroups : [],
            memberIds: visibility === 'SELECTED_USERS' ? selectedMembers : [],
            ...(edited
              ? { version: edited.version }
              : { clientMutationId: crypto.randomUUID() }),
          }),
        },
      );
      if (response.status === 409) {
        throw new Error(
          'Ce bookmark a été modifié ailleurs. Rechargez avant de réessayer.',
        );
      }
      if (!response.ok) {
        throw new Error('Le bookmark n’a pas pu être enregistré.');
      }
      closeComposer();
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMore() {
    const oldest = bookmarks.at(-1);
    if (!oldest || !hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        scope,
        limit: '24',
        before: oldest.updatedAt,
        beforeId: oldest.id,
      });
      if (query.trim()) params.set('q', query.trim());
      if (tag) params.set('tag', tag);
      const response = await fetch(`/api/v1/bookmarks?${params}`);
      if (!response.ok)
        throw new Error('Impossible de charger la suite des bookmarks.');
      const payload = (await response.json()) as {
        bookmarks: FamilyBookmark[];
        hasMore: boolean;
      };
      setBookmarks((current) => [
        ...current,
        ...payload.bookmarks.filter(
          (bookmark) => !current.some((item) => item.id === bookmark.id),
        ),
      ]);
      setHasMore(payload.hasMore);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleFavorite(bookmark: FamilyBookmark) {
    setBusyId(bookmark.id);
    try {
      const response = await fetch(
        `/api/v1/bookmarks/${bookmark.id}/favorite`,
        {
          method: bookmark.favorite ? 'DELETE' : 'PUT',
          headers: { 'x-csrf-token': csrfToken },
        },
      );
      if (!response.ok) throw new Error('Favori impossible à modifier.');
      const payload = (await response.json()) as {
        bookmark: FamilyBookmark;
      };
      replaceBookmark(payload.bookmark);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleUseful(bookmark: FamilyBookmark) {
    setBusyId(bookmark.id);
    try {
      const response = await fetch(`/api/v1/bookmarks/${bookmark.id}/useful`, {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('Réaction impossible à modifier.');
      const payload = (await response.json()) as {
        bookmark: FamilyBookmark;
      };
      replaceBookmark(payload.bookmark);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteBookmark() {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    try {
      const response = await fetch(`/api/v1/bookmarks/${toDelete.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('Suppression impossible.');
      setBookmarks((current) =>
        current.filter((bookmark) => bookmark.id !== toDelete.id),
      );
      setToDelete(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action impossible.');
    } finally {
      setBusyId(null);
    }
  }

  function replaceBookmark(bookmark: FamilyBookmark) {
    setBookmarks((current) =>
      current.map((item) => (item.id === bookmark.id ? bookmark : item)),
    );
  }

  return (
    <>
      <Dialog
        open={composerOpen}
        onOpenChange={(open) => {
          if (!open && !submitting) closeComposer();
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {edited ? 'Modifier le bookmark' : 'Nouveau bookmark'}
            </DialogTitle>
            <DialogDescription>
              Gardez-le pour vous ou recommandez-le aux bonnes personnes.
            </DialogDescription>
          </DialogHeader>
          <form
            key={edited?.id ?? 'new'}
            onSubmit={saveBookmark}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="bookmark-url">Adresse du lien</Label>
              <Input
                id="bookmark-url"
                name="url"
                type="url"
                required
                maxLength={2048}
                defaultValue={edited?.url ?? ''}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bookmark-title">Titre</Label>
              <Input
                id="bookmark-title"
                name="title"
                maxLength={200}
                defaultValue={edited?.title ?? ''}
                placeholder="Facultatif — le domaine sera utilisé"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bookmark-description">Description</Label>
              <Textarea
                id="bookmark-description"
                name="description"
                maxLength={1000}
                defaultValue={edited?.description ?? ''}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bookmark-comment">Note personnelle</Label>
              <Textarea
                id="bookmark-comment"
                name="personalComment"
                maxLength={1000}
                defaultValue={edited?.personalComment ?? ''}
                rows={2}
                placeholder="Visible uniquement par vous"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bookmark-tags">Tags</Label>
              <Input
                id="bookmark-tags"
                name="tags"
                defaultValue={edited?.tags.join(', ') ?? ''}
                placeholder="recette, vacances, école"
              />
              <p className="text-xs text-muted-foreground">
                Séparez les tags par des virgules.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bookmark-visibility">Partager avec</Label>
              <Select
                value={visibility}
                onValueChange={(value) =>
                  setVisibility(value as BookmarkVisibility)
                }
              >
                <SelectTrigger id="bookmark-visibility" className="w-full">
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
            ) : null}
            {visibility === 'SELECTED_USERS' ? (
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
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeComposer}>
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
                {edited ? 'Enregistrer' : 'Ajouter'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => {
          if (!open && !busyId) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce bookmark ?</AlertDialogTitle>
            <AlertDialogDescription>
              Il disparaîtra aussi des recommandations et des favoris du foyer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyId)}
              onClick={() => void deleteBookmark()}
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
              Liens utiles
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Bookmarks
            </h1>
          </div>
          <Button
            onClick={openNew}
            className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
          >
            <Plus aria-hidden="true" /> Ajouter
          </Button>
        </div>

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            value={scope}
            onValueChange={(value) => setScope(value as BookmarkScope)}
          >
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="all">Tous</TabsTrigger>
              <TabsTrigger value="mine">Mes bookmarks</TabsTrigger>
              <TabsTrigger value="recommended">Recommandés</TabsTrigger>
              <TabsTrigger value="favorites">Favoris</TabsTrigger>
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
              placeholder="Rechercher un lien…"
              aria-label="Rechercher dans les bookmarks"
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

        {availableTags.length || tag ? (
          <div
            className="mb-5 flex flex-wrap gap-2"
            aria-label="Filtrer par tag"
          >
            {tag ? (
              <Button size="sm" variant="outline" onClick={() => setTag('')}>
                <X aria-hidden="true" /> Tous les tags
              </Button>
            ) : null}
            {availableTags.map((item) => (
              <Button
                key={item}
                size="sm"
                variant={tag === item ? 'default' : 'outline'}
                onClick={() => setTag(tag === item ? '' : item)}
                className={tag === item ? 'bg-[#087f72]' : ''}
              >
                #{item}
              </Button>
            ))}
          </div>
        ) : null}

        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-3 py-14 text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Chargement des bookmarks…
            </CardContent>
          </Card>
        ) : bookmarks.length ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {bookmarks.map((bookmark) => (
                <BookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  busy={busyId === bookmark.id}
                  onFavorite={() => void toggleFavorite(bookmark)}
                  onUseful={() => void toggleUseful(bookmark)}
                  onEdit={() => openEdit(bookmark)}
                  onDelete={() => setToDelete(bookmark)}
                  onTag={setTag}
                />
              ))}
            </div>
            {hasMore ? (
              <div className="mt-6 text-center">
                <Button
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : null}
                  Charger la suite
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="flex flex-col items-center py-14 text-center">
              <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
                <Bookmark aria-hidden="true" />
              </span>
              <h2 className="font-semibold">
                {scope === 'recommended'
                  ? 'Aucune recommandation'
                  : 'Aucun bookmark'}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {query || tag
                  ? 'Essayez une autre recherche ou retirez le filtre.'
                  : 'Ajoutez un lien utile et choisissez avec qui le partager.'}
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </>
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

function BookmarkCard({
  bookmark,
  busy,
  onFavorite,
  onUseful,
  onEdit,
  onDelete,
  onTag,
}: {
  bookmark: FamilyBookmark;
  busy: boolean;
  onFavorite: () => void;
  onUseful: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTag: (tag: string) => void;
}) {
  return (
    <Card className="h-full gap-4 overflow-hidden py-5">
      <CardContent className="flex h-full flex-col px-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#e7f5f2] font-semibold text-[#087f72]">
            {bookmark.hostname.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <a
              href={bookmark.url}
              target="_blank"
              rel="noreferrer"
              className="group/link flex items-start gap-2 font-semibold leading-snug hover:text-[#087f72]"
            >
              <span className="line-clamp-2">{bookmark.title}</span>
              <ExternalLink
                className="mt-0.5 size-3.5 shrink-0 opacity-50 group-hover/link:opacity-100"
                aria-hidden="true"
              />
            </a>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {bookmark.hostname}
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy}
            onClick={onFavorite}
            aria-label={
              bookmark.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'
            }
            className="-mr-2 -mt-2 shrink-0"
          >
            <Star
              className={
                bookmark.favorite
                  ? 'fill-amber-400 text-amber-500'
                  : 'text-muted-foreground'
              }
            />
          </Button>
        </div>

        {bookmark.description ? (
          <p className="mb-3 line-clamp-3 text-sm text-muted-foreground">
            {bookmark.description}
          </p>
        ) : null}
        {bookmark.personalComment ? (
          <p className="mb-3 rounded-xl border border-dashed bg-muted/30 px-3 py-2 text-sm">
            {bookmark.personalComment}
          </p>
        ) : null}
        {bookmark.tags.length ? (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {bookmark.tags.map((tag) => (
              <button
                type="button"
                key={tag}
                onClick={() => onTag(tag)}
                className="rounded-full bg-muted px-2 py-1 text-xs hover:bg-[#e7f5f2] hover:text-[#087f72]"
              >
                #{tag}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {bookmark.visibility === 'PRIVATE' ? (
              <Lock className="size-3.5 shrink-0" aria-hidden="true" />
            ) : bookmark.visibility === 'ALL_MEMBERS' ? (
              <Globe2 className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Users className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">
              {bookmark.editable
                ? visibilityLabels[bookmark.visibility]
                : `Par ${bookmark.createdByName}`}
            </span>
          </div>
          <div className="flex shrink-0 items-center">
            {!bookmark.editable ? (
              <Button
                type="button"
                size="sm"
                variant={bookmark.usefulByMe ? 'secondary' : 'ghost'}
                disabled={busy}
                onClick={onUseful}
                aria-label="Marquer comme utile"
              >
                <ThumbsUp aria-hidden="true" /> {bookmark.usefulCount || ''}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  onClick={onEdit}
                  aria-label={`Modifier ${bookmark.title}`}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={busy}
                  onClick={onDelete}
                  aria-label={`Supprimer ${bookmark.title}`}
                  className="hover:text-red-600"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
