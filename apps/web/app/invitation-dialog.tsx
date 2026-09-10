import { useState, type SyntheticEvent } from 'react';
import { Check, Clipboard, LoaderCircle, MailPlus } from 'lucide-react';

import type { PendingInvitation } from '@familyhub/contracts';

import { Button } from '@/components/ui/button';
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
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

type InvitationDialogProps = {
  csrfToken: string;
  onCreated: (invitation: PendingInvitation) => void;
};

export function InvitationDialog({
  csrfToken,
  onCreated,
}: InvitationDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setError('');
      setInviteUrl('');
      setCopied(false);
    }
  }

  async function createInvitation(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/v1/members/invitations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          email: data.get('email'),
          role: data.get('role'),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        invitation?: PendingInvitation;
        inviteUrl?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.error === 'MEMBER_ALREADY_EXISTS'
            ? 'Cette adresse appartient déjà à un membre du foyer.'
            : 'L’invitation n’a pas pu être créée.',
        );
      }
      if (!payload.invitation || !payload.inviteUrl) {
        throw new Error('Le serveur n’a pas renvoyé le lien d’invitation.');
      }
      onCreated(payload.invitation);
      setInviteUrl(payload.inviteUrl);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Invitation impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError('Sélectionnez le lien ci-dessous pour le copier manuellement.');
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="rounded-xl"
      >
        <MailPlus aria-hidden="true" />
        Inviter
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {inviteUrl ? 'Invitation prête' : 'Inviter un membre'}
            </DialogTitle>
            <DialogDescription>
              {inviteUrl
                ? 'Ce lien est valable sept jours et ne sera affiché qu’une fois.'
                : 'Vous pourrez transmettre vous-même le lien généré.'}
            </DialogDescription>
          </DialogHeader>

          {inviteUrl ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invitation-link">Lien d’invitation</Label>
                <Input
                  id="invitation-link"
                  readOnly
                  value={inviteUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="font-mono text-xs"
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button
                type="button"
                onClick={() => void copyLink()}
                className="w-full bg-[#087f72] hover:bg-[#076d63]"
              >
                {copied ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Clipboard aria-hidden="true" />
                )}
                {copied ? 'Lien copié' : 'Copier le lien'}
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={createInvitation}>
              <div className="space-y-2">
                <Label htmlFor="invitation-email">Adresse email</Label>
                <Input
                  id="invitation-email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="jade@exemple.fr"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invitation-role">Rôle</Label>
                <NativeSelect
                  id="invitation-role"
                  name="role"
                  defaultValue="MEMBER"
                  className="w-full"
                >
                  <NativeSelectOption value="MEMBER">Membre</NativeSelectOption>
                  <NativeSelectOption value="ADMIN">
                    Administrateur
                  </NativeSelectOption>
                </NativeSelect>
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
                  <MailPlus aria-hidden="true" />
                )}
                Créer le lien
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
