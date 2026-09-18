import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { localeTag } from '@/lib/i18n';
import {
  ArrowLeft,
  BookOpen,
  ExternalLink,
  Film,
  Gamepad2,
  Gift,
  Globe2,
  LibraryBig,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Minus,
  Music,
  Pencil,
  Plus,
  Search,
  Shapes,
  Tags,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Tv,
  Users,
  Utensils,
  X,
  Video,
  Lock,
} from 'lucide-react';

import type {
  CollectionType,
  CollectionVisibility,
  FamilyCollection,
  FamilyCollectionItem,
  FamilyCollectionSummary,
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';

type CollectionScope = 'all' | 'mine' | 'shared';

type CollectionsViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

type DeleteTarget =
  | { kind: 'collection'; collection: FamilyCollection }
  | { kind: 'item'; item: FamilyCollectionItem }
  | null;

const collectionTypes: Array<{
  value: CollectionType;
  label: string;
  itemLabel: string;
  icon: typeof Shapes;
  metadataHint: string;
}> = [
  {
    value: 'BOOKS',
    label: 'Livres',
    itemLabel: 'livre',
    icon: BookOpen,
    metadataHint: 'Auteur: …\nISBN: …',
  },
  {
    value: 'MOVIES',
    label: 'Films',
    itemLabel: 'film',
    icon: Film,
    metadataHint: 'Année: …\nRéalisateur: …',
  },
  {
    value: 'SERIES',
    label: 'Séries',
    itemLabel: 'série',
    icon: Tv,
    metadataHint: 'Année: …\nPlateforme: …',
  },
  {
    value: 'CREATORS',
    label: 'Créateurs',
    itemLabel: 'créateur',
    icon: Video,
    metadataHint: 'Chaîne: …\nThème: …',
  },
  {
    value: 'MUSIC',
    label: 'Musiques',
    itemLabel: 'musique',
    icon: Music,
    metadataHint: 'Artiste: …\nAlbum: …',
  },
  {
    value: 'RESTAURANTS',
    label: 'Restaurants',
    itemLabel: 'restaurant',
    icon: Utensils,
    metadataHint: 'Cuisine: …\nAdresse: …',
  },
  {
    value: 'GAMES',
    label: 'Jeux',
    itemLabel: 'jeu',
    icon: Gamepad2,
    metadataHint: 'Plateforme: …\nJoueurs: …',
  },
  {
    value: 'PLACES',
    label: 'Lieux',
    itemLabel: 'lieu',
    icon: MapPin,
    metadataHint: 'Adresse: …\nSaison: …',
  },
  {
    value: 'GIFTS',
    label: 'Idées cadeaux',
    itemLabel: 'idée',
    icon: Gift,
    metadataHint: 'Pour: …\nBudget: …',
  },
  {
    value: 'OTHER',
    label: 'Autres',
    itemLabel: 'élément',
    icon: Shapes,
    metadataHint: 'Détail: …',
  },
];

const visibilityLabels: Record<CollectionVisibility, string> = {
  PRIVATE: 'Privée',
  ALL_MEMBERS: 'Tout le foyer',
  GROUPS: 'Certains groupes',
  SELECTED_USERS: 'Certaines personnes',
};

function typeConfig(type: CollectionType) {
  return (
    collectionTypes.find((candidate) => candidate.value === type) ??
    collectionTypes[9]!
  );
}

function tagsFrom(value: FormDataEntryValue | null): string[] {
  return (typeof value === 'string' ? value : '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function metadataFrom(
  value: FormDataEntryValue | null,
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of (typeof value === 'string' ? value : '').split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const entry = line.slice(separator + 1).trim();
    if (key && entry) metadata[key] = entry;
  }
  return metadata;
}

function metadataText(metadata: Record<string, string>) {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function toggleValue(current: string[], id: string) {
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
}

export function CollectionsView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: CollectionsViewProps) {
  const [collections, setCollections] = useState<FamilyCollectionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<FamilyCollection | null>(null);
  const [items, setItems] = useState<FamilyCollectionItem[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [scope, setScope] = useState<CollectionScope>('all');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<CollectionType | 'all'>('all');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editedCollection, setEditedCollection] =
    useState<FamilyCollection | null>(null);
  const [collectionVisibility, setCollectionVisibility] =
    useState<CollectionVisibility>('PRIVATE');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [itemComposerOpen, setItemComposerOpen] = useState(false);
  const [editedItem, setEditedItem] = useState<FamilyCollectionItem | null>(
    null,
  );
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const focusedItem = items.find((item) => item.id === focusedItemId) ?? null;
  const loadingCollection = Boolean(selectedId && selected?.id !== selectedId);
  const availableTags = useMemo(
    () =>
      [...new Set(collections.flatMap((collection) => collection.tags))].sort(
        (a, b) => a.localeCompare(b, localeTag()),
      ),
    [collections],
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/members', { signal: controller.signal }),
      fetch('/api/v1/groups', { signal: controller.signal }),
    ])
      .then(async ([membersResponse, groupsResponse]) => {
        if (!membersResponse.ok || !groupsResponse.ok)
          throw new Error('Partage indisponible.');
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
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Partage indisponible.',
          );
      });
    return () => controller.abort();
  }, [currentMemberId]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ scope, limit: '30' });
      if (query.trim()) params.set('q', query.trim());
      if (type !== 'all') params.set('type', type);
      if (tag) params.set('tag', tag);
      fetch(`/api/v1/collections?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok)
            throw new Error('Impossible de charger les collections.');
          return (await response.json()) as {
            collections: FamilyCollectionSummary[];
            hasMore: boolean;
          };
        })
        .then((payload) => {
          setCollections(payload.collections);
          setHasMore(payload.hasMore);
          setSelectedId((current) =>
            current &&
            payload.collections.some((collection) => collection.id === current)
              ? current
              : (payload.collections[0]?.id ?? null),
          );
          setError('');
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message
                : 'Collections indisponibles.',
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, reloadToken, scope, tag, type]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/v1/collections/${selectedId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Impossible d’ouvrir cette collection.');
        return (await response.json()) as {
          collection: FamilyCollection;
          items: FamilyCollectionItem[];
        };
      })
      .then((payload) => {
        setSelected(payload.collection);
        setItems(payload.items);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Collection indisponible.',
          );
          setSelectedId(null);
        }
      });
    return () => controller.abort();
  }, [reloadToken, selectedId]);

  function openNewCollection() {
    setEditedCollection(null);
    setCollectionVisibility('PRIVATE');
    setSelectedGroups([]);
    setSelectedMembers([]);
    setError('');
    onComposerOpenChange(true);
  }

  function openEditCollection() {
    if (!selected?.editable) return;
    setEditedCollection(selected);
    setCollectionVisibility(selected.visibility);
    setSelectedGroups(selected.groupIds);
    setSelectedMembers(selected.memberIds);
    setError('');
    onComposerOpenChange(true);
  }

  function closeCollectionComposer() {
    if (submitting) return;
    setEditedCollection(null);
    onComposerOpenChange(false);
  }

  function openItemComposer(item: FamilyCollectionItem | null = null) {
    setEditedItem(item);
    setFocusedItemId(null);
    setError('');
    setItemComposerOpen(true);
  }

  async function saveCollection(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        editedCollection
          ? `/api/v1/collections/${editedCollection.id}`
          : '/api/v1/collections',
        {
          method: editedCollection ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            name: data.get('name'),
            description: data.get('description'),
            type: data.get('type'),
            imageUrl: data.get('imageUrl'),
            tags: tagsFrom(data.get('tags')),
            visibility: collectionVisibility,
            groupIds: collectionVisibility === 'GROUPS' ? selectedGroups : [],
            memberIds:
              collectionVisibility === 'SELECTED_USERS' ? selectedMembers : [],
            ...(editedCollection
              ? { version: editedCollection.version }
              : { clientMutationId: crypto.randomUUID() }),
          }),
        },
      );
      if (response.status === 409)
        throw new Error(
          'Cette collection a été modifiée ailleurs. Rechargez-la.',
        );
      if (!response.ok)
        throw new Error('La collection n’a pas pu être enregistrée.');
      const payload = (await response.json()) as {
        collection: FamilyCollection;
      };
      setSelectedId(payload.collection.id);
      setSelected(payload.collection);
      closeCollectionComposer();
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function saveItem(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        editedItem
          ? `/api/v1/collections/${selected.id}/items/${editedItem.id}`
          : `/api/v1/collections/${selected.id}/items`,
        {
          method: editedItem ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            title: data.get('title'),
            subtitle: data.get('subtitle'),
            description: data.get('description'),
            url: data.get('url'),
            imageUrl: data.get('imageUrl'),
            tags: tagsFrom(data.get('tags')),
            metadata: metadataFrom(data.get('metadata')),
            ...(editedItem
              ? { version: editedItem.version }
              : { clientMutationId: crypto.randomUUID() }),
          }),
        },
      );
      if (response.status === 409)
        throw new Error(
          'Cet élément a été modifié ailleurs. Rechargez la collection.',
        );
      if (!response.ok)
        throw new Error('L’élément n’a pas pu être enregistré.');
      const payload = (await response.json()) as { item: FamilyCollectionItem };
      setItems((current) => [
        payload.item,
        ...current.filter((item) => item.id !== payload.item.id),
      ]);
      setItemComposerOpen(false);
      setEditedItem(null);
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function updatePreference(
    item: FamilyCollectionItem,
    value: -1 | 0 | 1,
  ) {
    setBusyId(item.id);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/collections/${item.collectionId}/items/${item.id}/preference`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ value }),
        },
      );
      if (!response.ok)
        throw new Error('Votre avis n’a pas pu être enregistré.');
      const payload = (await response.json()) as { item: FamilyCollectionItem };
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? payload.item : candidate,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Avis indisponible.');
    } finally {
      setBusyId(null);
    }
  }

  async function addComment(
    event: SyntheticEvent<HTMLFormElement>,
    item: FamilyCollectionItem,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get('comment');
    setBusyId(item.id);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/collections/${item.collectionId}/items/${item.id}/comments`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ body, clientMutationId: crypto.randomUUID() }),
        },
      );
      if (!response.ok)
        throw new Error('Le commentaire n’a pas pu être ajouté.');
      const payload = (await response.json()) as { item: FamilyCollectionItem };
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? payload.item : candidate,
        ),
      );
      form.reset();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Commentaire indisponible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function deleteComment(item: FamilyCollectionItem, commentId: string) {
    setBusyId(commentId);
    try {
      const response = await fetch(
        `/api/v1/collections/${item.collectionId}/items/${item.id}/comments/${commentId}`,
        { method: 'DELETE', headers: { 'x-csrf-token': csrfToken } },
      );
      if (!response.ok) throw new Error('Suppression impossible.');
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                comments: candidate.comments.filter(
                  (comment) => comment.id !== commentId,
                ),
              }
            : candidate,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !selected) return;
    setSubmitting(true);
    try {
      const response = await fetch(
        deleteTarget.kind === 'collection'
          ? `/api/v1/collections/${deleteTarget.collection.id}`
          : `/api/v1/collections/${selected.id}/items/${deleteTarget.item.id}`,
        { method: 'DELETE', headers: { 'x-csrf-token': csrfToken } },
      );
      if (!response.ok) throw new Error('Suppression impossible.');
      if (deleteTarget.kind === 'collection') {
        setSelectedId(null);
        setSelected(null);
        setItems([]);
        setReloadToken((value) => value + 1);
      } else {
        setItems((current) =>
          current.filter((item) => item.id !== deleteTarget.item.id),
        );
        setFocusedItemId(null);
        setReloadToken((value) => value + 1);
      }
      setDeleteTarget(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function loadMore() {
    const oldest = collections.at(-1);
    if (!oldest || !hasMore) return;
    const params = new URLSearchParams({
      scope,
      limit: '30',
      before: oldest.updatedAt,
      beforeId: oldest.id,
    });
    if (query.trim()) params.set('q', query.trim());
    if (type !== 'all') params.set('type', type);
    if (tag) params.set('tag', tag);
    try {
      const response = await fetch(`/api/v1/collections?${params}`);
      if (!response.ok) throw new Error('Impossible de charger la suite.');
      const payload = (await response.json()) as {
        collections: FamilyCollectionSummary[];
        hasMore: boolean;
      };
      setCollections((current) => [
        ...current,
        ...payload.collections.filter(
          (collection) =>
            !current.some((candidate) => candidate.id === collection.id),
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
        <CollectionEditorDialog
          collection={editedCollection}
          visibility={collectionVisibility}
          groups={groups}
          members={members}
          selectedGroups={selectedGroups}
          selectedMembers={selectedMembers}
          submitting={submitting}
          error={error}
          onVisibilityChange={setCollectionVisibility}
          onGroupsChange={setSelectedGroups}
          onMembersChange={setSelectedMembers}
          onClose={closeCollectionComposer}
          onSave={(event) => void saveCollection(event)}
        />
      ) : null}

      {itemComposerOpen && selected ? (
        <ItemEditorDialog
          collection={selected}
          item={editedItem}
          submitting={submitting}
          error={error}
          onClose={() => {
            if (!submitting) {
              setItemComposerOpen(false);
              setEditedItem(null);
            }
          }}
          onSave={(event) => void saveItem(event)}
        />
      ) : null}

      {focusedItem && selected ? (
        <ItemDetailDialog
          item={focusedItem}
          collection={selected}
          busy={busyId === focusedItem.id}
          onClose={() => setFocusedItemId(null)}
          onEdit={() => openItemComposer(focusedItem)}
          onDelete={() => setDeleteTarget({ kind: 'item', item: focusedItem })}
          onPreference={(value) => void updatePreference(focusedItem, value)}
          onComment={(event) => void addComment(event, focusedItem)}
          onDeleteComment={(commentId) =>
            void deleteComment(focusedItem, commentId)
          }
          busyId={busyId}
        />
      ) : null}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer{' '}
              {deleteTarget?.kind === 'collection'
                ? 'cette collection'
                : 'cet élément'}{' '}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === 'collection'
                ? 'Ses éléments, avis et commentaires ne seront plus accessibles.'
                : 'Ses avis et commentaires disparaîtront également.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => void confirmDelete()}
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
            <p className="mb-1 text-sm font-medium text-primary">
              Nos recommandations
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Collections
            </h1>
          </div>
          <Button
            onClick={openNewCollection}
            className="rounded-xl bg-primary hover:bg-primary/80"
          >
            <Plus aria-hidden="true" /> Nouvelle collection
          </Button>
        </div>

        {error && !composerOpen && !itemComposerOpen ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="mb-4 grid gap-3 lg:grid-cols-[auto_minmax(15rem,1fr)_13rem] lg:items-center">
          <Tabs
            value={scope}
            onValueChange={(value) => setScope(value as CollectionScope)}
          >
            <TabsList>
              <TabsTrigger value="all">Toutes</TabsTrigger>
              <TabsTrigger value="mine">Les miennes</TabsTrigger>
              <TabsTrigger value="shared">Partagées</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher une collection…"
              aria-label="Rechercher une collection"
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
          <Select
            value={type}
            onValueChange={(value) => setType(value as CollectionType | 'all')}
          >
            <SelectTrigger aria-label="Filtrer par type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {collectionTypes.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {availableTags.length ? (
          <div
            className="mb-4 flex flex-wrap gap-2"
            aria-label="Filtrer par étiquette"
          >
            {tag ? (
              <Button size="sm" variant="outline" onClick={() => setTag('')}>
                <X aria-hidden="true" /> Effacer
              </Button>
            ) : null}
            {availableTags.map((entry) => (
              <Button
                key={entry}
                size="sm"
                variant={tag === entry ? 'default' : 'outline'}
                className={tag === entry ? 'bg-primary' : ''}
                onClick={() => setTag(tag === entry ? '' : entry)}
              >
                #{entry}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="grid min-h-[58vh] overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid-cols-[19rem_minmax(0,1fr)]">
          <aside
            className={`${selectedId ? 'hidden lg:block' : 'block'} border-r bg-muted/20`}
            aria-label="Liste des collections"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <LoaderCircle className="animate-spin" aria-hidden="true" />{' '}
                Chargement…
              </div>
            ) : collections.length ? (
              <div className="divide-y">
                {collections.map((collection) => {
                  const config = typeConfig(collection.type);
                  const Icon = config.icon;
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => setSelectedId(collection.id)}
                      className={`flex w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/55 ${selectedId === collection.id ? 'bg-secondary' : ''}`}
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-background text-primary shadow-sm">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {collection.name}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {collection.itemCount} élément
                          {collection.itemCount > 1 ? 's' : ''} · {config.label}
                        </span>
                      </span>
                    </button>
                  );
                })}
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
                <LibraryBig className="mb-3 text-primary" aria-hidden="true" />
                <p className="font-medium">Aucune collection</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Rassemblez ici les idées que le foyer veut garder.
                </p>
              </div>
            )}
          </aside>

          <main
            className={`${selectedId ? 'block' : 'hidden lg:block'} min-w-0`}
          >
            {loadingCollection ? (
              <div className="flex min-h-[58vh] items-center justify-center gap-3 text-muted-foreground">
                <LoaderCircle className="animate-spin" aria-hidden="true" />{' '}
                Ouverture…
              </div>
            ) : selectedId && selected?.id === selectedId ? (
              <CollectionReader
                collection={selected}
                items={items}
                busyId={busyId}
                onBack={() => setSelectedId(null)}
                onEdit={openEditCollection}
                onDelete={() =>
                  setDeleteTarget({ kind: 'collection', collection: selected })
                }
                onAddItem={() => openItemComposer()}
                onOpenItem={setFocusedItemId}
                onPreference={(item, value) =>
                  void updatePreference(item, value)
                }
              />
            ) : (
              <div className="hidden min-h-[58vh] place-items-center text-center text-muted-foreground lg:grid">
                <div>
                  <LibraryBig className="mx-auto mb-3" aria-hidden="true" />
                  <p>Choisissez une collection.</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </section>
    </>
  );
}

function CollectionReader({
  collection,
  items,
  busyId,
  onBack,
  onEdit,
  onDelete,
  onAddItem,
  onOpenItem,
  onPreference,
}: {
  collection: FamilyCollection;
  items: FamilyCollectionItem[];
  busyId: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddItem: () => void;
  onOpenItem: (id: string) => void;
  onPreference: (item: FamilyCollectionItem, value: -1 | 0 | 1) => void;
}) {
  const config = typeConfig(collection.type);
  const Icon = config.icon;
  return (
    <div>
      <div className="border-b p-4 sm:p-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-3 -ml-2 lg:hidden"
        >
          <ArrowLeft aria-hidden="true" /> Collections
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {collection.imageUrl ? (
            // oxlint-disable-next-line next/no-img-element
            <img
              src={collection.imageUrl}
              alt=""
              className="h-28 w-full rounded-2xl object-cover sm:w-40"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <span className="grid size-20 shrink-0 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
              <Icon className="size-8" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-primary">
                  {config.label}
                </p>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {collection.name}
                </h2>
              </div>
              <div className="flex gap-2">
                {collection.editable ? (
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Modifier la collection"
                    onClick={onEdit}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                ) : null}
                {collection.editable ? (
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Supprimer la collection"
                    onClick={onDelete}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </div>
            {collection.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {collection.description}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {collection.visibility === 'PRIVATE' ? (
                  <Lock aria-hidden="true" />
                ) : collection.visibility === 'ALL_MEMBERS' ? (
                  <Globe2 aria-hidden="true" />
                ) : (
                  <Users aria-hidden="true" />
                )}
                {visibilityLabels[collection.visibility]}
              </Badge>
              <span>Par {collection.createdByName}</span>
              {collection.tags.map((entry) => (
                <Badge key={entry} variant="secondary">
                  #{entry}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="font-medium">
            {items.length} élément{items.length > 1 ? 's' : ''}
          </p>
          <Button
            onClick={onAddItem}
            className="rounded-xl bg-primary hover:bg-primary/80"
          >
            <Plus aria-hidden="true" /> Ajouter un {config.itemLabel}
          </Button>
        </div>
      </div>
      <div className="p-4 sm:p-6">
        {items.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <Card
                key={item.id}
                className="group gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md"
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => onOpenItem(item.id)}
                >
                  {item.imageUrl ? (
                    // oxlint-disable-next-line next/no-img-element
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="aspect-[16/9] w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="grid aspect-[16/7] place-items-center bg-gradient-to-br from-secondary to-background text-primary">
                      <Icon className="size-8" aria-hidden="true" />
                    </div>
                  )}
                  <CardContent className="p-4 pb-3">
                    <h3 className="line-clamp-2 font-semibold">{item.title}</h3>
                    {item.subtitle ? (
                      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                        {item.subtitle}
                      </p>
                    ) : null}
                    {Object.keys(item.metadata).length ? (
                      <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                        {Object.entries(item.metadata)
                          .slice(0, 2)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(' · ')}
                      </p>
                    ) : null}
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <MessageCircle className="size-3.5" aria-hidden="true" />{' '}
                      {item.comments.length}{' '}
                      <span className="ml-auto">
                        Ajouté par {item.addedByName}
                      </span>
                    </div>
                  </CardContent>
                </button>
                <div
                  className="flex border-t px-2 py-2"
                  aria-label={`Avis sur ${item.title}`}
                >
                  <PreferenceButton
                    label="Pas pour moi"
                    active={item.preference === -1}
                    count={item.preferences.negative}
                    disabled={busyId === item.id}
                    onClick={() => onPreference(item, -1)}
                  >
                    <ThumbsDown />
                  </PreferenceButton>
                  <PreferenceButton
                    label="Neutre"
                    active={item.preference === 0}
                    count={item.preferences.neutral}
                    disabled={busyId === item.id}
                    onClick={() => onPreference(item, 0)}
                  >
                    <Minus />
                  </PreferenceButton>
                  <PreferenceButton
                    label="Partant"
                    active={item.preference === 1}
                    count={item.preferences.positive}
                    disabled={busyId === item.id}
                    onClick={() => onPreference(item, 1)}
                  >
                    <ThumbsUp />
                  </PreferenceButton>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed bg-muted/15 text-center">
            <div>
              <Icon className="mx-auto mb-3 text-primary" aria-hidden="true" />
              <p className="font-medium">Collection vide</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ajoutez la première recommandation.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PreferenceButton({
  label,
  active,
  count,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  count: number;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactElement;
}) {
  return (
    <button
      type="button"
      aria-label={`${label}, ${count}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${active ? 'bg-secondary font-semibold text-secondary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
    >
      <span className="[&_svg]:size-3.5">{children}</span>
      {count}
    </button>
  );
}

function CollectionEditorDialog({
  collection,
  visibility,
  groups,
  members,
  selectedGroups,
  selectedMembers,
  submitting,
  error,
  onVisibilityChange,
  onGroupsChange,
  onMembersChange,
  onClose,
  onSave,
}: {
  collection: FamilyCollection | null;
  visibility: CollectionVisibility;
  groups: FamilyGroup[];
  members: FamilyMember[];
  selectedGroups: string[];
  selectedMembers: string[];
  submitting: boolean;
  error: string;
  onVisibilityChange: (visibility: CollectionVisibility) => void;
  onGroupsChange: (ids: string[]) => void;
  onMembersChange: (ids: string[]) => void;
  onClose: () => void;
  onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {collection ? 'Modifier la collection' : 'Nouvelle collection'}
          </DialogTitle>
          <DialogDescription>
            Créez une liste structurée à enrichir ensemble.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="collection-name">Nom</Label>
              <Input
                id="collection-name"
                name="name"
                required
                maxLength={120}
                defaultValue={collection?.name ?? ''}
                placeholder="Films à voir en famille"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="collection-type">Type</Label>
              <Select name="type" defaultValue={collection?.type ?? 'MOVIES'}>
                <SelectTrigger id="collection-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {collectionTypes.map((entry) => (
                    <SelectItem key={entry.value} value={entry.value}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="collection-image">Image (URL facultative)</Label>
              <Input
                id="collection-image"
                name="imageUrl"
                type="url"
                maxLength={2048}
                defaultValue={collection?.imageUrl ?? ''}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="collection-description">Description</Label>
              <Textarea
                id="collection-description"
                name="description"
                maxLength={1000}
                defaultValue={collection?.description ?? ''}
                placeholder="Ce que vous souhaitez rassembler ici…"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="collection-tags">Étiquettes</Label>
              <Input
                id="collection-tags"
                name="tags"
                defaultValue={collection?.tags.join(', ') ?? ''}
                placeholder="famille, week-end"
              />
              <p className="text-xs text-muted-foreground">
                Séparez les étiquettes par des virgules.
              </p>
            </div>
          </div>
          <AudienceFields
            visibility={visibility}
            groups={groups}
            members={members}
            selectedGroups={selectedGroups}
            selectedMembers={selectedMembers}
            onVisibilityChange={onVisibilityChange}
            onGroupsChange={onGroupsChange}
            onMembersChange={onMembersChange}
          />
          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-primary hover:bg-primary/80"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              {collection ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AudienceFields({
  visibility,
  groups,
  members,
  selectedGroups,
  selectedMembers,
  onVisibilityChange,
  onGroupsChange,
  onMembersChange,
}: {
  visibility: CollectionVisibility;
  groups: FamilyGroup[];
  members: FamilyMember[];
  selectedGroups: string[];
  selectedMembers: string[];
  onVisibilityChange: (visibility: CollectionVisibility) => void;
  onGroupsChange: (ids: string[]) => void;
  onMembersChange: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
      <div className="space-y-2">
        <Label htmlFor="collection-visibility">
          Qui peut voir cette collection ?
        </Label>
        <Select
          value={visibility}
          onValueChange={(value) =>
            onVisibilityChange(value as CollectionVisibility)
          }
        >
          <SelectTrigger id="collection-visibility">
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
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.map((group) => (
            <label
              key={group.id}
              className="flex items-center gap-3 rounded-xl border bg-background p-3 text-sm"
            >
              <Checkbox
                checked={selectedGroups.includes(group.id)}
                onCheckedChange={() =>
                  onGroupsChange(toggleValue(selectedGroups, group.id))
                }
              />
              <span>{group.name}</span>
            </label>
          ))}
        </div>
      ) : null}
      {visibility === 'SELECTED_USERS' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {members.map((member) => (
            <label
              key={member.id}
              className="flex items-center gap-3 rounded-xl border bg-background p-3 text-sm"
            >
              <Checkbox
                checked={selectedMembers.includes(member.id)}
                onCheckedChange={() =>
                  onMembersChange(toggleValue(selectedMembers, member.id))
                }
              />
              <span>
                {member.firstName}
                {member.lastName ? ` ${member.lastName}` : ''}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ItemEditorDialog({
  collection,
  item,
  submitting,
  error,
  onClose,
  onSave,
}: {
  collection: FamilyCollection;
  item: FamilyCollectionItem | null;
  submitting: boolean;
  error: string;
  onClose: () => void;
  onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const config = typeConfig(collection.type);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {item ? 'Modifier' : 'Ajouter'} un {config.itemLabel}
          </DialogTitle>
          <DialogDescription>{collection.name}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="item-title">Titre</Label>
              <Input
                id="item-title"
                name="title"
                required
                maxLength={200}
                defaultValue={item?.title ?? ''}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="item-subtitle">Sous-titre</Label>
              <Input
                id="item-subtitle"
                name="subtitle"
                maxLength={240}
                defaultValue={item?.subtitle ?? ''}
                placeholder="Auteur, catégorie ou précision courte"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="item-description">Description</Label>
              <Textarea
                id="item-description"
                name="description"
                maxLength={2000}
                defaultValue={item?.description ?? ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-url">Lien</Label>
              <Input
                id="item-url"
                name="url"
                type="url"
                maxLength={2048}
                defaultValue={item?.url ?? ''}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-image">Image</Label>
              <Input
                id="item-image"
                name="imageUrl"
                type="url"
                maxLength={2048}
                defaultValue={item?.imageUrl ?? ''}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="item-tags">Étiquettes</Label>
              <Input
                id="item-tags"
                name="tags"
                defaultValue={item?.tags.join(', ') ?? ''}
                placeholder="animation, enfants"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="item-metadata">
                Informations propres à ce type
              </Label>
              <Textarea
                id="item-metadata"
                name="metadata"
                rows={4}
                defaultValue={item ? metadataText(item.metadata) : ''}
                placeholder={config.metadataHint}
              />
              <p className="text-xs text-muted-foreground">
                Une ligne par information, sous la forme « Nom: valeur ».
              </p>
            </div>
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-primary hover:bg-primary/80"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              {item ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ItemDetailDialog({
  item,
  collection,
  busy,
  busyId,
  onClose,
  onEdit,
  onDelete,
  onPreference,
  onComment,
  onDeleteComment,
}: {
  item: FamilyCollectionItem;
  collection: FamilyCollection;
  busy: boolean;
  busyId: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPreference: (value: -1 | 0 | 1) => void;
  onComment: (event: SyntheticEvent<HTMLFormElement>) => void;
  onDeleteComment: (commentId: string) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-2xl">
        {item.imageUrl ? (
          // oxlint-disable-next-line next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            className="max-h-72 w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
        <div className="p-6 pt-5">
          <DialogHeader className="text-left">
            <div className="flex items-start justify-between gap-3 pr-8">
              <div>
                <DialogTitle className="text-2xl">{item.title}</DialogTitle>
                {item.subtitle ? (
                  <DialogDescription className="mt-1">
                    {item.subtitle}
                  </DialogDescription>
                ) : null}
              </div>
              {item.editable ? (
                <div className="flex gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Modifier"
                    onClick={onEdit}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Supprimer"
                    onClick={onDelete}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogHeader>
          {item.description ? (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6">
              {item.description}
            </p>
          ) : null}
          {Object.keys(item.metadata).length ? (
            <dl className="mt-4 grid gap-2 rounded-2xl bg-muted/35 p-4 sm:grid-cols-2">
              {Object.entries(item.metadata).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs font-medium text-muted-foreground">
                    {key}
                  </dt>
                  <dd className="text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {item.tags.map((entry) => (
              <Badge key={entry} variant="secondary">
                <Tags aria-hidden="true" /> {entry}
              </Badge>
            ))}
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-lg border bg-background px-2.5 text-[0.8rem] font-medium transition-colors hover:bg-muted"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" /> Ouvrir
                le lien
              </a>
            ) : null}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border p-2">
            <PreferenceButton
              label="Pas pour moi"
              active={item.preference === -1}
              count={item.preferences.negative}
              disabled={busy}
              onClick={() => onPreference(-1)}
            >
              <ThumbsDown />
            </PreferenceButton>
            <PreferenceButton
              label="Neutre"
              active={item.preference === 0}
              count={item.preferences.neutral}
              disabled={busy}
              onClick={() => onPreference(0)}
            >
              <Minus />
            </PreferenceButton>
            <PreferenceButton
              label="Partant"
              active={item.preference === 1}
              count={item.preferences.positive}
              disabled={busy}
              onClick={() => onPreference(1)}
            >
              <ThumbsUp />
            </PreferenceButton>
          </div>
          <div className="mt-6 border-t pt-5">
            <h3 className="font-semibold">
              Commentaires{' '}
              <span className="text-muted-foreground">
                {item.comments.length}
              </span>
            </h3>
            <div className="mt-3 space-y-3">
              {item.comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-xl bg-muted/35 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{comment.authorName}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat(localeTag(), {
                        dateStyle: 'medium',
                      }).format(new Date(comment.createdAt))}
                    </span>
                  </div>
                  <div className="mt-1 flex items-start justify-between gap-3">
                    <p className="whitespace-pre-wrap leading-5">
                      {comment.body}
                    </p>
                    {comment.editable ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Supprimer le commentaire"
                        disabled={busyId === comment.id}
                        onClick={() => onDeleteComment(comment.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              {!item.comments.length ? (
                <p className="text-sm text-muted-foreground">
                  Aucun commentaire pour le moment.
                </p>
              ) : null}
            </div>
            <form onSubmit={onComment} className="mt-4 flex gap-2">
              <Input
                name="comment"
                required
                maxLength={1000}
                placeholder={`Ajouter un commentaire dans « ${collection.name} »`}
                aria-label="Nouveau commentaire"
              />
              <Button
                type="submit"
                disabled={busy}
                className="bg-primary hover:bg-primary/80"
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <MessageCircle aria-hidden="true" />
                )}
                <span className="sr-only">Envoyer</span>
              </Button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
