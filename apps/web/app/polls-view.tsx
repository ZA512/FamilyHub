import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  ChartBar,
  Check,
  CircleCheck,
  Clock,
  Globe2,
  ListChecks,
  LoaderCircle,
  Lock,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import type {
  FamilyGroup,
  FamilyMember,
  FamilyPoll,
  PollVisibility,
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

type PollScope = 'all' | 'mine' | 'shared';
type PollStatus = 'active' | 'ended' | 'all';

type PollsViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

const visibilityLabels: Record<PollVisibility, string> = {
  PRIVATE: 'Moi uniquement',
  ALL_MEMBERS: 'Tout le foyer',
  GROUPS: 'Certains groupes',
  SELECTED_USERS: 'Certaines personnes',
};

function toggleValue(current: string[], id: string) {
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
}

function pollSelections(polls: FamilyPoll[]) {
  return Object.fromEntries(
    polls.map((poll) => [
      poll.id,
      poll.options
        .filter((option) => option.selectedByMe)
        .map((option) => option.id),
    ]),
  );
}

export function PollsView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: PollsViewProps) {
  const [polls, setPolls] = useState<FamilyPoll[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [scope, setScope] = useState<PollScope>('all');
  const [status, setStatus] = useState<PollStatus>('active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FamilyPoll | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [options, setOptions] = useState(['', '']);
  const [visibility, setVisibility] = useState<PollVisibility>('ALL_MEMBERS');
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
      if (query.trim()) params.set('q', query.trim());
      fetch(`/api/v1/polls?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok)
            throw new Error('Impossible de charger les sondages.');
          return (await response.json()) as {
            polls: FamilyPoll[];
            hasMore: boolean;
          };
        })
        .then((payload) => {
          setPolls(payload.polls);
          setSelections(pollSelections(payload.polls));
          setHasMore(payload.hasMore);
          setError('');
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error
                ? reason.message
                : 'Sondages indisponibles.',
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
  }, [query, reloadToken, scope, status]);

  function resetComposer() {
    setOptions(['', '']);
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

  function chooseOption(poll: FamilyPoll, optionId: string) {
    if (poll.ended) return;
    setSelections((current) => ({
      ...current,
      [poll.id]: poll.allowMultiple
        ? toggleValue(current[poll.id] ?? [], optionId)
        : [optionId],
    }));
  }

  async function vote(poll: FamilyPoll) {
    const optionIds = selections[poll.id] ?? [];
    if (!optionIds.length) return;
    setBusyId(poll.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/polls/${poll.id}/votes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ optionIds }),
      });
      if (response.status === 409)
        throw new Error('Ce sondage vient de se terminer.');
      if (!response.ok)
        throw new Error('Votre vote n’a pas pu être enregistré.');
      const payload = (await response.json()) as { poll: FamilyPoll };
      setPolls((current) =>
        current.map((candidate) =>
          candidate.id === payload.poll.id ? payload.poll : candidate,
        ),
      );
      setSelections((current) => ({
        ...current,
        [poll.id]: payload.poll.options
          .filter((option) => option.selectedByMe)
          .map((option) => option.id),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vote impossible.');
    } finally {
      setBusyId(null);
    }
  }

  async function createPoll(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const answers = options.map((option) => option.trim()).filter(Boolean);
    if (answers.length < 2) {
      setError('Ajoutez au moins deux réponses.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const endValue = data.get('endsAt');
      const rawEndsAt = typeof endValue === 'string' ? endValue : '';
      const response = await fetch('/api/v1/polls', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          question: data.get('question'),
          description: data.get('description'),
          options: answers,
          allowMultiple: data.get('allowMultiple') === 'on',
          anonymous: data.get('anonymous') === 'on',
          endsAt: rawEndsAt ? new Date(rawEndsAt).toISOString() : null,
          visibility,
          groupIds: visibility === 'GROUPS' ? selectedGroups : [],
          memberIds: visibility === 'SELECTED_USERS' ? selectedMembers : [],
          clientMutationId: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error('Le sondage n’a pas pu être créé.');
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

  async function deletePoll() {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/polls/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('Le sondage n’a pas pu être supprimé.');
      setDeleteTarget(null);
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
    const last = polls.at(-1);
    if (!last) return;
    setLoading(true);
    const params = new URLSearchParams({
      scope,
      status,
      limit: '30',
      before: last.updatedAt,
      beforeId: last.id,
    });
    if (query.trim()) params.set('q', query.trim());
    try {
      const response = await fetch(`/api/v1/polls?${params}`);
      if (!response.ok) throw new Error('Impossible de charger la suite.');
      const payload = (await response.json()) as {
        polls: FamilyPoll[];
        hasMore: boolean;
      };
      setPolls((current) => [...current, ...payload.polls]);
      setSelections((current) => ({
        ...current,
        ...pollSelections(payload.polls),
      }));
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
          <p className="mb-1 text-sm font-medium text-[#087f72]">
            Décider ensemble
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
            Sondages
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Une question claire, un vote rapide, une décision visible.
          </p>
        </div>
        <Button
          onClick={openComposer}
          className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
        >
          <Plus aria-hidden="true" /> Nouveau sondage
        </Button>
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs
          value={status}
          onValueChange={(value) => setStatus(value as PollStatus)}
        >
          <TabsList>
            <TabsTrigger value="active">Ouverts</TabsTrigger>
            <TabsTrigger value="ended">Terminés</TabsTrigger>
            <TabsTrigger value="all">Tous</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-0 flex-1 lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher une question…"
            className="pl-9"
          />
        </div>
        <Select
          value={scope}
          onValueChange={(value) => setScope(value as PollScope)}
        >
          <SelectTrigger
            className="w-full lg:w-44"
            aria-label="Portée des sondages"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les sondages</SelectItem>
            <SelectItem value="mine">Créés par moi</SelectItem>
            <SelectItem value="shared">Partagés avec moi</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      {loading && !polls.length ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <LoaderCircle className="animate-spin" />
            Chargement des sondages…
          </CardContent>
        </Card>
      ) : polls.length ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {polls.map((poll) => (
            <PollCard
              key={poll.id}
              poll={poll}
              selected={selections[poll.id] ?? []}
              busy={busyId === poll.id}
              onChoose={(optionId) => chooseOption(poll, optionId)}
              onVote={() => void vote(poll)}
              onDelete={() => setDeleteTarget(poll)}
            />
          ))}
        </div>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center py-14 text-center">
            <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
              <ChartBar />
            </span>
            <h2 className="font-semibold">Aucun sondage ici</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Lancez une question au foyer pour recueillir les avis de chacun.
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
            {loading ? <LoaderCircle className="animate-spin" /> : null}Afficher
            la suite
          </Button>
        </div>
      ) : null}

      <PollEditorDialog
        open={composerOpen}
        options={options}
        visibility={visibility}
        groups={groups}
        members={members}
        selectedGroups={selectedGroups}
        selectedMembers={selectedMembers}
        submitting={submitting}
        onClose={closeComposer}
        onSave={createPoll}
        onOptionsChange={setOptions}
        onVisibilityChange={setVisibility}
        onGroupsChange={setSelectedGroups}
        onMembersChange={setSelectedMembers}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce sondage ?</AlertDialogTitle>
            <AlertDialogDescription>
              La question, les votes et les résultats seront retirés du foyer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                void deletePoll();
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}{' '}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function PollCard({
  poll,
  selected,
  busy,
  onChoose,
  onVote,
  onDelete,
}: {
  poll: FamilyPoll;
  selected: string[];
  busy: boolean;
  onChoose: (optionId: string) => void;
  onVote: () => void;
  onDelete: () => void;
}) {
  const changed = poll.options.some(
    (option) => option.selectedByMe !== selected.includes(option.id),
  );
  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
            <ChartBar className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">
                {poll.allowMultiple ? 'Choix multiples' : 'Un seul choix'}
              </Badge>
              {poll.anonymous ? (
                <Badge variant="outline">
                  <Lock /> Anonyme
                </Badge>
              ) : null}
              {poll.ended ? <Badge variant="outline">Terminé</Badge> : null}
            </div>
            <h2 className="mt-3 text-lg font-semibold leading-snug">
              {poll.question}
            </h2>
            {poll.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {poll.description}
              </p>
            ) : null}
          </div>
          {poll.editable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Supprimer « ${poll.question} »`}
              onClick={onDelete}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>

        <div className="mt-5 space-y-2.5">
          {poll.options.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                disabled={poll.ended}
                aria-pressed={checked}
                aria-label={`${checked ? 'Désélectionner' : 'Sélectionner'} ${option.label}, ${option.percentage} %, ${option.voteCount} vote${option.voteCount > 1 ? 's' : ''}`}
                onClick={() => onChoose(option.id)}
                className={`relative w-full overflow-hidden rounded-xl border px-3 py-3 text-left transition-colors ${checked ? 'border-[#087f72] bg-[#f1fbf9]' : 'bg-background hover:bg-muted/40'} disabled:cursor-default`}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-[#d9f4ef] transition-[width]"
                  style={{ width: `${option.percentage}%` }}
                />
                <span className="relative flex items-start gap-3">
                  <span
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center border text-white ${poll.allowMultiple ? 'rounded-md' : 'rounded-full'} ${checked ? 'border-[#087f72] bg-[#087f72]' : 'border-muted-foreground/40 bg-background'}`}
                  >
                    {checked ? (
                      <Check className="size-3.5" strokeWidth={3} />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-sm font-medium">
                      <span>{option.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {option.percentage}% · {option.voteCount}
                      </span>
                    </span>
                    {option.voterNames?.length ? (
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {option.voterNames.join(', ')}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="text-xs text-muted-foreground">
            <p>
              {poll.voterCount} participant{poll.voterCount > 1 ? 's' : ''} ·
              par {poll.createdByName}
            </p>
            <p className="mt-0.5 flex items-center gap-1">
              {poll.endsAt ? (
                <>
                  <Clock className="size-3" />
                  {poll.ended ? 'Clos ' : 'Fin '}
                  {formatDate(poll.endsAt)}
                </>
              ) : (
                <>Sans date de fin</>
              )}
            </p>
          </div>
          {!poll.ended ? (
            <Button
              disabled={!selected.length || busy || (poll.hasVoted && !changed)}
              onClick={onVote}
              className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
            >
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CircleCheck />
              )}
              {poll.hasVoted ? 'Modifier mon vote' : 'Voter'}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PollEditorDialog({
  open,
  options,
  visibility,
  groups,
  members,
  selectedGroups,
  selectedMembers,
  submitting,
  onClose,
  onSave,
  onOptionsChange,
  onVisibilityChange,
  onGroupsChange,
  onMembersChange,
}: {
  open: boolean;
  options: string[];
  visibility: PollVisibility;
  groups: FamilyGroup[];
  members: FamilyMember[];
  selectedGroups: string[];
  selectedMembers: string[];
  submitting: boolean;
  onClose: () => void;
  onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
  onOptionsChange: (options: string[]) => void;
  onVisibilityChange: (visibility: PollVisibility) => void;
  onGroupsChange: (ids: string[]) => void;
  onMembersChange: (ids: string[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nouveau sondage</DialogTitle>
          <DialogDescription>
            Posez une question et laissez le foyer choisir.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSave} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="poll-question">Question</Label>
            <Input
              id="poll-question"
              name="question"
              required
              maxLength={300}
              placeholder="Où partons-nous ce week-end ?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="poll-description">
              Précisions{' '}
              <span className="font-normal text-muted-foreground">
                (facultatif)
              </span>
            </Label>
            <Textarea
              id="poll-description"
              name="description"
              maxLength={1500}
              placeholder="Budget, contraintes, contexte…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="poll-option-0">Réponses</Label>
            {options.map((option, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  id={`poll-option-${index}`}
                  value={option}
                  onChange={(event) =>
                    onOptionsChange(
                      options.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? event.target.value
                          : candidate,
                      ),
                    )
                  }
                  required={index < 2}
                  maxLength={160}
                  placeholder={`Réponse ${index + 1}`}
                />
                {options.length > 2 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Supprimer la réponse ${index + 1}`}
                    onClick={() =>
                      onOptionsChange(
                        options.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      )
                    }
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            ))}
            {options.length < 12 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOptionsChange([...options, ''])}
              >
                <Plus />
                Ajouter une réponse
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-xl border p-3 text-sm">
              <Checkbox id="poll-multiple" name="allowMultiple" />
              <span>
                <Label htmlFor="poll-multiple" className="block font-medium">Choix multiples</Label>
                <span className="text-muted-foreground">
                  Plusieurs réponses possibles
                </span>
              </span>
            </div>
            <div className="flex items-start gap-3 rounded-xl border p-3 text-sm">
              <Checkbox id="poll-anonymous" name="anonymous" />
              <span>
                <Label htmlFor="poll-anonymous" className="block font-medium">Vote anonyme</Label>
                <span className="text-muted-foreground">
                  Les noms restent masqués
                </span>
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="poll-end">
              Date de fin{' '}
              <span className="font-normal text-muted-foreground">
                (facultatif)
              </span>
            </Label>
            <Input
              id="poll-end"
              name="endsAt"
              type="datetime-local"
              min={localDateTimeMinimum()}
            />
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
              className="bg-[#087f72] hover:bg-[#076d63]"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ChartBar />
              )}
              Publier
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
  visibility: PollVisibility;
  groups: FamilyGroup[];
  members: FamilyMember[];
  selectedGroups: string[];
  selectedMembers: string[];
  onVisibilityChange: (visibility: PollVisibility) => void;
  onGroupsChange: (ids: string[]) => void;
  onMembersChange: (ids: string[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
      <div className="space-y-2">
        <Label htmlFor="poll-visibility">Qui peut participer ?</Label>
        <Select
          value={visibility}
          onValueChange={(value) => onVisibilityChange(value as PollVisibility)}
        >
          <SelectTrigger id="poll-visibility">
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
              <Users className="size-4 text-muted-foreground" />
              {group.name}
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
              {member.firstName}
              {member.lastName ? ` ${member.lastName}` : ''}
            </label>
          ))}
        </div>
      ) : null}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {visibility === 'PRIVATE' ? (
          <Lock className="size-3.5" />
        ) : visibility === 'ALL_MEMBERS' ? (
          <Globe2 className="size-3.5" />
        ) : (
          <ListChecks className="size-3.5" />
        )}
        {visibilityLabels[visibility]}
      </p>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function localDateTimeMinimum() {
  const date = new Date(Date.now() + 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
