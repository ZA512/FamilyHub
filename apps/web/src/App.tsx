import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  ArrowRight,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
} from 'lucide-react';

import type { CurrentMember, InvitationPreview } from '@familyhub/contracts';

import DashboardPage from '../app/page';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  clearOfflineData,
  readOfflineSession,
  saveOfflineSession,
} from '../lib/offline-storage';
import { getLocale, setLocale, useLocale } from '../lib/i18n';

type View = 'loading' | 'setup' | 'login' | 'invite' | 'dashboard';
const PENDING_LOGOUT_KEY = 'familyhub-pending-logout';

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function persistAuthenticatedSession(member: CurrentMember) {
  const cachedMember = await readOfflineSession().catch(() => null);
  if (
    cachedMember &&
    (cachedMember.id !== member.id ||
      cachedMember.instanceId !== member.instanceId)
  ) {
    await clearOfflineData();
  }
  await saveOfflineSession(member);
}

export function App() {
  const locale = useLocale();
  const [view, setView] = useState<View>('loading');
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [csrfToken, setCsrfToken] = useState('');
  const [inviteToken] = useState(
    () => new URLSearchParams(window.location.search).get('invite') ?? '',
  );
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function bootstrap() {
      try {
        if (inviteToken) {
          const response = await fetch('/api/v1/invitations/inspect', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: inviteToken }),
            signal: controller.signal,
          });
          if (!response.ok) {
            window.history.replaceState({}, '', window.location.pathname);
            setError('Ce lien d’invitation est invalide ou a expiré.');
            setView('login');
            return;
          }
          const payload = (await response.json()) as {
            invitation: InvitationPreview;
          };
          setInvitation(payload.invitation);
          setView('invite');
          return;
        }

        const setupResponse = await fetch('/api/v1/setup/status', {
          signal: controller.signal,
        });
        if (!setupResponse.ok)
          throw new Error('Le serveur ne répond pas correctement.');
        const setup = (await setupResponse.json()) as { configured: boolean };
        if (!setup.configured) {
          setView('setup');
          return;
        }

        const meResponse = await fetch('/api/v1/me', {
          signal: controller.signal,
        });
        if (meResponse.ok) {
          const payload = (await meResponse.json()) as {
            member: CurrentMember;
            csrfToken: string;
          };
          setMember(payload.member);
          setLocale(payload.member.locale ?? getLocale());
          setCsrfToken(payload.csrfToken);
          await persistAuthenticatedSession(payload.member);
          setView('dashboard');
        } else {
          setView('login');
        }
      } catch (reason) {
        if (controller.signal.aborted) return;
        const cachedMember = await readOfflineSession().catch(() => null);
        if (cachedMember) {
          setMember(cachedMember);
          setLocale(cachedMember.locale ?? getLocale());
          setCsrfToken('');
          setError('');
          setView('dashboard');
          return;
        }
        setError(
          reason instanceof Error
            ? reason.message
            : 'FamilyHub est momentanément indisponible.',
        );
        setView('login');
      }
    }

    void bootstrap();
    return () => controller.abort();
  }, [inviteToken]);

  async function submitSetup(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/v1/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          instanceName: data.get('instanceName'),
          firstName: data.get('firstName'),
          email: data.get('email'),
          password: data.get('password'),
          setupToken: data.get('setupToken'),
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(setupError(payload.error));
      setMember(payload.member as CurrentMember);
      setLocale((payload.member as CurrentMember).locale ?? 'fr');
      setCsrfToken(
        typeof payload.csrfToken === 'string' ? payload.csrfToken : '',
      );
      await persistAuthenticatedSession(payload.member as CurrentMember);
      setView('dashboard');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Impossible de créer le foyer.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitLogin(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: data.get('email'),
          password: data.get('password'),
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error('Email ou mot de passe incorrect.');
      setMember(payload.member as CurrentMember);
      setLocale((payload.member as CurrentMember).locale ?? getLocale());
      setCsrfToken(
        typeof payload.csrfToken === 'string' ? payload.csrfToken : '',
      );
      localStorage.removeItem(PENDING_LOGOUT_KEY);
      await persistAuthenticatedSession(payload.member as CurrentMember);
      setView('dashboard');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Connexion impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function submitInvitation(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const data = new FormData(event.currentTarget);

    if (data.get('password') !== data.get('passwordConfirmation')) {
      setError('Les deux mots de passe ne correspondent pas.');
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token: inviteToken,
          firstName: data.get('firstName'),
          lastName: data.get('lastName'),
          password: data.get('password'),
        }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'Ce lien d’invitation est invalide ou a expiré.'
            : 'Impossible d’accepter cette invitation.',
        );
      }
      setMember(payload.member as CurrentMember);
      setLocale((payload.member as CurrentMember).locale ?? getLocale());
      setCsrfToken(
        typeof payload.csrfToken === 'string' ? payload.csrfToken : '',
      );
      await persistAuthenticatedSession(payload.member as CurrentMember);
      window.history.replaceState({}, '', window.location.pathname);
      setView('dashboard');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Impossible d’accepter cette invitation.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    if (!navigator.onLine) {
      localStorage.setItem(PENDING_LOGOUT_KEY, 'true');
      await clearOfflineData();
      setMember(null);
      setCsrfToken('');
      setError(
        'Déconnexion locale terminée. Le serveur sera notifié à la reconnexion.',
      );
      setView('login');
      return;
    }
    const response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: '{}',
    });
    if (!response.ok) throw new Error('La déconnexion a échoué.');
    localStorage.removeItem(PENDING_LOGOUT_KEY);
    await clearOfflineData();
    setMember(null);
    setCsrfToken('');
    setError('');
    setView('login');
  }

  useEffect(() => {
    if (view !== 'dashboard' || csrfToken) return;
    const controller = new AbortController();
    async function restoreOnlineSession() {
      try {
        const response = await fetch('/api/v1/me', {
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401) {
            setMember(null);
            setCsrfToken('');
            setError(
              'Votre session a expiré. Reconnectez-vous pour synchroniser.',
            );
            setView('login');
          }
          return;
        }
        const payload = (await response.json()) as {
          member: CurrentMember;
          csrfToken: string;
        };
        setMember(payload.member);
        setLocale(payload.member.locale ?? getLocale());
        setCsrfToken(payload.csrfToken);
        await persistAuthenticatedSession(payload.member);
      } catch {
        // La session locale reste utilisable tant que le serveur est indisponible.
      }
    }
    function onOnline() {
      void restoreOnlineSession();
    }
    window.addEventListener('online', onOnline);
    if (navigator.onLine) void restoreOnlineSession();
    return () => {
      controller.abort();
      window.removeEventListener('online', onOnline);
    };
  }, [csrfToken, view]);

  useEffect(() => {
    if (view !== 'login' || localStorage.getItem(PENDING_LOGOUT_KEY) !== 'true')
      return;
    async function finishRemoteLogout() {
      setSubmitting(true);
      try {
        const meResponse = await fetch('/api/v1/me');
        if (meResponse.status === 401) {
          localStorage.removeItem(PENDING_LOGOUT_KEY);
          return;
        }
        if (!meResponse.ok) return;
        const payload = (await meResponse.json()) as { csrfToken: string };
        const response = await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': payload.csrfToken,
          },
          body: '{}',
        });
        if (response.ok) localStorage.removeItem(PENDING_LOGOUT_KEY);
      } catch {
        // Une nouvelle reconnexion relancera la révocation distante.
      } finally {
        setSubmitting(false);
      }
    }
    function onOnline() {
      void finishRemoteLogout();
    }
    window.addEventListener('online', onOnline);
    if (navigator.onLine) void finishRemoteLogout();
    return () => window.removeEventListener('online', onOnline);
  }, [view]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === 'en'
        ? 'FamilyHub — Your household'
        : 'FamilyHub — Votre foyer';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        locale === 'en'
          ? 'The private space for organising household life.'
          : 'L’espace privé pour organiser la vie du foyer.',
      );
  }, [locale]);

  if (view === 'loading') return <LoadingScreen />;
  if (view === 'dashboard' && member) {
    return (
      <DashboardPage
        memberId={member.id}
        instanceId={member.instanceId}
        firstName={member.firstName}
        instanceName={member.instanceName}
        role={member.role}
        csrfToken={csrfToken}
        onLogout={logout}
      />
    );
  }

  return (
    <main className="familyhub-auth-background grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <fieldset
          className="mb-4 flex justify-end gap-1 border-0 p-0"
          aria-label="Langue"
        >
          <Button
            type="button"
            size="sm"
            variant={locale === 'fr' ? 'secondary' : 'ghost'}
            aria-pressed={locale === 'fr'}
            onClick={() => setLocale('fr')}
          >
            Français
          </Button>
          <Button
            type="button"
            size="sm"
            variant={locale === 'en' ? 'secondary' : 'ghost'}
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
          >
            English
          </Button>
        </fieldset>
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
            <Sparkles className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xl font-semibold tracking-tight">FamilyHub</p>
            <p className="text-sm text-muted-foreground">Votre espace privé</p>
          </div>
        </div>

        <Card className="gap-5 border-0 bg-card/90 py-6 shadow-[0_24px_80px_-45px_rgba(16,34,52,.55)] ring-foreground/5 backdrop-blur">
          <CardHeader className="px-6">
            <span className="mb-2 grid size-10 place-items-center rounded-xl bg-secondary text-secondary-foreground">
              {view === 'setup' ? (
                <KeyRound className="size-5" aria-hidden="true" />
              ) : view === 'invite' ? (
                <Sparkles className="size-5" aria-hidden="true" />
              ) : (
                <LockKeyhole className="size-5" aria-hidden="true" />
              )}
            </span>
            <CardTitle className="text-2xl">
              {view === 'setup'
                ? 'Créer votre foyer'
                : view === 'invite'
                  ? `Rejoindre ${invitation?.instanceName ?? 'le foyer'}`
                  : 'Bon retour parmi nous'}
            </CardTitle>
            <CardDescription className="text-base">
              {view === 'setup'
                ? 'Cette étape ne sera demandée qu’une seule fois.'
                : view === 'invite'
                  ? `Invitation envoyée à ${invitation?.email ?? 'votre adresse'}.`
                  : 'Connectez-vous pour retrouver votre espace.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6">
            <form
              className="space-y-4"
              onSubmit={
                view === 'setup'
                  ? submitSetup
                  : view === 'invite'
                    ? submitInvitation
                    : submitLogin
              }
            >
              {view === 'setup' ? (
                <>
                  <FormField
                    label="Nom du foyer"
                    name="instanceName"
                    placeholder="Foyer Girard"
                    autoComplete="organization"
                  />
                  <FormField
                    label="Votre prénom"
                    name="firstName"
                    placeholder="Maxime"
                    autoComplete="given-name"
                  />
                </>
              ) : null}

              {view === 'invite' ? (
                <>
                  <FormField
                    label="Prénom"
                    name="firstName"
                    placeholder="Jade"
                    autoComplete="given-name"
                  />
                  <FormField
                    label="Nom"
                    name="lastName"
                    placeholder="Martin"
                    autoComplete="family-name"
                    required={false}
                  />
                  <FormField
                    label="Mot de passe"
                    name="password"
                    type="password"
                    minLength={12}
                    hint="12 caractères minimum"
                    autoComplete="new-password"
                  />
                  <FormField
                    label="Confirmer le mot de passe"
                    name="passwordConfirmation"
                    type="password"
                    minLength={12}
                    autoComplete="new-password"
                  />
                </>
              ) : (
                <>
                  <FormField
                    label="Email"
                    name="email"
                    type="email"
                    placeholder="vous@exemple.fr"
                    autoComplete="email"
                  />
                  <FormField
                    label="Mot de passe"
                    name="password"
                    type="password"
                    minLength={view === 'setup' ? 12 : 1}
                    hint={
                      view === 'setup' ? '12 caractères minimum' : undefined
                    }
                    autoComplete={
                      view === 'setup' ? 'new-password' : 'current-password'
                    }
                  />
                </>
              )}

              {view === 'setup' ? (
                <FormField
                  label="Jeton d’installation"
                  name="setupToken"
                  type="password"
                  hint="La valeur SETUP_TOKEN configurée sur votre NAS"
                  autoComplete="off"
                />
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                className="mt-2 h-11 w-full rounded-xl bg-primary text-base hover:bg-primary/80"
              >
                {submitting ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : null}
                {view === 'setup'
                  ? 'Créer le foyer'
                  : view === 'invite'
                    ? 'Rejoindre le foyer'
                    : 'Se connecter'}
                {!submitting ? (
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                ) : null}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          Hébergé chez vous · Vos données restent privées
        </p>
      </div>
    </main>
  );
}

function FormField({
  label,
  hint,
  required = true,
  ...inputProps
}: React.ComponentProps<typeof Input> & {
  label: string;
  hint?: string;
  required?: boolean;
}) {
  const name = String(inputProps.name);
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <Label htmlFor={name}>{label}</Label>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      <Input
        id={name}
        required={required}
        className="h-11 rounded-xl bg-background"
        {...inputProps}
      />
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-svh place-items-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
          <Sparkles className="size-5" aria-hidden="true" />
        </div>
        <LoaderCircle className="size-5 animate-spin" aria-label="Chargement" />
      </div>
    </main>
  );
}

function setupError(code: unknown): string {
  if (code === 'SETUP_TOKEN_INVALID')
    return 'Le jeton d’installation est incorrect.';
  if (code === 'INSTANCE_ALREADY_CONFIGURED')
    return 'Ce foyer est déjà configuré.';
  if (code === 'INVALID_REQUEST') return 'Vérifiez les informations saisies.';
  return 'Impossible de créer le foyer.';
}
