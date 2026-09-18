import {
  useEffect,
  useState,
  type ComponentProps,
  type SyntheticEvent,
} from 'react';
import {
  Check,
  ImagePlus,
  LoaderCircle,
  LogOut,
  Save,
  Trash2,
  UserRound,
} from 'lucide-react';

import type { MemberProfile } from '@familyhub/contracts';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { setLocale } from '@/lib/i18n';

type ProfileSettingsProps = {
  csrfToken: string;
  onFirstNameChange: (firstName: string) => void;
  onLogout: () => Promise<void>;
};

export function ProfileSettings({
  csrfToken,
  onFirstNameChange,
  onLogout,
}: ProfileSettingsProps) {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/profile', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Impossible de charger votre profil.');
        return (await response.json()) as { profile: MemberProfile };
      })
      .then((payload) => {
        setProfile(payload.profile);
        setLocale(payload.profile.locale);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error ? reason.message : 'Profil indisponible.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function saveProfile(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');
    const data = new FormData(event.currentTarget);

    try {
      let avatarAttachmentId = removeAvatar
        ? null
        : (profile?.avatarAttachmentId ?? null);
      if (avatarFile) {
        avatarAttachmentId = await uploadAvatar(avatarFile, csrfToken);
      }
      const response = await fetch('/api/v1/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          firstName: data.get('firstName'),
          lastName: data.get('lastName') || null,
          phone: data.get('phone') || null,
          birthDate: data.get('birthDate') || null,
          timezone: data.get('timezone'),
          locale: data.get('locale'),
          profileVisibility: data.get('profileVisibility'),
          avatarAttachmentId,
        }),
      });
      if (!response.ok)
        throw new Error('Votre profil n’a pas pu être enregistré.');
      const payload = (await response.json()) as { profile: MemberProfile };
      setProfile(payload.profile);
      setLocale(payload.profile.locale);
      setAvatarFile(null);
      setRemoveAvatar(false);
      onFirstNameChange(payload.profile.firstName);
      setSaved(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    setError('');
    try {
      await onLogout();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Déconnexion impossible.',
      );
      setLoggingOut(false);
    }
  }

  return (
    <Card className="mb-8">
      <CardHeader className="flex-row items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-secondary text-secondary-foreground">
          <UserRound className="size-4" aria-hidden="true" />
        </span>
        <div>
          <CardTitle className="text-base">Mon profil</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Photo, coordonnées, langue et visibilité. Votre anniversaire est
            automatiquement synchronisé avec l’agenda.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-3 py-4 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Chargement du profil…
          </div>
        ) : profile ? (
          <form
            key={`${profile.avatarAttachmentId ?? 'none'}-${profile.locale}-${profile.profileVisibility}`}
            className="space-y-4"
            onSubmit={saveProfile}
            onChange={() => setSaved(false)}
          >
            <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-muted/20 p-4">
              <Avatar className="size-20">
                {!removeAvatar && profile.avatarUrl ? (
                  <AvatarImage src={profile.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback className="bg-accent text-lg font-semibold text-accent-foreground">
                  {profile.firstName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-2">
                <Label
                  htmlFor="profile-avatar"
                  className="flex items-center gap-2"
                >
                  <ImagePlus className="size-4" aria-hidden="true" />
                  Photo de profil
                </Label>
                <Input
                  id="profile-avatar"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="h-auto max-w-md py-1.5"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && file.size > 5_242_880) {
                      setError('La photo doit peser au maximum 5 Mio.');
                      event.target.value = '';
                      return;
                    }
                    setAvatarFile(file);
                    setRemoveAvatar(false);
                    setSaved(false);
                    setError('');
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG, GIF ou WebP · 5 Mio maximum.
                </p>
              </div>
              {profile.avatarUrl && !removeAvatar ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRemoveAvatar(true);
                    setAvatarFile(null);
                    setSaved(false);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  Retirer
                </Button>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ProfileField
                label="Prénom"
                name="firstName"
                defaultValue={profile.firstName}
                autoComplete="given-name"
                maxLength={80}
                required
              />
              <ProfileField
                label="Nom"
                name="lastName"
                defaultValue={profile.lastName ?? ''}
                autoComplete="family-name"
                maxLength={80}
              />
              <ProfileField
                label="Email"
                name="email"
                type="email"
                defaultValue={profile.email}
                disabled
              />
              <ProfileField
                label="Téléphone"
                name="phone"
                type="tel"
                defaultValue={profile.phone ?? ''}
                autoComplete="tel"
                maxLength={40}
              />
              <ProfileField
                label="Date de naissance"
                name="birthDate"
                type="date"
                defaultValue={profile.birthDate ?? ''}
                max={new Date().toISOString().slice(0, 10)}
              />
              <ProfileField
                label="Fuseau horaire"
                name="timezone"
                defaultValue={profile.timezone}
                list="timezone-options"
                autoComplete="off"
                maxLength={80}
                required
              />
              <datalist id="timezone-options">
                {[
                  'Europe/Paris',
                  'Europe/Brussels',
                  'Europe/London',
                  'America/Montreal',
                  'America/New_York',
                  'Indian/Reunion',
                  'Pacific/Noumea',
                ].map((timezone) => (
                  <option key={timezone} value={timezone}>
                    {timezone}
                  </option>
                ))}
              </datalist>
              <div className="space-y-2">
                <Label htmlFor="locale">Langue et formats</Label>
                <NativeSelect
                  id="locale"
                  name="locale"
                  className="w-full"
                  defaultValue={profile.locale}
                >
                  <NativeSelectOption value="fr">Français</NativeSelectOption>
                  <NativeSelectOption value="en">English</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="profileVisibility">
                  Confidentialité du profil
                </Label>
                <NativeSelect
                  id="profileVisibility"
                  name="profileVisibility"
                  className="w-full"
                  defaultValue={profile.profileVisibility}
                >
                  <NativeSelectOption value="ALL_MEMBERS">
                    Visible par le foyer
                  </NativeSelectOption>
                  <NativeSelectOption value="PRIVATE">
                    Privé · administrateurs uniquement
                  </NativeSelectOption>
                </NativeSelect>
              </div>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={loggingOut || saving}
                onClick={() => void logout()}
                className="rounded-xl text-destructive hover:text-destructive"
              >
                {loggingOut ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut aria-hidden="true" />
                )}
                Se déconnecter
              </Button>
              <Button
                type="submit"
                disabled={saving || loggingOut || !csrfToken}
                className="rounded-xl bg-primary hover:bg-primary/80"
              >
                {saving ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : saved ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {saved ? 'Enregistré' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function uploadAvatar(file: File, csrfToken: string): Promise<string> {
  const initialized = await fetch('/api/v1/uploads/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      size: file.size,
      clientMutationId: crypto.randomUUID(),
      purpose: 'AVATAR',
    }),
  });
  if (!initialized.ok) {
    if (initialized.status === 507) {
      throw new Error('Le quota de stockage du foyer est atteint.');
    }
    throw new Error('La photo n’a pas pu être préparée.');
  }
  const { uploadId } = (await initialized.json()) as { uploadId: string };
  const uploaded = await fetch(`/api/v1/uploads/${uploadId}/content`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'x-csrf-token': csrfToken,
    },
    body: file,
  });
  if (!uploaded.ok) throw new Error('Ce format de photo est refusé.');
  const completed = await fetch(`/api/v1/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
  });
  if (!completed.ok) throw new Error('La photo n’a pas pu être finalisée.');
  return uploadId;
}

function ProfileField({
  label,
  ...props
}: ComponentProps<typeof Input> & { label: string }) {
  const id = String(props.name);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-10 rounded-xl" {...props} />
    </div>
  );
}
