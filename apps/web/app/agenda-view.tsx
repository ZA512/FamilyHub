import 'temporal-polyfill/global';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/forma/theme.css';
import '@fullcalendar/react/themes/forma/palettes/green.css';

import FullCalendar, {
  type CalendarRef,
  type DateClickInfo,
  type EventClickInfo,
  type EventInput,
  type EventSourceFuncInfo,
} from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import listPlugin from '@fullcalendar/react/list';
import frLocale from '@fullcalendar/react/locales/fr';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import formaTheme from '@fullcalendar/react/themes/forma';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  CalendarDays,
  CheckSquare2,
  Clock,
  LoaderCircle,
  Lock,
  MapPin,
  Plus,
  Repeat2,
  Trash2,
  Users,
} from 'lucide-react';

import type {
  AgendaEntry,
  AgendaEventType,
  AgendaRecurrence,
  AgendaResponse,
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
import { Textarea } from '@/components/ui/textarea';

type AgendaViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
  onOpenTasks: () => void;
};

type ComposerState = {
  entry: AgendaEntry | null;
  initialStart: string | null;
  initialAllDay: boolean;
};

const eventTypeLabels: Record<AgendaEventType | 'TASK', string> = {
  EVENT: 'Événement',
  APPOINTMENT: 'Rendez-vous',
  BIRTHDAY: 'Anniversaire',
  REMINDER: 'Rappel',
  TASK: 'Tâche',
};

const responseLabels: Record<AgendaResponse, string> = {
  YES: 'Oui',
  NO: 'Non',
  MAYBE: 'Peut-être',
  PENDING: 'Pas encore répondu',
};

export function AgendaView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
  onOpenTasks,
}: AgendaViewProps) {
  const calendarRef = useRef<CalendarRef>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [selected, setSelected] = useState<AgendaEntry | null>(null);
  const [composer, setComposer] = useState<ComposerState>({
    entry: null,
    initialStart: null,
    initialAllDay: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const initialView = window.matchMedia('(max-width: 639px)').matches
    ? 'listMonth'
    : 'dayGridMonth';

  function openComposer(
    initial?: { start: string; allDay: boolean },
    entry?: AgendaEntry,
  ) {
    setComposer({
      entry: entry ?? null,
      initialStart: initial?.start ?? null,
      initialAllDay: initial?.allDay ?? false,
    });
    setSelected(null);
    onComposerOpenChange(true);
  }

  async function loadEntries(
    info: EventSourceFuncInfo,
    success: (events: EventInput[]) => void,
    failure: (error: Error) => void,
  ) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/agenda?start=${encodeURIComponent(info.startStr)}&end=${encodeURIComponent(info.endStr)}`,
      );
      if (!response.ok) throw new Error('Impossible de charger l’agenda.');
      const payload = (await response.json()) as { entries: AgendaEntry[] };
      success(payload.entries.map(toCalendarEvent));
      setError('');
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : 'Agenda indisponible.';
      setError(message);
      failure(new Error(message));
    } finally {
      setLoading(false);
    }
  }

  function handleEventClick(info: EventClickInfo) {
    setSelected(info.event.extendedProps.entry as AgendaEntry);
  }

  function refresh() {
    calendarRef.current?.getApi().refetchEvents();
  }

  async function respond(responseValue: AgendaResponse) {
    if (!selected || selected.sourceType !== 'event') return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/agenda/events/${selected.resourceId}/response`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ response: responseValue }),
        },
      );
      if (!response.ok)
        throw new Error('Votre réponse n’a pas pu être enregistrée.');
      setSelected((current) =>
        current
          ? {
              ...current,
              participants: current.participants.map((participant) =>
                participant.memberId === currentMemberId
                  ? { ...participant, response: responseValue }
                  : participant,
              ),
            }
          : null,
      );
      refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Réponse impossible.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function deleteEvent() {
    if (!selected || selected.sourceType !== 'event') return;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/agenda/events/${selected.resourceId}`,
        {
          method: 'DELETE',
          headers: { 'x-csrf-token': csrfToken },
        },
      );
      if (!response.ok) throw new Error('Suppression impossible.');
      setDeleteOpen(false);
      setSelected(null);
      refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <EventComposer
        key={`${composer.entry?.id ?? 'new'}:${composer.initialStart ?? ''}:${composer.initialAllDay}`}
        open={composerOpen}
        state={composer}
        currentMemberId={currentMemberId}
        csrfToken={csrfToken}
        members={members}
        onMembersLoaded={setMembers}
        onOpenChange={onComposerOpenChange}
        onSaved={refresh}
        onError={setError}
      />

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="sm:max-w-lg">
          {selected ? (
            <EventDetails
              entry={selected}
              currentMemberId={currentMemberId}
              loading={loading}
              onRespond={respond}
              onEdit={() => openComposer(undefined, selected)}
              onDelete={() => setDeleteOpen(true)}
              onOpenTasks={onOpenTasks}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet événement ?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.recurrence !== 'NONE'
                ? 'Toute la série récurrente sera supprimée.'
                : 'Cette action retirera l’événement de l’agenda du foyer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Conserver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteEvent()}
              variant="destructive"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-medium text-[#087f72]">
              Temps partagé
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Agenda
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              Événements, rendez-vous et tâches planifiées au même endroit.
            </p>
          </div>
          <Button
            onClick={() => openComposer()}
            className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
          >
            <Plus aria-hidden="true" /> Ajouter un événement
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

        <div className="familyhub-calendar relative overflow-hidden rounded-2xl border bg-card p-2 shadow-sm sm:p-4">
          {loading ? (
            <span className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full bg-background shadow">
              <LoaderCircle
                className="size-4 animate-spin text-[#087f72]"
                aria-label="Chargement"
              />
            </span>
          ) : null}
          <FullCalendar
            ref={calendarRef}
            plugins={[
              formaTheme,
              dayGridPlugin,
              timeGridPlugin,
              listPlugin,
              interactionPlugin,
            ]}
            themeSystem="forma"
            locale={frLocale}
            initialView={initialView}
            headerToolbar={{
              start: 'prev,next today',
              center: 'title',
              end: 'dayGridMonth,timeGridWeek,listMonth',
            }}
            buttonText={{
              today: 'Aujourd’hui',
              month: 'Mois',
              week: 'Semaine',
              list: 'Liste',
            }}
            events={loadEntries}
            eventClick={handleEventClick}
            dateClick={(info: DateClickInfo) =>
              openComposer({ start: info.dateStr, allDay: info.allDay })
            }
            selectable
            selectMirror
            dayMaxEvents={3}
            nowIndicator
            firstDay={1}
            height="auto"
            contentHeight="auto"
            eventTimeFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }}
            slotLabelFormat={{
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }}
            noEventsText="Rien de prévu sur cette période"
          />
        </div>
      </section>
    </>
  );
}

function EventComposer({
  open,
  state,
  currentMemberId,
  csrfToken,
  members,
  onMembersLoaded,
  onOpenChange,
  onSaved,
  onError,
}: {
  open: boolean;
  state: ComposerState;
  currentMemberId: string;
  csrfToken: string;
  members: FamilyMember[];
  onMembersLoaded: (members: FamilyMember[]) => void;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const entry = state.entry;
  const [submitting, setSubmitting] = useState(false);
  const [allDay, setAllDay] = useState(entry?.allDay ?? state.initialAllDay);
  const [eventType, setEventType] = useState<AgendaEventType>(
    entry?.eventType !== 'TASK' ? (entry?.eventType ?? 'EVENT') : 'EVENT',
  );
  const [recurrence, setRecurrence] = useState<AgendaRecurrence>(
    entry?.recurrence ?? 'NONE',
  );
  const [visibility, setVisibility] = useState<'PRIVATE' | 'ALL_MEMBERS'>(
    entry?.visibility ?? 'ALL_MEMBERS',
  );
  const [reminderMinutes, setReminderMinutes] = useState(
    String(entry?.reminderMinutes ?? 'none'),
  );
  const [participantIds, setParticipantIds] = useState<Set<string>>(
    () =>
      new Set(
        entry?.participants.map((participant) => participant.memberId) ?? [
          currentMemberId,
        ],
      ),
  );

  useEffect(() => {
    if (!open || members.length) return;
    const controller = new AbortController();
    fetch('/api/v1/members', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return (await response.json()) as { members: FamilyMember[] };
      })
      .then((payload) =>
        onMembersLoaded(
          payload.members.filter((member) => member.status === 'ACTIVE'),
        ),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [members.length, onMembersLoaded, open]);

  function toggleParticipant(memberId: string, checked: boolean) {
    setParticipantIds((current) => {
      const next = new Set(current);
      if (checked) next.add(memberId);
      else next.delete(memberId);
      next.add(currentMemberId);
      return next;
    });
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    onError('');
    const data = new FormData(event.currentTarget);
    try {
      const dates = formDates(data, allDay);
      const recurrenceUntilValue = textEntry(data, 'recurrenceUntil');
      const payload = {
        title: data.get('title'),
        description: data.get('description'),
        eventType,
        ...dates,
        allDay,
        location: data.get('location'),
        participantIds:
          visibility === 'PRIVATE' ? [currentMemberId] : [...participantIds],
        recurrence,
        recurrenceInterval: Number(
          textEntry(data, 'recurrenceInterval') || '1',
        ),
        recurrenceUntil:
          recurrence !== 'NONE' && recurrenceUntilValue
            ? endOfDayIso(recurrenceUntilValue)
            : null,
        reminderMinutes:
          reminderMinutes === 'none' ? null : Number(reminderMinutes),
        visibility,
        ...(entry ? {} : { clientMutationId: crypto.randomUUID() }),
      };
      const response = await fetch(
        entry
          ? `/api/v1/agenda/events/${entry.resourceId}`
          : '/api/v1/agenda/events',
        {
          method: entry ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error(await agendaError(response));
      onOpenChange(false);
      onSaved();
    } catch (reason) {
      onError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const startValue = entry
    ? inputDate(entry.seriesStartAt, allDay)
    : state.initialStart
      ? inputDate(state.initialStart, allDay)
      : inputDate(new Date().toISOString(), allDay);
  const endValue = entry
    ? inputDate(entry.seriesEndAt ?? entry.seriesStartAt, allDay, allDay)
    : defaultEndValue(startValue, allDay);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {entry ? 'Modifier l’événement' : 'Nouvel événement'}
          </DialogTitle>
          <DialogDescription>
            {entry?.recurrence !== 'NONE'
              ? 'Les modifications s’appliqueront à toute la série.'
              : 'Ajoutez les informations utiles au foyer.'}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <FormField
            label="Titre"
            name="title"
            defaultValue={entry?.title}
            required
            maxLength={160}
            placeholder="Dîner chez les parents"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Type"
              value={eventType}
              onValueChange={(value) => setEventType(value as AgendaEventType)}
            >
              <SelectItem value="EVENT">Événement</SelectItem>
              <SelectItem value="APPOINTMENT">Rendez-vous</SelectItem>
              <SelectItem value="BIRTHDAY">Anniversaire</SelectItem>
              <SelectItem value="REMINDER">Rappel</SelectItem>
            </SelectField>
            <FormField
              label="Lieu"
              name="location"
              defaultValue={entry?.location ?? ''}
              required={false}
              maxLength={240}
              placeholder="Maison, école…"
            />
          </div>
          <Label
            htmlFor="agenda-all-day"
            className="flex items-center gap-3 rounded-xl border p-3"
          >
            <Checkbox
              id="agenda-all-day"
              checked={allDay}
              onCheckedChange={setAllDay}
            />
            Toute la journée
          </Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Début"
              name="startAt"
              type={allDay ? 'date' : 'datetime-local'}
              defaultValue={startValue}
              required
            />
            <FormField
              label={allDay ? 'Fin (incluse)' : 'Fin'}
              name="endAt"
              type={allDay ? 'date' : 'datetime-local'}
              defaultValue={endValue}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Répétition"
              value={recurrence}
              onValueChange={(value) =>
                setRecurrence(value as AgendaRecurrence)
              }
            >
              <SelectItem value="NONE">Aucune</SelectItem>
              <SelectItem value="DAILY">Tous les jours</SelectItem>
              <SelectItem value="WEEKLY">Toutes les semaines</SelectItem>
              <SelectItem value="MONTHLY">Tous les mois</SelectItem>
              <SelectItem value="YEARLY">Tous les ans</SelectItem>
            </SelectField>
            {recurrence !== 'NONE' ? (
              <>
                <FormField
                  label="Intervalle"
                  name="recurrenceInterval"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={entry?.recurrenceInterval ?? 1}
                  required
                />
                <FormField
                  label="Jusqu’au"
                  name="recurrenceUntil"
                  type="date"
                  defaultValue={entry?.recurrenceUntil?.slice(0, 10) ?? ''}
                  required={false}
                />
              </>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Rappel"
              value={reminderMinutes}
              onValueChange={(value) =>
                setReminderMinutes(typeof value === 'string' ? value : 'none')
              }
            >
              <SelectItem value="none">Aucun</SelectItem>
              <SelectItem value="0">À l’heure de l’événement</SelectItem>
              <SelectItem value="15">15 minutes avant</SelectItem>
              <SelectItem value="60">1 heure avant</SelectItem>
              <SelectItem value="1440">1 jour avant</SelectItem>
            </SelectField>
            <SelectField
              label="Visibilité"
              value={visibility}
              onValueChange={(value) =>
                setVisibility(value as 'PRIVATE' | 'ALL_MEMBERS')
              }
            >
              <SelectItem value="ALL_MEMBERS">Tout le foyer</SelectItem>
              <SelectItem value="PRIVATE">Moi uniquement</SelectItem>
            </SelectField>
          </div>
          {visibility === 'ALL_MEMBERS' ? (
            <fieldset className="space-y-3 rounded-xl border p-4">
              <legend className="px-1 text-sm font-medium">Participants</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {members.map((member) => (
                  <Label
                    key={member.id}
                    htmlFor={`participant-${member.id}`}
                    className="flex items-center gap-3"
                  >
                    <Checkbox
                      id={`participant-${member.id}`}
                      checked={participantIds.has(member.id)}
                      disabled={member.id === currentMemberId}
                      onCheckedChange={(checked) =>
                        toggleParticipant(member.id, checked)
                      }
                    />
                    {member.firstName}
                    {member.id === currentMemberId ? ' (vous)' : ''}
                  </Label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="agenda-description">Description</Label>
            <Textarea
              id="agenda-description"
              name="description"
              defaultValue={entry?.description ?? ''}
              maxLength={2000}
              placeholder="Informations utiles…"
            />
          </div>
          <Button
            type="submit"
            disabled={submitting || !csrfToken}
            className="w-full bg-[#087f72] hover:bg-[#076d63]"
          >
            {submitting ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <CalendarDays aria-hidden="true" />
            )}
            {entry ? 'Enregistrer les modifications' : 'Ajouter à l’agenda'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventDetails({
  entry,
  currentMemberId,
  loading,
  onRespond,
  onEdit,
  onDelete,
  onOpenTasks,
}: {
  entry: AgendaEntry;
  currentMemberId: string;
  loading: boolean;
  onRespond: (response: AgendaResponse) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenTasks: () => void;
}) {
  const myParticipation = entry.participants.find(
    (item) => item.memberId === currentMemberId,
  );
  return (
    <>
      <DialogHeader>
        <div className="mb-2 flex flex-wrap gap-2 pr-8">
          <Badge variant="secondary">{eventTypeLabels[entry.eventType]}</Badge>
          {entry.visibility === 'PRIVATE' ? (
            <Badge variant="outline">
              <Lock aria-hidden="true" /> Privé
            </Badge>
          ) : null}
          {entry.recurrence !== 'NONE' ? (
            <Badge variant="outline">
              <Repeat2 aria-hidden="true" /> Récurrent
            </Badge>
          ) : null}
        </div>
        <DialogTitle className="text-2xl">{entry.title}</DialogTitle>
        <DialogDescription>Créé par {entry.createdByName}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <p className="flex items-start gap-3 text-sm">
          <Clock
            className="mt-0.5 size-4 shrink-0 text-[#087f72]"
            aria-hidden="true"
          />
          <span>{formatEntryDate(entry)}</span>
        </p>
        {entry.location ? (
          <p className="flex items-start gap-3 text-sm">
            <MapPin
              className="mt-0.5 size-4 shrink-0 text-[#087f72]"
              aria-hidden="true"
            />
            {entry.location}
          </p>
        ) : null}
        {entry.description ? (
          <p className="rounded-xl bg-muted/55 p-3 text-sm">
            {entry.description}
          </p>
        ) : null}
        {entry.participants.length ? (
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Users className="size-4" aria-hidden="true" /> Participants
            </p>
            <div className="flex flex-wrap gap-2">
              {entry.participants.map((participant) => (
                <Badge key={participant.memberId} variant="outline">
                  {participant.memberName} ·{' '}
                  {responseLabels[participant.response]}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {myParticipation ? (
          <div className="rounded-xl border p-3">
            <p className="mb-2 text-sm font-medium">Votre réponse</p>
            <div className="flex flex-wrap gap-2">
              {(['YES', 'MAYBE', 'NO'] as const).map((response) => (
                <Button
                  key={response}
                  size="sm"
                  variant={
                    myParticipation.response === response
                      ? 'default'
                      : 'outline'
                  }
                  disabled={loading}
                  onClick={() => onRespond(response)}
                >
                  {responseLabels[response]}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {entry.sourceType === 'task' ? (
            <Button onClick={onOpenTasks}>
              <CheckSquare2 aria-hidden="true" /> Ouvrir les tâches
            </Button>
          ) : entry.editable ? (
            <>
              <Button variant="outline" onClick={onEdit}>
                Modifier
              </Button>
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={onDelete}
              >
                <Trash2 aria-hidden="true" /> Supprimer
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function SelectField({
  label,
  children,
  name,
  ...props
}: React.ComponentProps<typeof Select> & { label: string; name?: string }) {
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium leading-none">{label}</span>
      <Select name={name} {...props}>
        <SelectTrigger className="h-11 w-full rounded-xl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function FormField({
  label,
  required = true,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; required?: boolean }) {
  const name = String(props.name);
  return (
    <div className="space-y-2">
      <Label htmlFor={`agenda-${name}`}>{label}</Label>
      <Input
        id={`agenda-${name}`}
        required={required}
        className="h-11 rounded-xl"
        {...props}
      />
    </div>
  );
}

function toCalendarEvent(entry: AgendaEntry): EventInput {
  const colors =
    entry.sourceType === 'task'
      ? { backgroundColor: '#e49131', borderColor: '#c97618' }
      : entry.visibility === 'PRIVATE'
        ? { backgroundColor: '#5651a8', borderColor: '#45418e' }
        : { backgroundColor: '#087f72', borderColor: '#076d63' };
  return {
    id: entry.id,
    title: entry.sourceType === 'task' ? `✓ ${entry.title}` : entry.title,
    start: entry.startAt,
    end: entry.endAt ?? undefined,
    allDay: entry.allDay,
    editable: false,
    ...colors,
    extendedProps: { entry },
  };
}

function formDates(data: FormData, allDay: boolean) {
  const start = textEntry(data, 'startAt');
  const end = textEntry(data, 'endAt');
  if (!start || !end) throw new Error('Indiquez le début et la fin.');
  if (allDay) {
    return {
      startAt: new Date(`${start}T00:00:00`).toISOString(),
      endAt: nextDayIso(end),
    };
  }
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
  };
}

function textEntry(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

function nextDayIso(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function endOfDayIso(value: string) {
  return new Date(`${value}T23:59:59`).toISOString();
}

function inputDate(value: string, allDay: boolean, exclusiveEnd = false) {
  if (allDay && !exclusiveEnd && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  const date = new Date(value);
  if (exclusiveEnd) date.setDate(date.getDate() - 1);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, allDay ? 10 : 16);
}

function defaultEndValue(startValue: string, allDay: boolean) {
  if (allDay) return startValue.slice(0, 10);
  const date = new Date(startValue);
  date.setHours(date.getHours() + 1);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatEntryDate(entry: AgendaEntry) {
  const start = new Date(entry.startAt);
  const end = entry.endAt ? new Date(entry.endAt) : null;
  if (entry.allDay) {
    const inclusiveEnd = end
      ? new Date(end.getTime() - 24 * 60 * 60 * 1000)
      : null;
    const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' });
    return inclusiveEnd && inclusiveEnd.toDateString() !== start.toDateString()
      ? `Du ${day.format(start)} au ${day.format(inclusiveEnd)}`
      : day.format(start);
  }
  const dateTime = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
  return end
    ? `${dateTime.format(start)} – ${dateTime.format(end)}`
    : dateTime.format(start);
}

async function agendaError(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (payload.error === 'PRIVATE_EVENT_PARTICIPANTS_INVALID')
    return 'Un événement privé ne peut inviter que vous.';
  if (payload.error === 'PARTICIPANT_INVALID')
    return 'Un participant sélectionné n’est plus disponible.';
  if (payload.error === 'EVENT_ACTION_FORBIDDEN')
    return 'Vous ne pouvez pas modifier cet événement.';
  if (payload.error === 'INVALID_REQUEST')
    return 'Vérifiez les dates et les informations saisies.';
  return 'Enregistrement impossible.';
}
