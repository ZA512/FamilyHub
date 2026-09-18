import { useEffect, useState, type SyntheticEvent } from 'react';
import { localeTag } from '@/lib/i18n';
import {
  CalendarDays,
  CheckCircle2,
  CheckSquare2,
  ChevronDown,
  CircleX,
  Film,
  Globe2,
  Lightbulb,
  LibraryBig,
  ListChecks,
  LoaderCircle,
  Lock,
  MapPin,
  MessageCircle,
  Plane,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
  Utensils,
} from 'lucide-react';

import type {
  FamilyCollectionSummary,
  FamilyGroup,
  FamilyIdea,
  FamilyMember,
  IdeaCategory,
  IdeaStatus,
  IdeaVisibility,
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

type IdeaScope = 'all' | 'mine' | 'shared';
type IdeaStatusFilter = IdeaStatus | 'ALL';
type ConversionTarget = 'TASK' | 'EVENT' | 'COLLECTION_ITEM';

type IdeasViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
  onNavigate: (view: 'tasks' | 'agenda' | 'collections') => void;
};

const categoryConfig: Record<
  IdeaCategory,
  { label: string; icon: typeof Lightbulb }
> = {
  OUTING: { label: 'Sortie', icon: MapPin },
  MOVIE: { label: 'Film', icon: Film },
  PURCHASE: { label: 'Achat', icon: ShoppingBag },
  ACTIVITY: { label: 'Activité', icon: Sparkles },
  PROJECT: { label: 'Projet', icon: ListChecks },
  RESTAURANT: { label: 'Restaurant', icon: Utensils },
  DESTINATION: { label: 'Destination', icon: Plane },
  GENERAL: { label: 'Idée générale', icon: Lightbulb },
};

const statusConfig: Record<IdeaStatus, { label: string; className: string }> = {
  PROPOSED: {
    label: 'Proposée',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  RETAINED: {
    label: 'Retenue',
    className: 'border-teal-200 bg-teal-50 text-teal-800',
  },
  REJECTED: {
    label: 'Écartée',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  },
  REALIZED: {
    label: 'Réalisée',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
};

const visibilityLabels: Record<IdeaVisibility, string> = {
  PRIVATE: 'Moi uniquement',
  ALL_MEMBERS: 'Tout le foyer',
  GROUPS: 'Certains groupes',
  SELECTED_USERS: 'Certaines personnes',
};

const conversionLabels: Record<ConversionTarget, string> = {
  TASK: 'Tâche',
  EVENT: 'Événement',
  COLLECTION_ITEM: 'Élément de collection',
};

function toggleValue(current: string[], id: string) {
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
}

function defaultConversionWindow() {
  const now = Date.now();
  return {
    startsAt: localDateTime(new Date(now + 3_600_000)),
    endsAt: localDateTime(new Date(now + 7_200_000)),
  };
}

export function IdeasView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
  onNavigate,
}: IdeasViewProps) {
  const [ideas, setIdeas] = useState<FamilyIdea[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [collections, setCollections] = useState<FamilyCollectionSummary[]>([]);
  const [status, setStatus] = useState<IdeaStatusFilter>('PROPOSED');
  const [category, setCategory] = useState<IdeaCategory | 'ALL'>('ALL');
  const [scope, setScope] = useState<IdeaScope>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FamilyIdea | null>(null);
  const [conversionTarget, setConversionTarget] = useState<FamilyIdea | null>(
    null,
  );
  const [conversionType, setConversionType] =
    useState<ConversionTarget>('TASK');
  const [conversionStartsAt, setConversionStartsAt] = useState('');
  const [conversionEndsAt, setConversionEndsAt] = useState('');
  const [visibility, setVisibility] = useState<IdeaVisibility>('ALL_MEMBERS');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/members', { signal: controller.signal }),
      fetch('/api/v1/groups', { signal: controller.signal }),
    ])
      .then(async ([membersResponse, groupsResponse]) => {
        if (!membersResponse.ok || !groupsResponse.ok)
          throw new Error('Les options de partage sont indisponibles.');
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
      const params = new URLSearchParams({ scope, status, limit: '30' });
      if (category !== 'ALL') params.set('category', category);
      if (query.trim()) params.set('q', query.trim());
      fetch(`/api/v1/ideas?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Impossible de charger les idées.');
          return (await response.json()) as {
            ideas: FamilyIdea[];
            hasMore: boolean;
          };
        })
        .then((payload) => {
          setIdeas(payload.ideas);
          setHasMore(payload.hasMore);
          setError('');
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error ? reason.message : 'Idées indisponibles.',
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
  }, [category, query, reloadToken, scope, status]);

  function replaceIdea(idea: FamilyIdea) {
    setIdeas((current) =>
      current.map((candidate) => (candidate.id === idea.id ? idea : candidate)),
    );
  }

  function resetComposer() {
    setVisibility('ALL_MEMBERS');
    setSelectedGroups([]);
    setSelectedMembers([]);
    setError('');
  }

  function openComposer() {
    resetComposer();
    onComposerOpenChange(true);
  }

  function closeComposer() {
    if (submitting) return;
    resetComposer();
    onComposerOpenChange(false);
  }

  async function createIdea(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/v1/ideas', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          title: data.get('title'),
          description: data.get('description'),
          category: data.get('category'),
          visibility,
          groupIds: visibility === 'GROUPS' ? selectedGroups : [],
          memberIds: visibility === 'SELECTED_USERS' ? selectedMembers : [],
          clientMutationId: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error('L’idée n’a pas pu être proposée.');
      resetComposer();
      onComposerOpenChange(false);
      setReloadToken((value) => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Création impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function react(idea: FamilyIdea, value: -1 | 1) {
    setBusyId(idea.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/ideas/${idea.id}/reaction`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          value: idea.myReaction === value ? null : value,
        }),
      });
      if (!response.ok)
        throw new Error('La réaction n’a pas pu être enregistrée.');
      replaceIdea(((await response.json()) as { idea: FamilyIdea }).idea);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Réaction impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function addComment(
    idea: FamilyIdea,
    event: SyntheticEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusyId(idea.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/ideas/${idea.id}/comments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          body: data.get('body'),
          clientMutationId: crypto.randomUUID(),
        }),
      });
      if (!response.ok)
        throw new Error('Le commentaire n’a pas pu être ajouté.');
      replaceIdea(((await response.json()) as { idea: FamilyIdea }).idea);
      form.reset();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Commentaire impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function removeComment(idea: FamilyIdea, commentId: string) {
    setBusyId(idea.id);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/ideas/${idea.id}/comments/${commentId}`,
        {
          method: 'DELETE',
          headers: { 'x-csrf-token': csrfToken },
        },
      );
      if (!response.ok)
        throw new Error('Le commentaire n’a pas pu être supprimé.');
      replaceIdea({
        ...idea,
        comments: idea.comments.filter((comment) => comment.id !== commentId),
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function updateStatus(idea: FamilyIdea, nextStatus: IdeaStatus) {
    setBusyId(idea.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/ideas/${idea.id}/status`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ status: nextStatus, version: idea.version }),
      });
      if (response.status === 409)
        throw new Error('Cette idée a été modifiée ailleurs. Rechargez-la.');
      if (!response.ok) throw new Error('Le statut n’a pas pu être modifié.');
      const updated = ((await response.json()) as { idea: FamilyIdea }).idea;
      if (status !== 'ALL' && updated.status !== status) {
        setIdeas((current) =>
          current.filter((candidate) => candidate.id !== idea.id),
        );
      } else replaceIdea(updated);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function openConversion(idea: FamilyIdea) {
    const defaults = defaultConversionWindow();
    setConversionType('TASK');
    setConversionStartsAt(defaults.startsAt);
    setConversionEndsAt(defaults.endsAt);
    setConversionTarget(idea);
    setError('');
    try {
      const response = await fetch('/api/v1/collections?scope=all&limit=100');
      if (response.ok) {
        const payload = (await response.json()) as {
          collections: FamilyCollectionSummary[];
        };
        setCollections(payload.collections);
      } else setCollections([]);
    } catch {
      setCollections([]);
    }
  }

  async function convertIdea(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversionTarget) return;
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        target: conversionType,
        clientMutationId: crypto.randomUUID(),
      };
      if (conversionType === 'EVENT') {
        const startsAt = data.get('startsAt');
        const endsAt = data.get('endsAt');
        payload.startsAt = new Date(
          typeof startsAt === 'string' ? startsAt : '',
        ).toISOString();
        payload.endsAt = new Date(
          typeof endsAt === 'string' ? endsAt : '',
        ).toISOString();
      }
      if (conversionType === 'COLLECTION_ITEM')
        payload.collectionId = data.get('collectionId');
      const response = await fetch(
        `/api/v1/ideas/${conversionTarget.id}/convert`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(payload),
        },
      );
      if (response.status === 409)
        throw new Error('Cette conversion n’est pas disponible actuellement.');
      if (!response.ok) throw new Error('L’idée n’a pas pu être convertie.');
      const idea = ((await response.json()) as { idea: FamilyIdea }).idea;
      setConversionTarget(null);
      if (status !== 'ALL' && status !== 'REALIZED')
        setIdeas((current) =>
          current.filter((candidate) => candidate.id !== idea.id),
        );
      else replaceIdea(idea);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Conversion impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteIdea() {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/ideas/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('L’idée n’a pas pu être supprimée.');
      setIdeas((current) =>
        current.filter((idea) => idea.id !== deleteTarget.id),
      );
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
    const last = ideas.at(-1);
    if (!last) return;
    const params = new URLSearchParams({
      scope,
      status,
      limit: '30',
      before: last.updatedAt,
      beforeId: last.id,
    });
    if (category !== 'ALL') params.set('category', category);
    if (query.trim()) params.set('q', query.trim());
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/ideas?${params}`);
      if (!response.ok) throw new Error('Impossible de charger la suite.');
      const payload = (await response.json()) as {
        ideas: FamilyIdea[];
        hasMore: boolean;
      };
      setIdeas((current) => [...current, ...payload.ideas]);
      setHasMore(payload.hasMore);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-medium text-primary">
            Envies du foyer
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
            Boîte à idées
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Proposez, échangez et transformez les bonnes idées en actions.
          </p>
        </div>
        <Button
          onClick={openComposer}
          className="rounded-xl bg-primary hover:bg-primary/80"
        >
          <Plus />
          Proposer une idée
        </Button>
      </div>

      <div className="mb-5 space-y-3">
        <Tabs
          value={status}
          onValueChange={(value) => setStatus(value as IdeaStatusFilter)}
        >
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="PROPOSED">Proposées</TabsTrigger>
            <TabsTrigger value="RETAINED">Retenues</TabsTrigger>
            <TabsTrigger value="REALIZED">Réalisées</TabsTrigger>
            <TabsTrigger value="REJECTED">Écartées</TabsTrigger>
            <TabsTrigger value="ALL">Toutes</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher une idée…"
              className="pl-9"
            />
          </div>
          <Select
            value={category}
            onValueChange={(value) =>
              setCategory(value as IdeaCategory | 'ALL')
            }
          >
            <SelectTrigger className="w-full lg:w-48" aria-label="Catégorie">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Toutes les catégories</SelectItem>
              {Object.entries(categoryConfig).map(([value, config]) => (
                <SelectItem key={value} value={value}>
                  {config.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={scope}
            onValueChange={(value) => setScope(value as IdeaScope)}
          >
            <SelectTrigger className="w-full lg:w-44" aria-label="Portée">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les idées</SelectItem>
              <SelectItem value="mine">Proposées par moi</SelectItem>
              <SelectItem value="shared">Partagées avec moi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}
      {loading && !ideas.length ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <LoaderCircle className="animate-spin" />
            Chargement des idées…
          </CardContent>
        </Card>
      ) : ideas.length ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {ideas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              busy={busyId === idea.id}
              onReact={(value) => void react(idea, value)}
              onComment={(event) => void addComment(idea, event)}
              onRemoveComment={(commentId) =>
                void removeComment(idea, commentId)
              }
              onStatus={(nextStatus) => void updateStatus(idea, nextStatus)}
              onConvert={() => void openConversion(idea)}
              onDelete={() => setDeleteTarget(idea)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center py-14 text-center">
            <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-amber-100 text-amber-700">
              <Lightbulb />
            </span>
            <h2 className="font-semibold">Aucune idée ici</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Une sortie, un achat ou un projet en tête ? Proposez-le au foyer.
            </p>
          </CardContent>
        </Card>
      )}
      {hasMore ? (
        <div className="mt-5 text-center">
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <ChevronDown />
            )}
            Afficher la suite
          </Button>
        </div>
      ) : null}

      <IdeaEditorDialog
        open={composerOpen}
        visibility={visibility}
        groups={groups}
        members={members}
        selectedGroups={selectedGroups}
        selectedMembers={selectedMembers}
        submitting={submitting}
        onClose={closeComposer}
        onSave={createIdea}
        onVisibilityChange={setVisibility}
        onGroupsChange={setSelectedGroups}
        onMembersChange={setSelectedMembers}
      />
      <ConversionDialog
        idea={conversionTarget}
        target={conversionType}
        startsAt={conversionStartsAt}
        endsAt={conversionEndsAt}
        collections={collections}
        submitting={submitting}
        onTargetChange={setConversionType}
        onStartsAtChange={setConversionStartsAt}
        onEndsAtChange={setConversionEndsAt}
        onClose={() => !submitting && setConversionTarget(null)}
        onConvert={convertIdea}
      />
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette idée ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les réactions et commentaires associés seront également retirés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                void deleteIdea();
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function IdeaCard({
  idea,
  busy,
  onReact,
  onComment,
  onRemoveComment,
  onStatus,
  onConvert,
  onDelete,
  onNavigate,
}: {
  idea: FamilyIdea;
  busy: boolean;
  onReact: (value: -1 | 1) => void;
  onComment: (event: SyntheticEvent<HTMLFormElement>) => void;
  onRemoveComment: (commentId: string) => void;
  onStatus: (status: IdeaStatus) => void;
  onConvert: () => void;
  onDelete: () => void;
  onNavigate: IdeasViewProps['onNavigate'];
}) {
  const category = categoryConfig[idea.category];
  const CategoryIcon = category.icon;
  return (
    <Card
      className={`overflow-hidden py-0 ${idea.status === 'RETAINED' ? 'ring-1 ring-primary/25' : ''}`}
    >
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
            <CategoryIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{category.label}</Badge>
              <Badge
                variant="outline"
                className={statusConfig[idea.status].className}
              >
                {statusConfig[idea.status].label}
              </Badge>
            </div>
            <h2 className="mt-3 text-lg font-semibold leading-snug">
              {idea.title}
            </h2>
            {idea.description ? (
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {idea.description}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              Proposée par {idea.createdByName} · {formatDate(idea.createdAt)}
            </p>
          </div>
          {idea.editable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Supprimer « ${idea.title} »`}
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-y py-3">
          <Button
            type="button"
            size="sm"
            variant={idea.myReaction === 1 ? 'default' : 'outline'}
            disabled={busy}
            onClick={() => onReact(1)}
            className={
              idea.myReaction === 1 ? 'bg-primary hover:bg-primary/80' : ''
            }
          >
            <ThumbsUp />
            {idea.positiveCount}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={idea.myReaction === -1 ? 'secondary' : 'outline'}
            disabled={busy}
            onClick={() => onReact(-1)}
          >
            <ThumbsDown />
            {idea.negativeCount}
          </Button>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircle className="size-3.5" />
            {idea.comments.length} commentaire
            {idea.comments.length > 1 ? 's' : ''}
          </span>
        </div>

        {idea.comments.length ? (
          <div className="mt-4 space-y-2">
            {idea.comments.map((comment) => (
              <div
                key={comment.id}
                className="flex gap-2 rounded-xl bg-muted/45 px-3 py-2.5"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-background text-[10px] font-bold">
                  {comment.authorName.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{comment.authorName}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">
                    {comment.body}
                  </p>
                </div>
                {comment.editable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    aria-label="Supprimer ce commentaire"
                    onClick={() => onRemoveComment(comment.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <form onSubmit={onComment} className="mt-3 flex gap-2">
          <Label htmlFor={`idea-comment-${idea.id}`} className="sr-only">
            Commenter {idea.title}
          </Label>
          <Input
            id={`idea-comment-${idea.id}`}
            name="body"
            required
            maxLength={1000}
            placeholder="Ajouter un commentaire…"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy}
            aria-label="Publier le commentaire"
          >
            {busy ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <MessageCircle />
            )}
          </Button>
        </form>

        {idea.conversion ? (
          <button
            type="button"
            onClick={() =>
              onNavigate(
                idea.conversion!.targetType === 'TASK'
                  ? 'tasks'
                  : idea.conversion!.targetType === 'EVENT'
                    ? 'agenda'
                    : 'collections',
              )
            }
            className="mt-4 flex w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-left text-sm text-emerald-900"
          >
            <CheckCircle2 className="size-5 shrink-0" />
            <span>
              <span className="block font-medium">
                Convertie en{' '}
                {conversionLabels[idea.conversion.targetType].toLocaleLowerCase(
                  'fr',
                )}
              </span>
              <span className="text-xs text-emerald-700">
                par {idea.conversion.convertedByName}
              </span>
            </span>
          </button>
        ) : null}

        {idea.editable && !idea.conversion ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {idea.status === 'PROPOSED' ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => onStatus('RETAINED')}
                  className="bg-primary hover:bg-primary/80"
                >
                  <CheckCircle2 />
                  Retenir
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onStatus('REJECTED')}
                >
                  <CircleX />
                  Écarter
                </Button>
              </>
            ) : idea.status === 'RETAINED' ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={onConvert}
                  className="bg-primary hover:bg-primary/80"
                >
                  <Sparkles />
                  Concrétiser
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onStatus('PROPOSED')}
                >
                  Reproposer
                </Button>
              </>
            ) : idea.status === 'REJECTED' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onStatus('PROPOSED')}
              >
                Reproposer
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function IdeaEditorDialog({
  open,
  visibility,
  groups,
  members,
  selectedGroups,
  selectedMembers,
  submitting,
  onClose,
  onSave,
  onVisibilityChange,
  onGroupsChange,
  onMembersChange,
}: {
  open: boolean;
  visibility: IdeaVisibility;
  groups: FamilyGroup[];
  members: FamilyMember[];
  selectedGroups: string[];
  selectedMembers: string[];
  submitting: boolean;
  onClose: () => void;
  onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
  onVisibilityChange: (visibility: IdeaVisibility) => void;
  onGroupsChange: (ids: string[]) => void;
  onMembersChange: (ids: string[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Proposer une idée</DialogTitle>
          <DialogDescription>
            Partagez une envie pour que le foyer puisse réagir et en discuter.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSave} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="idea-title">Titre</Label>
            <Input
              id="idea-title"
              name="title"
              required
              maxLength={200}
              placeholder="Un week-end à Annecy"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="idea-description">
              Description{' '}
              <span className="font-normal text-muted-foreground">
                (facultatif)
              </span>
            </Label>
            <Textarea
              id="idea-description"
              name="description"
              maxLength={2000}
              placeholder="Pourquoi, quand, budget approximatif…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="idea-category">Catégorie</Label>
            <Select name="category" defaultValue="GENERAL">
              <SelectTrigger id="idea-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(categoryConfig).map(([value, config]) => (
                  <SelectItem key={value} value={value}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onClose}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-primary hover:bg-primary/80"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Lightbulb />
              )}
              Proposer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConversionDialog({
  idea,
  target,
  startsAt,
  endsAt,
  collections,
  submitting,
  onTargetChange,
  onStartsAtChange,
  onEndsAtChange,
  onClose,
  onConvert,
}: {
  idea: FamilyIdea | null;
  target: ConversionTarget;
  startsAt: string;
  endsAt: string;
  collections: FamilyCollectionSummary[];
  submitting: boolean;
  onTargetChange: (target: ConversionTarget) => void;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  onClose: () => void;
  onConvert: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={Boolean(idea)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Concrétiser cette idée</DialogTitle>
          <DialogDescription>
            « {idea?.title} » deviendra une action dans le module choisi.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onConvert} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="conversion-target">Destination</Label>
            <Select
              value={target}
              onValueChange={(value) =>
                onTargetChange(value as ConversionTarget)
              }
            >
              <SelectTrigger id="conversion-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TASK">
                  <span className="flex items-center gap-2">
                    <CheckSquare2 className="size-4" />
                    Tâche ouverte
                  </span>
                </SelectItem>
                <SelectItem value="EVENT">
                  <span className="flex items-center gap-2">
                    <CalendarDays className="size-4" />
                    Événement
                  </span>
                </SelectItem>
                <SelectItem value="COLLECTION_ITEM">
                  <span className="flex items-center gap-2">
                    <LibraryBig className="size-4" />
                    Élément de collection
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {target === 'EVENT' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="conversion-start">Début</Label>
                <Input
                  id="conversion-start"
                  name="startsAt"
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(event) => onStartsAtChange(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="conversion-end">Fin</Label>
                <Input
                  id="conversion-end"
                  name="endsAt"
                  type="datetime-local"
                  required
                  value={endsAt}
                  onChange={(event) => onEndsAtChange(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          {target === 'COLLECTION_ITEM' ? (
            <div className="space-y-2">
              <Label htmlFor="conversion-collection">Collection</Label>
              {collections.length ? (
                <Select name="collectionId" required>
                  <SelectTrigger id="conversion-collection">
                    <SelectValue placeholder="Choisir une collection" />
                  </SelectTrigger>
                  <SelectContent>
                    {collections.map((collection) => (
                      <SelectItem key={collection.id} value={collection.id}>
                        {collection.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                  Aucune collection accessible. Activez ou créez d’abord une
                  collection.
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onClose}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                (target === 'COLLECTION_ITEM' && !collections.length)
              }
              className="bg-primary hover:bg-primary/80"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              Concrétiser
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
  visibility: IdeaVisibility;
  groups: FamilyGroup[];
  members: FamilyMember[];
  selectedGroups: string[];
  selectedMembers: string[];
  onVisibilityChange: (visibility: IdeaVisibility) => void;
  onGroupsChange: (ids: string[]) => void;
  onMembersChange: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
      <div className="space-y-2">
        <Label htmlFor="idea-visibility">Qui peut participer ?</Label>
        <Select
          value={visibility}
          onValueChange={(value) => onVisibilityChange(value as IdeaVisibility)}
        >
          <SelectTrigger id="idea-visibility">
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
            <div
              key={group.id}
              className="flex items-center gap-3 rounded-xl border bg-background p-3 text-sm"
            >
              <Checkbox
                id={`idea-group-${group.id}`}
                checked={selectedGroups.includes(group.id)}
                onCheckedChange={() =>
                  onGroupsChange(toggleValue(selectedGroups, group.id))
                }
              />
              <Label htmlFor={`idea-group-${group.id}`}>{group.name}</Label>
            </div>
          ))}
        </div>
      ) : null}
      {visibility === 'SELECTED_USERS' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 rounded-xl border bg-background p-3 text-sm"
            >
              <Checkbox
                id={`idea-member-${member.id}`}
                checked={selectedMembers.includes(member.id)}
                onCheckedChange={() =>
                  onMembersChange(toggleValue(selectedMembers, member.id))
                }
              />
              <Label htmlFor={`idea-member-${member.id}`}>
                {member.firstName}
                {member.lastName ? ` ${member.lastName}` : ''}
              </Label>
            </div>
          ))}
        </div>
      ) : null}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {visibility === 'PRIVATE' ? (
          <Lock className="size-3.5" />
        ) : visibility === 'ALL_MEMBERS' ? (
          <Globe2 className="size-3.5" />
        ) : (
          <Users className="size-3.5" />
        )}
        {visibilityLabels[visibility]}
      </p>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(localeTag(), { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
