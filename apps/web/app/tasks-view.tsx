import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  CalendarClock,
  Check,
  CirclePlay,
  History,
  LoaderCircle,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Users,
} from 'lucide-react';

import type {
  FamilyMember,
  FamilyTask,
  TaskKind,
  TaskReopenPolicy,
} from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type TasksViewProps = {
  currentMemberId: string;
  role: 'ADMIN' | 'MEMBER';
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

const kindLabels: Record<TaskKind, string> = {
  SCHEDULED: 'Tâche planifiée',
  OPEN_CHORE: 'Corvée ouverte',
  SEASONAL: 'Ponctuelle ou saisonnière',
};

export function TasksView({
  currentMemberId,
  role,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: TasksViewProps) {
  const [tasks, setTasks] = useState<FamilyTask[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<TaskKind>('OPEN_CHORE');
  const [assigneeId, setAssigneeId] = useState('none');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'ALL_MEMBERS'>(
    'ALL_MEMBERS',
  );
  const [claimable, setClaimable] = useState(true);
  const [reopenPolicy, setReopenPolicy] =
    useState<TaskReopenPolicy>('IMMEDIATE');
  const [taskToComplete, setTaskToComplete] = useState<FamilyTask | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/tasks', { signal: controller.signal }),
      fetch('/api/v1/members', { signal: controller.signal }),
    ])
      .then(async ([tasksResponse, membersResponse]) => {
        if (!tasksResponse.ok)
          throw new Error('Impossible de charger les tâches.');
        if (!membersResponse.ok)
          throw new Error('Impossible de charger les membres.');
        return Promise.all([
          tasksResponse.json() as Promise<{ tasks: FamilyTask[] }>,
          membersResponse.json() as Promise<{ members: FamilyMember[] }>,
        ]);
      })
      .then(([tasksPayload, membersPayload]) => {
        setTasks(tasksPayload.tasks);
        setMembers(
          membersPayload.members.filter((member) => member.status === 'ACTIVE'),
        );
        setError('');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Les tâches sont indisponibles.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const openTasks = useMemo(
    () =>
      tasks.filter(
        (task) => task.status === 'OPEN' || task.status === 'IN_PROGRESS',
      ),
    [tasks],
  );
  const closedTasks = useMemo(
    () =>
      tasks.filter(
        (task) => task.status === 'DONE' || task.status === 'CANCELLED',
      ),
    [tasks],
  );

  function resetComposer() {
    setKind('OPEN_CHORE');
    setAssigneeId('none');
    setVisibility('ALL_MEMBERS');
    setClaimable(true);
    setReopenPolicy('IMMEDIATE');
  }

  async function createTask(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const toIso = (name: string) => {
      const entry = data.get(name);
      const value = typeof entry === 'string' ? entry : '';
      return value ? new Date(value).toISOString() : null;
    };
    const numberOrNull = (name: string) => {
      const entry = data.get(name);
      const value = typeof entry === 'string' ? entry : '';
      return value ? Number(value) : null;
    };
    const effectiveAssignee =
      visibility === 'PRIVATE'
        ? kind === 'SCHEDULED'
          ? currentMemberId
          : null
        : assigneeId === 'none'
          ? null
          : assigneeId;

    try {
      const response = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          title: data.get('title'),
          description: data.get('description'),
          kind,
          assigneeId: effectiveAssignee,
          claimable: kind === 'OPEN_CHORE' ? claimable : false,
          dueAt: kind === 'SCHEDULED' ? toIso('dueAt') : null,
          periodStartAt: kind === 'SEASONAL' ? toIso('periodStartAt') : null,
          periodEndAt: kind === 'SEASONAL' ? toIso('periodEndAt') : null,
          recurrenceIntervalDays:
            kind === 'SCHEDULED' || kind === 'SEASONAL'
              ? numberOrNull('recurrenceIntervalDays')
              : null,
          frequencyHint:
            kind === 'OPEN_CHORE' ? data.get('frequencyHint') : null,
          reopenPolicy: kind === 'OPEN_CHORE' ? reopenPolicy : 'NONE',
          reopenDelayHours:
            kind === 'OPEN_CHORE' && reopenPolicy === 'AFTER_DELAY'
              ? numberOrNull('reopenDelayHours')
              : null,
          visibility,
          clientMutationId: crypto.randomUUID(),
        }),
      });
      if (!response.ok)
        throw new Error(await taskError(response, 'Création impossible.'));
      const payload = (await response.json()) as { task: FamilyTask };
      setTasks((current) => [payload.task, ...current]);
      form.reset();
      resetComposer();
      onComposerOpenChange(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Création impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(
    task: FamilyTask,
    status: 'IN_PROGRESS' | 'CANCELLED',
  ) {
    setBusyId(task.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok)
        throw new Error(await taskError(response, 'Modification impossible.'));
      const payload = (await response.json()) as { task: FamilyTask };
      replaceTask(payload.task);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function completeTask(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskToComplete) return;
    setBusyId(taskToComplete.id);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(
        `/api/v1/tasks/${taskToComplete.id}/complete`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            comment: data.get('comment'),
            clientMutationId: crypto.randomUUID(),
          }),
        },
      );
      if (!response.ok)
        throw new Error(await taskError(response, 'Validation impossible.'));
      const payload = (await response.json()) as { task: FamilyTask };
      replaceTask(payload.task);
      setTaskToComplete(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Validation impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reopenTask(task: FamilyTask) {
    setBusyId(task.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/tasks/${task.id}/reopen`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: '{}',
      });
      if (!response.ok)
        throw new Error(await taskError(response, 'Réouverture impossible.'));
      const payload = (await response.json()) as { task: FamilyTask };
      replaceTask(payload.task);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Réouverture impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  function replaceTask(task: FamilyTask) {
    setTasks((current) =>
      current.map((candidate) => (candidate.id === task.id ? task : candidate)),
    );
  }

  return (
    <>
      <Dialog
        open={composerOpen}
        onOpenChange={(open) => {
          onComposerOpenChange(open);
          if (!open) resetComposer();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Nouvelle tâche</DialogTitle>
            <DialogDescription>
              Planifiez une tâche ou laissez une corvée ouverte au foyer.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={createTask}>
            <Field
              label="Titre"
              name="title"
              required
              maxLength={160}
              placeholder="Vider le lave-vaisselle"
            />
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value as TaskKind)}
              >
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN_CHORE">Corvée ouverte</SelectItem>
                  <SelectItem value="SCHEDULED">Tâche planifiée</SelectItem>
                  <SelectItem value="SEASONAL">
                    Ponctuelle ou saisonnière
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {kind === 'SCHEDULED' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Responsable</Label>
                  <Select
                    value={
                      visibility === 'PRIVATE' ? currentMemberId : assigneeId
                    }
                    onValueChange={(value) => setAssigneeId(value ?? 'none')}
                    disabled={visibility === 'PRIVATE'}
                  >
                    <SelectTrigger className="h-11 w-full rounded-xl">
                      <SelectValue placeholder="Choisir" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Choisir un membre</SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.firstName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field
                  label="Échéance"
                  name="dueAt"
                  type="datetime-local"
                  required
                />
                <Field
                  label="Répéter tous les… jours"
                  name="recurrenceIntervalDays"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="7"
                  required={false}
                />
              </div>
            ) : null}

            {kind === 'OPEN_CHORE' ? (
              <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                <Label
                  htmlFor="task-claimable"
                  className="flex items-center gap-3 text-sm font-medium"
                >
                  <Checkbox
                    id="task-claimable"
                    checked={claimable}
                    onCheckedChange={setClaimable}
                  />
                  N’importe quel membre peut s’en charger
                </Label>
                <Field
                  label="Fréquence indicative"
                  name="frequencyHint"
                  maxLength={160}
                  placeholder="Environ une fois par jour"
                  required={false}
                />
                <div className="space-y-2">
                  <Label>Après réalisation</Label>
                  <Select
                    value={reopenPolicy}
                    onValueChange={(value) =>
                      setReopenPolicy(value as TaskReopenPolicy)
                    }
                  >
                    <SelectTrigger className="h-11 w-full rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IMMEDIATE">
                        Rouvrir immédiatement
                      </SelectItem>
                      <SelectItem value="AFTER_DELAY">
                        Rouvrir après un délai
                      </SelectItem>
                      <SelectItem value="MANUAL">
                        Rouvrir manuellement
                      </SelectItem>
                      <SelectItem value="NONE">
                        Terminer définitivement
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {reopenPolicy === 'AFTER_DELAY' ? (
                  <Field
                    label="Délai en heures"
                    name="reopenDelayHours"
                    type="number"
                    min={1}
                    max={8760}
                    required
                  />
                ) : null}
              </div>
            ) : null}

            {kind === 'SEASONAL' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Début de période"
                  name="periodStartAt"
                  type="datetime-local"
                  required={false}
                />
                <Field
                  label="Fin de période"
                  name="periodEndAt"
                  type="datetime-local"
                  required={false}
                />
                <Field
                  label="Répéter tous les… jours"
                  name="recurrenceIntervalDays"
                  type="number"
                  min={1}
                  max={365}
                  placeholder="365"
                  required={false}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>Visibilité</Label>
              <Select
                value={visibility}
                onValueChange={(value) =>
                  setVisibility(value as 'PRIVATE' | 'ALL_MEMBERS')
                }
              >
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_MEMBERS">Tout le foyer</SelectItem>
                  <SelectItem value="PRIVATE">Moi uniquement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-description">Précisions</Label>
              <Textarea
                id="task-description"
                name="description"
                maxLength={1000}
                placeholder="Informations utiles…"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={submitting || !csrfToken}
              className="w-full bg-[#087f72] hover:bg-[#076d63]"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              Créer la tâche
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(taskToComplete)}
        onOpenChange={(open) => !open && setTaskToComplete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Marquer comme fait</DialogTitle>
            <DialogDescription>{taskToComplete?.title}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={completeTask}>
            <div className="space-y-2">
              <Label htmlFor="completion-comment">Commentaire facultatif</Label>
              <Textarea
                id="completion-comment"
                name="comment"
                maxLength={500}
                placeholder="Un détail à conserver dans l’historique…"
              />
            </div>
            <Button
              type="submit"
              disabled={Boolean(busyId)}
              className="w-full bg-[#087f72] hover:bg-[#076d63]"
            >
              {busyId ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              Confirmer
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-medium text-[#087f72]">
              Organisation du foyer
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Tâches et corvées
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              {openTasks.length
                ? `${openTasks.length} élément${openTasks.length > 1 ? 's' : ''} à faire`
                : 'Tout est à jour'}
            </p>
          </div>
          <Button
            onClick={() => onComposerOpenChange(true)}
            className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
          >
            <Plus aria-hidden="true" /> Ajouter
          </Button>
        </div>

        {error && !composerOpen && !taskToComplete ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        {loading ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />{' '}
              Chargement des tâches…
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="open">
            <TabsList className="mb-4 h-10 rounded-xl">
              <TabsTrigger value="open" className="px-4">
                À faire ({openTasks.length})
              </TabsTrigger>
              <TabsTrigger value="history" className="px-4">
                Historique ({closedTasks.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="open">
              {openTasks.length ? (
                <div className="grid gap-3">
                  {openTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      currentMemberId={currentMemberId}
                      role={role}
                      busy={busyId === task.id}
                      onStart={() => updateStatus(task, 'IN_PROGRESS')}
                      onComplete={() => setTaskToComplete(task)}
                      onCancel={() => updateStatus(task, 'CANCELLED')}
                    />
                  ))}
                </div>
              ) : (
                <EmptyTasks />
              )}
            </TabsContent>
            <TabsContent value="history">
              {closedTasks.length ? (
                <div className="grid gap-3">
                  {closedTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      currentMemberId={currentMemberId}
                      role={role}
                      busy={busyId === task.id}
                      onStart={() => undefined}
                      onComplete={() => undefined}
                      onCancel={() => undefined}
                      onReopen={() => reopenTask(task)}
                    />
                  ))}
                </div>
              ) : (
                <Card className="border-dashed bg-muted/20">
                  <CardContent className="py-10 text-center text-muted-foreground">
                    L’historique se remplira après les premières réalisations.
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        )}
      </section>
    </>
  );
}

function TaskCard({
  task,
  currentMemberId,
  role,
  busy,
  onStart,
  onComplete,
  onCancel,
  onReopen,
}: {
  task: FamilyTask;
  currentMemberId: string;
  role: 'ADMIN' | 'MEMBER';
  busy: boolean;
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onReopen?: () => void;
}) {
  const canAct =
    role === 'ADMIN' ||
    task.createdBy === currentMemberId ||
    task.assigneeId === currentMemberId ||
    (task.kind === 'OPEN_CHORE' && task.claimable);
  const canManage = role === 'ADMIN' || task.createdBy === currentMemberId;
  const latestCompletion = task.completions[0];

  return (
    <Card className="gap-3 py-4">
      <CardContent className="px-4 sm:px-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7f5f2] text-[#087f72]">
            {task.kind === 'SCHEDULED' ? (
              <CalendarClock aria-hidden="true" />
            ) : task.kind === 'OPEN_CHORE' ? (
              <RefreshCw aria-hidden="true" />
            ) : (
              <History aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{task.title}</h2>
              <Badge variant="secondary">{kindLabels[task.kind]}</Badge>
              {task.visibility === 'PRIVATE' ? (
                <Badge variant="outline">
                  <Lock aria-hidden="true" /> Privée
                </Badge>
              ) : null}
              {task.status === 'IN_PROGRESS' ? (
                <Badge className="bg-amber-100 text-amber-800">En cours</Badge>
              ) : null}
              {task.status === 'CANCELLED' ? (
                <Badge variant="destructive">Annulée</Badge>
              ) : null}
            </div>
            {task.description ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {task.description}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {task.assigneeName ? (
                <span>
                  <Users className="mr-1 inline size-4" aria-hidden="true" />
                  {task.assigneeName}
                </span>
              ) : null}
              {task.claimable && !task.assigneeName ? (
                <span>Ouverte à tous</span>
              ) : null}
              {task.dueAt ? (
                <span>Pour le {formatDate(task.dueAt)}</span>
              ) : null}
              {task.periodStartAt ? (
                <span>
                  {formatPeriod(task.periodStartAt, task.periodEndAt)}
                </span>
              ) : null}
              {task.recurrenceIntervalDays ? (
                <span>Tous les {task.recurrenceIntervalDays} jours</span>
              ) : null}
              {task.frequencyHint ? <span>{task.frequencyHint}</span> : null}
              {task.nextAvailableAt ? (
                <span>Disponible le {formatDate(task.nextAvailableAt)}</span>
              ) : null}
            </div>
            {latestCompletion ? (
              <p className="mt-3 rounded-lg bg-muted/55 px-3 py-2 text-sm text-muted-foreground">
                Fait par {latestCompletion.completedByName} le{' '}
                {formatDate(latestCompletion.completedAt)}
                {latestCompletion.comment
                  ? ` · ${latestCompletion.comment}`
                  : ''}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {task.status === 'OPEN' && canAct ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onStart}
              >
                <CirclePlay aria-hidden="true" /> Commencer
              </Button>
            ) : null}
            {(task.status === 'OPEN' || task.status === 'IN_PROGRESS') &&
            canAct ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={onComplete}
                className="bg-[#087f72] hover:bg-[#076d63]"
              >
                <Check aria-hidden="true" /> Fait
              </Button>
            ) : null}
            {(task.status === 'OPEN' || task.status === 'IN_PROGRESS') &&
            canManage ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onCancel}
              >
                Annuler
              </Button>
            ) : null}
            {(task.status === 'DONE' || task.status === 'CANCELLED') &&
            canManage &&
            onReopen ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onReopen}
              >
                <RotateCcw aria-hidden="true" /> Rouvrir
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyTasks() {
  return (
    <Card className="border-dashed bg-muted/20">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
          <Check aria-hidden="true" />
        </span>
        <h2 className="font-semibold">Rien à faire pour le moment</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Ajoutez une tâche datée ou une corvée que chacun pourra prendre en
          charge.
        </p>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  required = true,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; required?: boolean }) {
  const name = String(props.name);
  return (
    <div className="space-y-2">
      <Label htmlFor={`task-${name}`}>{label}</Label>
      <Input
        id={`task-${name}`}
        required={required}
        className="h-11 rounded-xl"
        {...props}
      />
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatPeriod(start: string, end: string | null) {
  return end
    ? `Du ${formatDate(start)} au ${formatDate(end)}`
    : `À partir du ${formatDate(start)}`;
}

async function taskError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (payload.error === 'TASK_ACTION_FORBIDDEN')
    return 'Vous ne pouvez pas modifier cette tâche.';
  if (payload.error === 'PRIVATE_TASK_ASSIGNEE_INVALID')
    return 'Une tâche privée ne peut être attribuée qu’à vous.';
  if (payload.error === 'ASSIGNEE_INVALID')
    return 'Le responsable sélectionné n’est plus disponible.';
  if (payload.error === 'TASK_ALREADY_DONE')
    return 'Cette tâche est déjà terminée.';
  if (payload.error === 'TASK_STATE_INVALID')
    return 'Cette action ne correspond plus à l’état de la tâche.';
  if (payload.error === 'INVALID_REQUEST')
    return 'Vérifiez les informations de la tâche.';
  return fallback;
}
