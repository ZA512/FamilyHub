import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { localeTag, t } from '@/lib/i18n';
import {
  CalendarClock,
  ChartNoAxesColumn,
  Check,
  CirclePlay,
  CloudOff,
  History,
  LoaderCircle,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  UserRound,
  Users,
} from 'lucide-react';

import type {
  FamilyMember,
  FamilyGroup,
  FamilyTask,
  TaskActivityEntry,
  TaskKind,
  TaskReopenPolicy,
  TaskStatistics,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  applyOptimisticTaskCompletion,
  applyOptimisticTaskReopen,
  applyOptimisticTaskStatus,
  createOptimisticTask,
  discardTaskConflicts,
  enqueueTaskCompletion,
  enqueueTaskCreate,
  enqueueTaskReopen,
  enqueueTaskStatus,
  readTaskCache,
  synchronizeTaskMutations,
  taskMutationCounts,
  writeTaskCache,
  type TaskCreatePayload,
} from '@/lib/offline-storage';

type TasksViewProps = {
  currentMemberId: string;
  currentMemberName: string;
  instanceId: string;
  role: 'ADMIN' | 'MEMBER';
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

const kindLabels: Record<TaskKind, string> = {
  SCHEDULED: 'Tâche',
  OPEN_CHORE: 'Routine',
  SEASONAL: 'Tâche',
};

type TaskFormMode = 'TASK' | 'ROUTINE';
type TaskDateMode = 'NONE' | 'DUE' | 'PERIOD';

export function TasksView({
  currentMemberId,
  currentMemberName,
  instanceId,
  role,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: TasksViewProps) {
  const sessionKey = `${instanceId}:${currentMemberId}`;
  const currentMember = useMemo(
    () => ({ id: currentMemberId, firstName: currentMemberName }),
    [currentMemberId, currentMemberName],
  );
  const [tasks, setTasks] = useState<FamilyTask[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [activity, setActivity] = useState<TaskActivityEntry[]>([]);
  const [statistics, setStatistics] = useState<TaskStatistics | null>(null);
  const [statsDays, setStatsDays] = useState('30');
  const [visibleMemberIds, setVisibleMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [serverAvailable, setServerAvailable] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const synchronization = useRef<Promise<void> | null>(null);
  const visibleMemberSelectionInitialized = useRef(false);
  const [formMode, setFormMode] = useState<TaskFormMode>('ROUTINE');
  const [dateMode, setDateMode] = useState<TaskDateMode>('NONE');
  const [recipient, setRecipient] = useState('household');
  const [reopenPolicy, setReopenPolicy] =
    useState<TaskReopenPolicy>('IMMEDIATE');
  const [taskToComplete, setTaskToComplete] = useState<FamilyTask | null>(null);

  const refreshCounts = useCallback(async () => {
    const counts = await taskMutationCounts(sessionKey);
    setPendingCount(counts.pending);
    setConflictCount(counts.conflicts);
  }, [sessionKey]);

  const synchronize = useCallback(() => {
    if (synchronization.current) return synchronization.current;
    if (!navigator.onLine || !csrfToken) return Promise.resolve();
    const operation = (async () => {
      setSyncing(true);
      try {
        const result = await synchronizeTaskMutations({
          sessionKey,
          csrfToken,
        });
        setPendingCount(result.pending);
        setConflictCount(result.conflicts);
        if (result.authenticationRequired) {
          setError(
            'Votre session doit être renouvelée avant la synchronisation.',
          );
          return;
        }
        const [
          tasksResponse,
          membersResponse,
          groupsResponse,
          activityResponse,
          statisticsResponse,
        ] = await Promise.all([
          fetch('/api/v1/tasks'),
          fetch('/api/v1/members'),
          fetch('/api/v1/groups'),
          fetch('/api/v1/tasks/activity?limit=100'),
          fetch(taskStatisticsUrl(Number(statsDays))),
        ]);
        if (!tasksResponse.ok)
          throw new Error('Impossible de charger les tâches.');
        if (!membersResponse.ok)
          throw new Error('Impossible de charger les membres.');
        if (!groupsResponse.ok)
          throw new Error('Impossible de charger les groupes.');
        if (!activityResponse.ok || !statisticsResponse.ok)
          throw new Error('Impossible de charger l’activité des tâches.');
        const [
          tasksPayload,
          membersPayload,
          groupsPayload,
          activityPayload,
          statisticsPayload,
        ] = await Promise.all([
          tasksResponse.json() as Promise<{ tasks: FamilyTask[] }>,
          membersResponse.json() as Promise<{ members: FamilyMember[] }>,
          groupsResponse.json() as Promise<{ groups: FamilyGroup[] }>,
          activityResponse.json() as Promise<{ activity: TaskActivityEntry[] }>,
          statisticsResponse.json() as Promise<{ statistics: TaskStatistics }>,
        ]);
        const activeMembers = membersPayload.members.filter(
          (member) => member.status === 'ACTIVE',
        );
        setTasks(tasksPayload.tasks);
        setMembers(activeMembers);
        setGroups(groupsPayload.groups);
        setActivity(activityPayload.activity ?? []);
        setStatistics(statisticsPayload.statistics ?? null);
        if (!visibleMemberSelectionInitialized.current) {
          setVisibleMemberIds(activeMembers.map((member) => member.id));
          visibleMemberSelectionInitialized.current = true;
        }
        await writeTaskCache(
          sessionKey,
          tasksPayload.tasks,
          activeMembers,
          groupsPayload.groups,
        );
        setServerAvailable(true);
        setError('');
      } catch {
        setServerAvailable(false);
        const cached = await readTaskCache(sessionKey);
        if (cached) {
          setTasks(cached.tasks);
          setMembers(cached.members);
          setGroups(cached.groups);
        } else {
          setError(
            'Le serveur est indisponible et aucune tâche locale n’est encore enregistrée.',
          );
        }
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    })().finally(() => {
      synchronization.current = null;
    });
    synchronization.current = operation;
    return operation;
  }, [csrfToken, sessionKey, statsDays]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const cached = await readTaskCache(sessionKey).catch(() => null);
      if (!active) return;
      if (cached) {
        setTasks(cached.tasks);
        setMembers(cached.members);
        setGroups(cached.groups);
        if (!visibleMemberSelectionInitialized.current) {
          setVisibleMemberIds(cached.members.map((member) => member.id));
          visibleMemberSelectionInitialized.current = true;
        }
      }
      await refreshCounts();
      if (!active) return;
      if (navigator.onLine && csrfToken) {
        await synchronize();
      } else {
        setLoading(false);
        if (!cached)
          setError('Aucune tâche n’est encore disponible hors connexion.');
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [csrfToken, refreshCounts, sessionKey, synchronize]);

  useEffect(() => {
    function handleOffline() {
      setOnline(false);
      setServerAvailable(false);
    }
    function handleOnline() {
      setOnline(true);
      void synchronize();
    }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [synchronize]);

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
  const personalTasks = useMemo(
    () => openTasks.filter((task) => task.visibility === 'PRIVATE'),
    [openTasks],
  );
  const sharedTasksForMe = useMemo(
    () =>
      openTasks.filter(
        (task) =>
          task.visibility !== 'PRIVATE' &&
          (task.assigneeId === currentMemberId ||
            task.actionable ||
            taskActionableFromCache(task, currentMemberId, members)),
      ),
    [currentMemberId, members, openTasks],
  );
  const householdTasks = useMemo(
    () => openTasks.filter((task) => task.visibility !== 'PRIVATE'),
    [openTasks],
  );
  const statisticRows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of statistics?.entries ?? []) {
      totals.set(
        entry.memberId,
        (totals.get(entry.memberId) ?? 0) + entry.count,
      );
    }
    return members
      .filter((member) => visibleMemberIds.includes(member.id))
      .map((member) => ({
        member,
        total: totals.get(member.id) ?? 0,
      }))
      .sort((left, right) => right.total - left.total);
  }, [members, statistics, visibleMemberIds]);
  const maximumStatistic = Math.max(
    1,
    ...statisticRows.map((row) => row.total),
  );
  const statisticTasks = useMemo(() => {
    const tasksById = new Map<string, string>();
    for (const entry of statistics?.entries ?? []) {
      if (visibleMemberIds.includes(entry.memberId)) {
        tasksById.set(entry.taskId, entry.taskTitle);
      }
    }
    return [...tasksById].sort((left, right) =>
      left[1].localeCompare(right[1]),
    );
  }, [statistics, visibleMemberIds]);
  const statisticCounts = useMemo(
    () =>
      new Map(
        (statistics?.entries ?? []).map((entry) => [
          `${entry.memberId}:${entry.taskId}`,
          entry.count,
        ]),
      ),
    [statistics],
  );

  function resetComposer() {
    setFormMode('ROUTINE');
    setDateMode('NONE');
    setRecipient('household');
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
    const recipientMemberId = recipient.startsWith('member:')
      ? recipient.slice('member:'.length)
      : null;
    const recipientGroupId = recipient.startsWith('group:')
      ? recipient.slice('group:'.length)
      : null;
    const effectiveAssignee =
      recipient === 'self' ? currentMemberId : recipientMemberId;
    const visibility =
      recipient === 'self'
        ? 'PRIVATE'
        : recipientMemberId
          ? 'SELECTED_USERS'
          : recipientGroupId
            ? 'GROUPS'
            : 'ALL_MEMBERS';
    const kind: TaskKind =
      formMode === 'ROUTINE'
        ? 'OPEN_CHORE'
        : dateMode === 'PERIOD'
          ? 'SEASONAL'
          : 'SCHEDULED';
    const clientMutationId = crypto.randomUUID();
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const payload = {
      title: text('title'),
      description: text('description') || null,
      kind,
      assigneeId: effectiveAssignee,
      claimable: recipient === 'household' || Boolean(recipientGroupId),
      dueAt: formMode === 'TASK' && dateMode === 'DUE' ? toIso('dueAt') : null,
      periodStartAt:
        formMode === 'TASK' && dateMode === 'PERIOD'
          ? toIso('periodStartAt')
          : null,
      periodEndAt:
        formMode === 'TASK' && dateMode === 'PERIOD'
          ? toIso('periodEndAt')
          : null,
      recurrenceIntervalDays:
        formMode === 'TASK' && dateMode !== 'NONE'
          ? numberOrNull('recurrenceIntervalDays')
          : null,
      frequencyHint:
        formMode === 'ROUTINE' ? text('frequencyHint') || null : null,
      reopenPolicy: formMode === 'ROUTINE' ? reopenPolicy : 'NONE',
      reopenDelayHours:
        formMode === 'ROUTINE' && reopenPolicy === 'AFTER_DELAY'
          ? numberOrNull('reopenDelayHours')
          : null,
      visibility,
      groupIds: recipientGroupId ? [recipientGroupId] : [],
      userIds: recipientMemberId ? [recipientMemberId] : [],
      clientMutationId,
    } satisfies TaskCreatePayload;
    const optimistic = createOptimisticTask(payload, currentMember, members);

    try {
      let response: Response | null = null;
      if (navigator.onLine && csrfToken && pendingCount === 0) {
        try {
          response = await fetch('/api/v1/tasks', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify(payload),
          });
        } catch {
          setServerAvailable(false);
        }
      }
      if (!response || response.status === 429 || response.status >= 500) {
        await enqueueTaskCreate(sessionKey, optimistic, payload);
        setTasks((current) => [optimistic, ...current]);
        await refreshCounts();
      } else if (!response.ok) {
        throw new Error(await taskError(response, 'Création impossible.'));
      } else {
        const result = (await response.json()) as { task: FamilyTask };
        const next = [result.task, ...tasks];
        setTasks(next);
        await writeTaskCache(sessionKey, next, members, groups);
        setServerAvailable(true);
      }
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
    const previous = tasks;
    const optimistic = applyOptimisticTaskStatus(task, status, currentMember);
    const optimisticTasks = tasks.map((candidate) =>
      candidate.id === task.id ? optimistic : candidate,
    );
    setTasks(optimisticTasks);
    await writeTaskCache(sessionKey, optimisticTasks, members, groups);
    try {
      let response: Response | null = null;
      if (navigator.onLine && csrfToken && pendingCount === 0) {
        try {
          response = await fetch(`/api/v1/tasks/${task.id}`, {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify({ status }),
          });
        } catch {
          setServerAvailable(false);
        }
      }
      if (!response || response.status === 429 || response.status >= 500) {
        await enqueueTaskStatus(sessionKey, optimistic, status);
        await refreshCounts();
      } else if (!response.ok) {
        setTasks(previous);
        await writeTaskCache(sessionKey, previous, members, groups);
        throw new Error(await taskError(response, 'Modification impossible.'));
      } else {
        const payload = (await response.json()) as { task: FamilyTask };
        replaceTask(payload.task);
        setServerAvailable(true);
      }
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
    const comment = data.get('comment');
    const completion = {
      comment: typeof comment === 'string' ? comment.trim() || null : null,
      clientMutationId: crypto.randomUUID(),
    };
    const previous = tasks;
    const optimistic = applyOptimisticTaskCompletion(
      taskToComplete,
      completion,
      currentMember,
    );
    const optimisticTasks = tasks.map((candidate) =>
      candidate.id === taskToComplete.id ? optimistic : candidate,
    );
    setTasks(optimisticTasks);
    await writeTaskCache(sessionKey, optimisticTasks, members, groups);
    try {
      let response: Response | null = null;
      if (navigator.onLine && csrfToken && pendingCount === 0) {
        try {
          response = await fetch(
            `/api/v1/tasks/${taskToComplete.id}/complete`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-csrf-token': csrfToken,
              },
              body: JSON.stringify(completion),
            },
          );
        } catch {
          setServerAvailable(false);
        }
      }
      if (!response || response.status === 429 || response.status >= 500) {
        await enqueueTaskCompletion(sessionKey, optimistic, completion);
        await refreshCounts();
      } else if (!response.ok) {
        setTasks(previous);
        await writeTaskCache(sessionKey, previous, members, groups);
        throw new Error(await taskError(response, 'Validation impossible.'));
      } else {
        const payload = (await response.json()) as { task: FamilyTask };
        replaceTask(payload.task);
        setServerAvailable(true);
      }
      setTaskToComplete(null);
      if (response?.ok) void synchronize();
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
    const previous = tasks;
    const optimistic = applyOptimisticTaskReopen(task);
    const optimisticTasks = tasks.map((candidate) =>
      candidate.id === task.id ? optimistic : candidate,
    );
    setTasks(optimisticTasks);
    await writeTaskCache(sessionKey, optimisticTasks, members, groups);
    try {
      let response: Response | null = null;
      if (navigator.onLine && csrfToken && pendingCount === 0) {
        try {
          response = await fetch(`/api/v1/tasks/${task.id}/reopen`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: '{}',
          });
        } catch {
          setServerAvailable(false);
        }
      }
      if (!response || response.status === 429 || response.status >= 500) {
        await enqueueTaskReopen(sessionKey, optimistic);
        await refreshCounts();
      } else if (!response.ok) {
        setTasks(previous);
        await writeTaskCache(sessionKey, previous, members, groups);
        throw new Error(await taskError(response, 'Réouverture impossible.'));
      } else {
        const payload = (await response.json()) as { task: FamilyTask };
        replaceTask(payload.task);
        setServerAvailable(true);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Réouverture impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  function replaceTask(task: FamilyTask) {
    setTasks((current) => {
      const next = current.map((candidate) =>
        candidate.id === task.id ? task : candidate,
      );
      void writeTaskCache(sessionKey, next, members, groups);
      return next;
    });
  }

  async function acceptServerVersion() {
    await discardTaskConflicts(sessionKey);
    await synchronize();
  }

  const connectionProblem = !online || !serverAvailable;

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
              Créez une tâche à terminer ou une routine disponible dans la
              durée.
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
              <Label>Nature</Label>
              <Select
                value={formMode}
                onValueChange={(value) => {
                  const mode = value as TaskFormMode;
                  setFormMode(mode);
                  setRecipient(mode === 'ROUTINE' ? 'household' : 'self');
                  if (mode === 'ROUTINE') setDateMode('NONE');
                }}
              >
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TASK">Tâche — à terminer</SelectItem>
                  <SelectItem value="ROUTINE">
                    Routine — disponible indéfiniment
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Pour qui ?</Label>
              <Select
                value={recipient}
                onValueChange={(value) => setRecipient(value ?? 'self')}
              >
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="household">Tout le foyer</SelectItem>
                  <SelectItem value="self">Moi</SelectItem>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Personnes</SelectLabel>
                    {members
                      .filter((member) => member.id !== currentMemberId)
                      .map((member) => (
                        <SelectItem
                          key={member.id}
                          value={`member:${member.id}`}
                        >
                          <UserRound aria-hidden="true" /> {member.firstName}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                  {groups.some((group) => !group.isSystem) ? (
                    <SelectSeparator />
                  ) : null}
                  {groups.some((group) => !group.isSystem) ? (
                    <SelectGroup>
                      <SelectLabel>Groupes</SelectLabel>
                      {groups
                        .filter((group) => !group.isSystem)
                        .map((group) => (
                          <SelectItem
                            key={group.id}
                            value={`group:${group.id}`}
                          >
                            <Users aria-hidden="true" /> {group.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Un groupe ou le foyer laisse chacun de ses membres s’en charger.
              </p>
            </div>

            {formMode === 'TASK' ? (
              <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
                <div className="space-y-2">
                  <Label>Quand ?</Label>
                  <Select
                    value={dateMode}
                    onValueChange={(value) =>
                      setDateMode(value as TaskDateMode)
                    }
                  >
                    <SelectTrigger className="h-11 w-full rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Sans date</SelectItem>
                      <SelectItem value="DUE">À une date</SelectItem>
                      <SelectItem value="PERIOD">
                        Pendant une période
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {dateMode === 'DUE' ? (
                  <Field
                    label="Échéance"
                    name="dueAt"
                    type="datetime-local"
                    required
                  />
                ) : null}
                {dateMode === 'PERIOD' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Début de période"
                      name="periodStartAt"
                      type="datetime-local"
                      required
                    />
                    <Field
                      label="Fin de période"
                      name="periodEndAt"
                      type="datetime-local"
                      required={false}
                    />
                  </div>
                ) : null}
                {dateMode !== 'NONE' ? (
                  <Field
                    label="Répéter tous les… jours"
                    name="recurrenceIntervalDays"
                    type="number"
                    min={1}
                    max={365}
                    placeholder="7"
                    required={false}
                  />
                ) : null}
              </div>
            ) : null}

            {formMode === 'ROUTINE' ? (
              <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
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
                        Toujours disponible
                      </SelectItem>
                      <SelectItem value="AFTER_DELAY">
                        Disponible de nouveau après un délai
                      </SelectItem>
                      <SelectItem value="MANUAL">
                        Réactivation manuelle
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
              disabled={submitting}
              className="w-full bg-[#087f72] hover:bg-[#076d63]"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              {connectionProblem ? 'Créer hors connexion' : 'Créer la tâche'}
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
              Tâches et routines
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

        {connectionProblem || pendingCount || conflictCount || syncing ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {syncing ? (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            ) : connectionProblem ? (
              <CloudOff className="size-4" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1">
              {syncing
                ? 'Synchronisation des tâches…'
                : conflictCount
                  ? `${conflictCount} tâche${conflictCount > 1 ? 's' : ''} à résoudre.`
                  : pendingCount
                    ? `${pendingCount} action${pendingCount > 1 ? 's' : ''} sera synchronisée à la reconnexion.`
                    : 'Tâches affichées depuis cet appareil. Vous pouvez continuer à agir.'}
            </p>
            {conflictCount ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void acceptServerVersion()}
              >
                Utiliser la version du serveur
              </Button>
            ) : online &&
              csrfToken &&
              !syncing &&
              (pendingCount || !serverAvailable) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void synchronize()}
              >
                {pendingCount ? 'Synchroniser' : 'Réessayer'}
              </Button>
            ) : null}
          </div>
        ) : null}

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
          <Tabs defaultValue="mine">
            <TabsList className="mb-4 h-auto w-full flex-wrap rounded-xl sm:w-auto">
              <TabsTrigger value="mine" className="px-3 sm:px-4">
                À faire ({personalTasks.length + sharedTasksForMe.length})
              </TabsTrigger>
              <TabsTrigger value="household" className="px-3 sm:px-4">
                Foyer ({householdTasks.length})
              </TabsTrigger>
              <TabsTrigger value="activity" className="px-3 sm:px-4">
                Activité
              </TabsTrigger>
              <TabsTrigger value="statistics" className="px-3 sm:px-4">
                Statistiques
              </TabsTrigger>
            </TabsList>
            <TabsContent value="mine" className="space-y-6">
              {personalTasks.length ? (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                    Mes tâches personnelles
                  </h2>
                  <div className="grid gap-3">
                    {personalTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        members={members}
                        groups={groups}
                        currentMemberId={currentMemberId}
                        role={role}
                        busy={busyId === task.id}
                        onStart={() => updateStatus(task, 'IN_PROGRESS')}
                        onComplete={() => setTaskToComplete(task)}
                        onCancel={() => updateStatus(task, 'CANCELLED')}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {sharedTasksForMe.length ? (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                    Pour moi et mes groupes
                  </h2>
                  <div className="grid gap-3">
                    {sharedTasksForMe.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        members={members}
                        groups={groups}
                        currentMemberId={currentMemberId}
                        role={role}
                        busy={busyId === task.id}
                        onStart={() => updateStatus(task, 'IN_PROGRESS')}
                        onComplete={() => setTaskToComplete(task)}
                        onCancel={() => updateStatus(task, 'CANCELLED')}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {!personalTasks.length && !sharedTasksForMe.length ? (
                <EmptyTasks />
              ) : null}
            </TabsContent>
            <TabsContent value="household">
              {householdTasks.length ? (
                <div className="grid gap-3">
                  {householdTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      members={members}
                      groups={groups}
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
            <TabsContent value="activity" className="space-y-6">
              {activity.length ? (
                <Card className="py-2">
                  <CardContent className="divide-y px-4 sm:px-5">
                    {activity.map((entry) => (
                      <div key={entry.id} className="flex gap-3 py-3">
                        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[#e7f5f2] text-[#087f72]">
                          <Check className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm">
                            <strong>{entry.completedByName}</strong> a réalisé{' '}
                            <strong>{entry.taskTitle}</strong>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(entry.completedAt)}
                            {entry.comment ? ` · ${entry.comment}` : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-dashed bg-muted/20">
                  <CardContent className="py-10 text-center text-muted-foreground">
                    L’activité se remplira après les premières réalisations.
                  </CardContent>
                </Card>
              )}
              {closedTasks.length ? (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                    Terminées ou archivées
                  </h2>
                  <div className="grid gap-3">
                    {closedTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        members={members}
                        groups={groups}
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
                </div>
              ) : null}
            </TabsContent>
            <TabsContent value="statistics" className="space-y-4">
              <Card>
                <CardContent className="space-y-5 px-4 py-5 sm:px-5">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <h2 className="flex items-center gap-2 font-semibold">
                        <ChartNoAxesColumn
                          className="size-5 text-[#087f72]"
                          aria-hidden="true"
                        />
                        Participation aux routines
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Nombre de réalisations enregistrées, sans points ni
                        classement.
                      </p>
                    </div>
                    <div className="w-40 space-y-2">
                      <Label>Période</Label>
                      <Select
                        value={statsDays}
                        onValueChange={(value) => setStatsDays(value ?? '30')}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="7">7 jours</SelectItem>
                          <SelectItem value="30">30 jours</SelectItem>
                          <SelectItem value="90">3 mois</SelectItem>
                          <SelectItem value="365">1 an</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-medium">
                      Personnes affichées
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {members.map((member) => {
                        const checked = visibleMemberIds.includes(member.id);
                        return (
                          <Label
                            key={member.id}
                            className="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(next) =>
                                setVisibleMemberIds((current) =>
                                  next
                                    ? [...new Set([...current, member.id])]
                                    : current.filter((id) => id !== member.id),
                                )
                              }
                            />
                            {member.firstName}
                          </Label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-4">
                    {statisticRows.map(({ member, total }) => (
                      <div key={member.id}>
                        <div className="mb-1.5 flex justify-between text-sm">
                          <span>{member.firstName}</span>
                          <strong>{total}</strong>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-[#087f72] transition-[width]"
                            style={{
                              width: `${(total / maximumStatistic) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {!statisticRows.length ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        Sélectionnez au moins une personne.
                      </p>
                    ) : null}
                  </div>
                  {statisticTasks.length ? (
                    <div>
                      <h3 className="mb-2 text-sm font-medium">
                        Détail par routine
                      </h3>
                      <div className="overflow-x-auto rounded-xl border">
                        <table className="w-full min-w-md text-sm">
                          <thead className="bg-muted/60 text-left">
                            <tr>
                              <th className="px-3 py-2 font-medium">Routine</th>
                              {statisticRows.map(({ member }) => (
                                <th
                                  key={member.id}
                                  className="px-3 py-2 text-center font-medium"
                                >
                                  {member.firstName}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {statisticTasks.map(([taskId, title]) => (
                              <tr key={taskId}>
                                <td className="px-3 py-2">{title}</td>
                                {statisticRows.map(({ member }) => (
                                  <td
                                    key={member.id}
                                    className="px-3 py-2 text-center tabular-nums"
                                  >
                                    {statisticCounts.get(
                                      `${member.id}:${taskId}`,
                                    ) ?? 0}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </section>
    </>
  );
}

function TaskCard({
  task,
  members,
  groups,
  currentMemberId,
  role,
  busy,
  onStart,
  onComplete,
  onCancel,
  onReopen,
}: {
  task: FamilyTask;
  members: FamilyMember[];
  groups: FamilyGroup[];
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
    task.actionable ||
    taskActionableFromCache(task, currentMemberId, members);
  const canManage = role === 'ADMIN' || task.createdBy === currentMemberId;
  const latestCompletion = task.completions[0];
  const audience = taskAudience(task, members, groups);

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
                <Badge variant="destructive">
                  {task.kind === 'OPEN_CHORE' ? 'Archivée' : 'Annulée'}
                </Badge>
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
                <span>
                  <Users className="mr-1 inline size-4" aria-hidden="true" />
                  {t(audience)}
                </span>
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
                {task.kind === 'OPEN_CHORE' ? 'Archiver' : 'Annuler'}
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
          Ajoutez une tâche personnelle ou une routine que chacun pourra prendre
          en charge.
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
  return new Intl.DateTimeFormat(localeTag(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatPeriod(start: string, end: string | null) {
  return end
    ? `Du ${formatDate(start)} au ${formatDate(end)}`
    : `À partir du ${formatDate(start)}`;
}

function taskAudience(
  task: FamilyTask,
  members: FamilyMember[],
  groups: FamilyGroup[],
) {
  if (task.visibility === 'PRIVATE') return 'Moi uniquement';
  if (task.visibility === 'ALL_MEMBERS') return 'Tout le foyer';
  if (task.visibility === 'GROUPS') {
    return (
      (task.groupIds ?? [])
        .map((id) => groups.find((group) => group.id === id)?.name)
        .filter(Boolean)
        .join(', ') || 'Groupe'
    );
  }
  return (
    (task.userIds ?? [])
      .map((id) => members.find((member) => member.id === id)?.firstName)
      .filter(Boolean)
      .join(', ') || 'Personnes sélectionnées'
  );
}

function taskActionableFromCache(
  task: FamilyTask,
  memberId: string,
  members: FamilyMember[],
) {
  if (task.assigneeId === memberId) return true;
  if (!task.claimable) return !task.assigneeId && task.createdBy === memberId;
  if (task.visibility === 'ALL_MEMBERS') return true;
  if (task.visibility === 'SELECTED_USERS') {
    return (task.userIds ?? []).includes(memberId);
  }
  if (task.visibility === 'GROUPS') {
    const membership =
      members.find((member) => member.id === memberId)?.groupIds ?? [];
    return (task.groupIds ?? []).some((id) => membership.includes(id));
  }
  return false;
}

function taskStatisticsUrl(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return `/api/v1/tasks/statistics?${query.toString()}`;
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
  if (payload.error === 'GROUP_INVALID')
    return 'Le groupe sélectionné n’est plus disponible.';
  if (payload.error === 'RECIPIENT_INVALID')
    return 'La personne sélectionnée n’est plus disponible.';
  if (payload.error === 'TASK_ALREADY_DONE')
    return 'Cette tâche est déjà terminée.';
  if (payload.error === 'TASK_STATE_INVALID')
    return 'Cette action ne correspond plus à l’état de la tâche.';
  if (payload.error === 'INVALID_REQUEST')
    return 'Vérifiez les informations de la tâche.';
  return fallback;
}
