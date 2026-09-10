import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  ShieldCheck,
  UserRound,
  UsersRound,
} from 'lucide-react';

import type {
  FamilyGroup,
  FamilyMember,
  PendingInvitation,
} from '@familyhub/contracts';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { InvitationDialog } from './invitation-dialog';

type MembersViewProps = {
  role: 'ADMIN' | 'MEMBER';
  csrfToken: string;
};

export function MembersView({ role, csrfToken }: MembersViewProps) {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editedGroup, setEditedGroup] = useState<FamilyGroup | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyMembership, setBusyMembership] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/members', { signal: controller.signal }),
      fetch('/api/v1/groups', { signal: controller.signal }),
      role === 'ADMIN'
        ? fetch('/api/v1/members/invitations', { signal: controller.signal })
        : Promise.resolve(null),
    ])
      .then(async ([membersResponse, groupsResponse, invitationsResponse]) => {
        if (
          !membersResponse.ok ||
          !groupsResponse.ok ||
          (invitationsResponse && !invitationsResponse.ok)
        ) {
          throw new Error('Impossible de charger les membres et les groupes.');
        }
        return Promise.all([
          membersResponse.json() as Promise<{ members: FamilyMember[] }>,
          groupsResponse.json() as Promise<{ groups: FamilyGroup[] }>,
          invitationsResponse
            ? (invitationsResponse.json() as Promise<{
                invitations: PendingInvitation[];
              }>)
            : Promise.resolve({ invitations: [] }),
        ]);
      })
      .then(([membersPayload, groupsPayload, invitationsPayload]) => {
        setMembers(membersPayload.members);
        setGroups(groupsPayload.groups);
        setInvitations(invitationsPayload.invitations);
        setError('');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Cette vue est indisponible.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [role]);

  function addInvitation(invitation: PendingInvitation) {
    setInvitations((current) => [
      invitation,
      ...current.filter((candidate) => candidate.email !== invitation.email),
    ]);
  }

  function openNewGroup() {
    setError('');
    setEditedGroup(null);
    setGroupDialogOpen(true);
  }

  function openEditGroup(group: FamilyGroup) {
    setError('');
    setEditedGroup(group);
    setGroupDialogOpen(true);
  }

  async function saveGroup(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch(
        editedGroup ? `/api/v1/groups/${editedGroup.id}` : '/api/v1/groups',
        {
          method: editedGroup ? 'PATCH' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            name: data.get('name'),
            description: data.get('description'),
          }),
        },
      );
      if (response.status === 409) {
        throw new Error('Un groupe porte déjà ce nom.');
      }
      if (!response.ok)
        throw new Error('Le groupe n’a pas pu être enregistré.');
      const payload = (await response.json()) as { group: FamilyGroup };
      setGroups((current) =>
        editedGroup
          ? current.map((group) =>
              group.id === payload.group.id ? payload.group : group,
            )
          : [...current, payload.group].sort((left, right) =>
              left.name.localeCompare(right.name, 'fr'),
            ),
      );
      form.reset();
      setGroupDialogOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleMembership(
    group: FamilyGroup,
    member: FamilyMember,
    checked: boolean,
  ) {
    const operationKey = `${group.id}:${member.id}`;
    setBusyMembership(operationKey);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/groups/${group.id}/members/${member.id}`,
        {
          method: checked ? 'PUT' : 'DELETE',
          headers: { 'x-csrf-token': csrfToken },
        },
      );
      if (!response.ok) {
        throw new Error('L’appartenance au groupe n’a pas pu être modifiée.');
      }

      setGroups((current) =>
        current.map((candidate) =>
          candidate.id === group.id
            ? {
                ...candidate,
                memberIds: checked
                  ? [...new Set([...candidate.memberIds, member.id])]
                  : candidate.memberIds.filter((id) => id !== member.id),
              }
            : candidate,
        ),
      );
      setMembers((current) =>
        current.map((candidate) =>
          candidate.id === member.id
            ? {
                ...candidate,
                groupIds: checked
                  ? [...new Set([...candidate.groupIds, group.id])]
                  : candidate.groupIds.filter((id) => id !== group.id),
              }
            : candidate,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyMembership(null);
    }
  }

  const activeMembers = members.filter((member) => member.status === 'ACTIVE');

  return (
    <>
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editedGroup ? 'Modifier le groupe' : 'Créer un groupe'}
            </DialogTitle>
            <DialogDescription>
              Un membre peut appartenir à plusieurs groupes.
            </DialogDescription>
          </DialogHeader>
          <form
            key={editedGroup?.id ?? 'new-group'}
            className="space-y-4"
            onSubmit={saveGroup}
          >
            <div className="space-y-2">
              <Label htmlFor="group-name">Nom</Label>
              <Input
                id="group-name"
                name="name"
                required
                maxLength={80}
                defaultValue={editedGroup?.name ?? ''}
                placeholder="Parents"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-description">Description</Label>
              <Textarea
                id="group-description"
                name="description"
                maxLength={240}
                defaultValue={editedGroup?.description ?? ''}
                placeholder="Pour les informations qui concernent les parents"
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
              ) : editedGroup ? (
                <Pencil aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              {editedGroup ? 'Enregistrer' : 'Créer le groupe'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-medium text-[#087f72]">
              Votre foyer
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Membres et groupes
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              {activeMembers.length} membre{activeMembers.length > 1 ? 's' : ''}{' '}
              actif{activeMembers.length > 1 ? 's' : ''} · {groups.length}{' '}
              groupe
              {groups.length > 1 ? 's' : ''}
            </p>
          </div>
          {role === 'ADMIN' ? (
            <div className="flex flex-wrap gap-2">
              <InvitationDialog
                csrfToken={csrfToken}
                onCreated={addInvitation}
              />
              <Button
                onClick={openNewGroup}
                className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
              >
                <Plus aria-hidden="true" />
                Nouveau groupe
              </Button>
            </div>
          ) : null}
        </div>

        {role !== 'ADMIN' ? (
          <p className="mb-4 rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
            Seul un administrateur peut modifier les groupes.
          </p>
        ) : null}

        {error && !groupDialogOpen ? (
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
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Chargement du foyer…
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="members">
            <TabsList className="mb-4 h-10 w-full sm:w-auto">
              <TabsTrigger value="members" className="px-4">
                <UserRound aria-hidden="true" />
                Membres
              </TabsTrigger>
              <TabsTrigger value="groups" className="px-4">
                <UsersRound aria-hidden="true" />
                Groupes
              </TabsTrigger>
            </TabsList>

            <TabsContent value="members">
              {role === 'ADMIN' && invitations.length ? (
                <Card className="mb-4 gap-3 border-dashed bg-muted/20">
                  <CardHeader>
                    <CardTitle className="text-base">
                      Invitations en attente
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {invitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {invitation.email}
                        </span>
                        <Badge variant="outline">
                          {invitation.role === 'ADMIN' ? 'Admin' : 'Membre'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          expire le{' '}
                          {new Intl.DateTimeFormat('fr-FR', {
                            day: 'numeric',
                            month: 'short',
                          }).format(new Date(invitation.expiresAt))}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
              <div className="grid gap-3 lg:grid-cols-2">
                {members.map((member) => (
                  <MemberCard key={member.id} member={member} groups={groups} />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="groups">
              <div className="grid gap-4 lg:grid-cols-2">
                {groups.map((group) => (
                  <Card key={group.id} className="gap-4">
                    <CardHeader className="flex-row items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7f5f2] text-[#087f72]">
                        {group.isSystem ? (
                          <LockKeyhole className="size-4" aria-hidden="true" />
                        ) : (
                          <UsersRound className="size-4" aria-hidden="true" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-base">
                            {group.name}
                          </CardTitle>
                          {group.isSystem ? (
                            <Badge variant="secondary">Système</Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {group.description || 'Aucune description'}
                        </p>
                      </div>
                      {role === 'ADMIN' && !group.isSystem ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Modifier le groupe ${group.name}`}
                          onClick={() => openEditGroup(group)}
                          className="rounded-xl"
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                      ) : null}
                    </CardHeader>
                    <CardContent>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.memberIds.length} membre
                        {group.memberIds.length > 1 ? 's' : ''}
                      </p>
                      <div className="space-y-1">
                        {activeMembers.map((member) => {
                          const checked = group.memberIds.includes(member.id);
                          const operationKey = `${group.id}:${member.id}`;
                          return (
                            <label
                              key={member.id}
                              className="flex min-h-10 items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={checked}
                                disabled={
                                  role !== 'ADMIN' ||
                                  group.isSystem ||
                                  busyMembership !== null
                                }
                                onCheckedChange={(value) =>
                                  void toggleMembership(
                                    group,
                                    member,
                                    value === true,
                                  )
                                }
                                aria-label={`${checked ? 'Retirer' : 'Ajouter'} ${member.firstName} ${checked ? 'du' : 'au'} groupe ${group.name}`}
                              />
                              <span className="flex-1 text-sm font-medium">
                                {member.firstName} {member.lastName}
                              </span>
                              {busyMembership === operationKey ? (
                                <LoaderCircle
                                  className="size-4 animate-spin text-muted-foreground"
                                  aria-hidden="true"
                                />
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </section>
    </>
  );
}

function MemberCard({
  member,
  groups,
}: {
  member: FamilyMember;
  groups: FamilyGroup[];
}) {
  const displayName = [member.firstName, member.lastName]
    .filter(Boolean)
    .join(' ');
  const initials =
    `${member.firstName[0] ?? ''}${member.lastName?.[0] ?? ''}`.toUpperCase();
  const memberGroups = groups.filter((group) =>
    member.groupIds.includes(group.id),
  );

  return (
    <Card className={member.status === 'INACTIVE' ? 'opacity-60' : ''}>
      <CardContent className="flex items-start gap-4">
        <Avatar size="lg">
          <AvatarFallback className="bg-[#d9f4ef] font-semibold text-[#075e55]">
            {initials || member.firstName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{displayName}</p>
            {member.role === 'ADMIN' ? (
              <Badge variant="secondary">
                <ShieldCheck aria-hidden="true" />
                Admin
              </Badge>
            ) : null}
            {member.status === 'INACTIVE' ? (
              <Badge variant="outline">Inactif</Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {member.email}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {memberGroups.map((group) => (
              <Badge key={group.id} variant="outline">
                {group.name}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
