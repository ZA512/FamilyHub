import { useState, type SyntheticEvent } from 'react';
import {
  memberPasswordUpdateSchema,
  type FamilyMember,
} from '@familyhub/contracts';
import { KeyRound, LoaderCircle } from 'lucide-react';

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
import { t } from '@/lib/i18n';

export function MemberPasswordDialog({
  member,
  csrfToken,
  onClose,
  onSaved,
}: {
  member: FamilyMember;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const displayName = [member.firstName, member.lastName]
    .filter(Boolean)
    .join(' ');

  async function savePassword(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    const data = new FormData(event.currentTarget);
    const parsed = memberPasswordUpdateSchema.safeParse({
      password: data.get('password'),
    });
    if (!parsed.success) {
      setError('Le mot de passe doit contenir entre 12 et 200 caractères.');
      return;
    }
    if (parsed.data.password !== data.get('confirmation')) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/v1/members/${member.id}/password`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok)
        throw new Error('Le mot de passe n’a pas pu être modifié.');
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Le mot de passe n’a pas pu être modifié.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>Modifier le mot de passe</DialogTitle>
          <DialogDescription>
            {t(
              'Attribuez un nouveau mot de passe à {0}. Ses sessions seront fermées. Communiquez-lui le nouveau mot de passe directement.',
              { 0: displayName },
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={savePassword}>
          <div className="space-y-2">
            <Label htmlFor="member-password">Nouveau mot de passe</Label>
            <Input
              id="member-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={200}
              disabled={submitting}
              aria-describedby="member-password-hint"
            />
            <p
              id="member-password-hint"
              className="text-xs text-muted-foreground"
            >
              12 caractères minimum
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-password-confirmation">
              Confirmer le mot de passe
            </Label>
            <Input
              id="member-password-confirmation"
              name="confirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={200}
              disabled={submitting}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onClose}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting || !csrfToken}>
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound aria-hidden="true" />
              )}
              Enregistrer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
