import { useEffect, useState, type SyntheticEvent } from 'react';
import { localeTag } from '@/lib/i18n';
import { useDeviceViewMode } from '@/lib/device-view-mode';
import {
  ContactRound,
  Globe2,
  LayoutGrid,
  List,
  LoaderCircle,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';

import type {
  ContactVisibility,
  FamilyContact,
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
import { Button, buttonVariants } from '@/components/ui/button';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type ContactScope = 'all' | 'mine' | 'shared';

type ContactsViewProps = {
  currentMemberId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

const visibilityLabels: Record<ContactVisibility, string> = {
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

function displayName(contact: FamilyContact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
}

export function ContactsView({
  currentMemberId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: ContactsViewProps) {
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [scope, setScope] = useState<ContactScope>('all');
  const [viewMode, setViewMode] = useDeviceViewMode(
    currentMemberId,
    'contacts',
    'cards',
  );
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<FamilyContact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FamilyContact | null>(null);
  const [visibility, setVisibility] =
    useState<ContactVisibility>('ALL_MEMBERS');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/members', { signal: controller.signal }),
      fetch('/api/v1/groups', { signal: controller.signal }),
    ])
      .then(async ([membersResponse, groupsResponse]) => {
        if (!membersResponse.ok || !groupsResponse.ok) {
          throw new Error('Les options de partage sont indisponibles.');
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
      const params = new URLSearchParams({ scope, limit: '50' });
      if (query.trim()) params.set('q', query.trim());
      if (tag.trim()) params.set('tag', tag.trim());
      fetch(`/api/v1/contacts?${params}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error('Impossible de charger les contacts.');
          }
          return (await response.json()) as {
            contacts: FamilyContact[];
            hasMore: boolean;
          };
        })
        .then((payload) => {
          setContacts(payload.contacts);
          setHasMore(payload.hasMore);
          setError('');
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              reason instanceof Error
                ? reason.message
                : 'Contacts indisponibles.',
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

  function resetEditor() {
    setEditing(null);
    setVisibility('ALL_MEMBERS');
    setSelectedGroups([]);
    setSelectedMembers([]);
  }

  function openCreate() {
    resetEditor();
    setError('');
    onComposerOpenChange(true);
  }

  function openEdit(contact: FamilyContact) {
    setEditing(contact);
    setVisibility(contact.visibility);
    setSelectedGroups(contact.groupIds);
    setSelectedMembers(contact.memberIds);
    setError('');
    onComposerOpenChange(true);
  }

  function closeEditor() {
    if (submitting) return;
    resetEditor();
    onComposerOpenChange(false);
  }

  async function saveContact(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tagValue = data.get('tags');
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        editing ? `/api/v1/contacts/${editing.id}` : '/api/v1/contacts',
        {
          method: editing ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            firstName: data.get('firstName'),
            lastName: data.get('lastName'),
            phone: data.get('phone'),
            email: data.get('email'),
            address: data.get('address'),
            notes: data.get('notes'),
            tags:
              typeof tagValue === 'string'
                ? tagValue
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            visibility,
            groupIds: selectedGroups,
            memberIds: selectedMembers,
            ...(editing
              ? { version: editing.version }
              : { clientMutationId: crypto.randomUUID() }),
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (payload?.error === 'MEMBER_IS_INTERNAL_CONTACT') {
          throw new Error(
            'Cette adresse appartient déjà à un membre du foyer, disponible dans Membres.',
          );
        }
        if (payload?.error === 'VERSION_CONFLICT') {
          throw new Error(
            'Ce contact a été modifié ailleurs. Fermez puis rouvrez sa fiche.',
          );
        }
        throw new Error('Le contact n’a pas pu être enregistré.');
      }
      resetEditor();
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

  async function removeContact() {
    if (!deleteTarget) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/contacts/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('Le contact n’a pas pu être supprimé.');
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

  async function loadMoreContacts() {
    const last = contacts.at(-1);
    if (!last) return;
    setLoadingMore(true);
    setError('');
    try {
      const params = new URLSearchParams({
        scope,
        limit: '50',
        before: last.updatedAt,
        beforeId: last.id,
      });
      if (query.trim()) params.set('q', query.trim());
      if (tag.trim()) params.set('tag', tag.trim());
      const response = await fetch(`/api/v1/contacts?${params}`);
      if (!response.ok) throw new Error('Impossible de charger la suite.');
      const payload = (await response.json()) as {
        contacts: FamilyContact[];
        hasMore: boolean;
      };
      setContacts((current) => [...current, ...payload.contacts]);
      setHasMore(payload.hasMore);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Chargement impossible.',
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const availableTags = [
    ...new Set(contacts.flatMap((contact) => contact.tags)),
  ].sort((left, right) => left.localeCompare(right, localeTag()));

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-medium text-primary">
            Carnet partagé
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
            Contacts externes
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Professionnels, proches et services utiles — les membres du foyer
            restent dans Membres.
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="rounded-xl bg-primary hover:bg-primary/80"
        >
          <Plus /> Ajouter un contact
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

      <div className="mb-5 grid gap-3 lg:grid-cols-[auto_minmax(220px,1fr)_220px]">
        <Tabs
          value={scope}
          onValueChange={(value) => setScope(value as ContactScope)}
        >
          <TabsList>
            <TabsTrigger value="all">Tous</TabsTrigger>
            <TabsTrigger value="mine">Mes contacts</TabsTrigger>
            <TabsTrigger value="shared">Partagés</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nom, téléphone, e-mail, adresse…"
            className="pl-9"
            aria-label="Rechercher un contact"
          />
        </div>
        <Select
          value={tag || 'ALL'}
          onValueChange={(value) =>
            setTag(value === 'ALL' ? '' : (value ?? ''))
          }
        >
          <SelectTrigger aria-label="Filtrer par tag">
            <SelectValue placeholder="Tous les tags" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tous les tags</SelectItem>
            {availableTags.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="mb-4 flex justify-end gap-1">
        <legend className="sr-only">Affichage des contacts</legend>
        <Button
          type="button"
          size="sm"
          variant={viewMode === 'list' ? 'secondary' : 'ghost'}
          aria-pressed={viewMode === 'list'}
          onClick={() => setViewMode('list')}
        >
          <List aria-hidden="true" /> Liste
        </Button>
        <Button
          type="button"
          size="sm"
          variant={viewMode === 'cards' ? 'secondary' : 'ghost'}
          aria-pressed={viewMode === 'cards'}
          onClick={() => setViewMode('cards')}
        >
          <LayoutGrid aria-hidden="true" /> Cartes
        </Button>
      </fieldset>

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-10 text-muted-foreground">
            <LoaderCircle className="animate-spin" /> Chargement des contacts…
          </CardContent>
        </Card>
      ) : contacts.length ? (
        viewMode === 'list' ? (
          <ContactList
            contacts={contacts}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
            onTag={setTag}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onEdit={() => openEdit(contact)}
                onDelete={() => setDeleteTarget(contact)}
                onTag={setTag}
              />
            ))}
          </div>
        )
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
              <ContactRound />
            </span>
            <h2 className="font-semibold">Aucun contact externe</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Ajoutez par exemple un médecin, une école, un artisan ou un proche
              hors du foyer.
            </p>
            <Button onClick={openCreate} variant="outline" className="mt-5">
              <Plus /> Ajouter le premier
            </Button>
          </CardContent>
        </Card>
      )}
      {hasMore ? (
        <div className="mt-5 text-center">
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => void loadMoreContacts()}
          >
            {loadingMore ? <LoaderCircle className="animate-spin" /> : null}
            Afficher plus
          </Button>
        </div>
      ) : null}

      <ContactEditor
        key={editing?.id ?? `new-${composerOpen}`}
        open={composerOpen}
        contact={editing}
        visibility={visibility}
        members={members}
        groups={groups}
        selectedGroups={selectedGroups}
        selectedMembers={selectedMembers}
        submitting={submitting}
        error={error}
        onClose={closeEditor}
        onSave={saveContact}
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
            <AlertDialogTitle>Supprimer ce contact ?</AlertDialogTitle>
            <AlertDialogDescription>
              La fiche de{' '}
              {deleteTarget ? displayName(deleteTarget) : 'ce contact'} ne sera
              plus visible dans le foyer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => void removeContact()}
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

function ContactList({
  contacts,
  onEdit,
  onDelete,
  onTag,
}: {
  contacts: FamilyContact[];
  onEdit: (contact: FamilyContact) => void;
  onDelete: (contact: FamilyContact) => void;
  onTag: (tag: string) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="min-w-[850px]">
        <TableHeader className="bg-muted/35">
          <TableRow>
            <TableHead className="min-w-48 px-4">Contact</TableHead>
            <TableHead>Téléphone</TableHead>
            <TableHead>E-mail</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Visibilité</TableHead>
            <TableHead className="px-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => {
            const name = displayName(contact);
            return (
              <TableRow key={contact.id}>
                <TableCell className="px-4">
                  <span className="font-semibold">{name}</span>
                  <span className="block text-xs text-muted-foreground">
                    Ajouté par {contact.createdByName}
                  </span>
                </TableCell>
                <TableCell>
                  {contact.phone ? (
                    <a
                      href={`tel:${contact.phone}`}
                      className="hover:text-primary hover:underline"
                    >
                      {contact.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {contact.email ? (
                    <a
                      href={`mailto:${contact.email}`}
                      className="hover:text-primary hover:underline"
                    >
                      {contact.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-40 gap-1 overflow-hidden">
                    {contact.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => onTag(tag)}
                        className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs hover:bg-secondary"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <VisibilityBadge visibility={contact.visibility} />
                </TableCell>
                <TableCell className="px-4">
                  {contact.editable ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Modifier ${name}`}
                        onClick={() => onEdit(contact)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Supprimer ${name}`}
                        onClick={() => onDelete(contact)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

function ContactCard({
  contact,
  onEdit,
  onDelete,
  onTag,
}: {
  contact: FamilyContact;
  onEdit: () => void;
  onDelete: () => void;
  onTag: (tag: string) => void;
}) {
  const name = displayName(contact);
  return (
    <Card className="overflow-hidden py-0">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-secondary font-semibold text-secondary-foreground">
            {`${contact.firstName[0] ?? ''}${contact.lastName?.[0] ?? ''}`.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{name}</h2>
            <p className="text-xs text-muted-foreground">
              Ajouté par {contact.createdByName}
            </p>
          </div>
          {contact.editable ? (
            <div className="flex">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Modifier ${name}`}
                onClick={onEdit}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Supprimer ${name}`}
                onClick={onDelete}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>

        {contact.phone || contact.email ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {contact.phone ? (
              <a
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                href={`tel:${contact.phone}`}
              >
                <Phone /> Appeler
              </a>
            ) : null}
            {contact.email ? (
              <a
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                href={`mailto:${contact.email}`}
              >
                <Mail /> Écrire
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 space-y-2 text-sm">
          {contact.phone ? (
            <p className="flex gap-2">
              <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>{contact.phone}</span>
            </p>
          ) : null}
          {contact.email ? (
            <p className="flex min-w-0 gap-2">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{contact.email}</span>
            </p>
          ) : null}
          {contact.address ? (
            <p className="flex gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="whitespace-pre-wrap">{contact.address}</span>
            </p>
          ) : null}
          {contact.notes ? (
            <p className="whitespace-pre-wrap rounded-xl bg-muted/45 px-3 py-2.5 text-muted-foreground">
              {contact.notes}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {contact.tags.map((value) => (
            <button key={value} type="button" onClick={() => onTag(value)}>
              <Badge variant="secondary">{value}</Badge>
            </button>
          ))}
          <VisibilityBadge visibility={contact.visibility} />
        </div>
      </CardContent>
    </Card>
  );
}

function VisibilityBadge({ visibility }: { visibility: ContactVisibility }) {
  const Icon =
    visibility === 'PRIVATE'
      ? Lock
      : visibility === 'ALL_MEMBERS'
        ? Globe2
        : Users;
  return (
    <Badge variant="outline" className="ml-auto">
      <Icon className="size-3" /> {visibilityLabels[visibility]}
    </Badge>
  );
}

function ContactEditor({
  open,
  contact,
  visibility,
  members,
  groups,
  selectedGroups,
  selectedMembers,
  submitting,
  error,
  onClose,
  onSave,
  onVisibilityChange,
  onGroupsChange,
  onMembersChange,
}: {
  open: boolean;
  contact: FamilyContact | null;
  visibility: ContactVisibility;
  members: FamilyMember[];
  groups: FamilyGroup[];
  selectedGroups: string[];
  selectedMembers: string[];
  submitting: boolean;
  error: string;
  onClose: () => void;
  onSave: (event: SyntheticEvent<HTMLFormElement>) => void;
  onVisibilityChange: (value: ContactVisibility) => void;
  onGroupsChange: (value: string[]) => void;
  onMembersChange: (value: string[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {contact ? 'Modifier le contact' : 'Ajouter un contact externe'}
          </DialogTitle>
          <DialogDescription>
            Les membres du foyer sont déjà disponibles dans le module Membres.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-first-name">
                Prénom ou nom du service
              </Label>
              <Input
                id="contact-first-name"
                name="firstName"
                required
                maxLength={80}
                defaultValue={contact?.firstName ?? ''}
                placeholder="Camille"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-last-name">
                Nom{' '}
                <span className="font-normal text-muted-foreground">
                  (facultatif)
                </span>
              </Label>
              <Input
                id="contact-last-name"
                name="lastName"
                maxLength={80}
                defaultValue={contact?.lastName ?? ''}
                placeholder="Martin"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Téléphone</Label>
              <Input
                id="contact-phone"
                name="phone"
                type="tel"
                maxLength={40}
                defaultValue={contact?.phone ?? ''}
                placeholder="06 12 34 56 78"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">E-mail</Label>
              <Input
                id="contact-email"
                name="email"
                type="email"
                maxLength={254}
                defaultValue={contact?.email ?? ''}
                placeholder="camille@exemple.fr"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-address">Adresse</Label>
            <Textarea
              id="contact-address"
              name="address"
              maxLength={500}
              defaultValue={contact?.address ?? ''}
              placeholder="12 rue des Lilas, 75000 Paris"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-notes">Notes</Label>
            <Textarea
              id="contact-notes"
              name="notes"
              maxLength={2000}
              defaultValue={contact?.notes ?? ''}
              placeholder="Horaires, spécialité, informations utiles…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-tags">
              Tags{' '}
              <span className="font-normal text-muted-foreground">
                (séparés par des virgules)
              </span>
            </Label>
            <Input
              id="contact-tags"
              name="tags"
              maxLength={500}
              defaultValue={contact?.tags.join(', ') ?? ''}
              placeholder="santé, école, urgence"
            />
          </div>

          <div className="space-y-3 rounded-2xl border bg-muted/20 p-4">
            <div className="space-y-2">
              <Label htmlFor="contact-visibility">
                Qui peut voir ce contact ?
              </Label>
              <Select
                value={visibility}
                onValueChange={(value) =>
                  onVisibilityChange(value as ContactVisibility)
                }
              >
                <SelectTrigger id="contact-visibility">
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
                    {member.firstName} {member.lastName}
                  </label>
                ))}
              </div>
            ) : null}
          </div>

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
                <ContactRound />
              )}{' '}
              {contact ? 'Enregistrer' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
