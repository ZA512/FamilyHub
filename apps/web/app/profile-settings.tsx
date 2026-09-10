import {
  useEffect,
  useState,
  type ComponentProps,
  type SyntheticEvent,
} from 'react';
import { Check, LoaderCircle, LogOut, Save, UserRound } from 'lucide-react';

import type { MemberProfile } from '@familyhub/contracts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/profile', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Impossible de charger votre profil.');
        return (await response.json()) as { profile: MemberProfile };
      })
      .then((payload) => setProfile(payload.profile))
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
        }),
      });
      if (!response.ok)
        throw new Error('Votre profil n’a pas pu être enregistré.');
      const payload = (await response.json()) as { profile: MemberProfile };
      setProfile(payload.profile);
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
        <span className="grid size-10 place-items-center rounded-xl bg-[#e7f5f2] text-[#087f72]">
          <UserRound className="size-4" aria-hidden="true" />
        </span>
        <div>
          <CardTitle className="text-base">Mon profil</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Vos coordonnées restent visibles uniquement dans votre foyer.
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
            className="space-y-4"
            onSubmit={saveProfile}
            onChange={() => setSaved(false)}
          >
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
                className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
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
