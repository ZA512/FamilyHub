import { useEffect, useState, type SyntheticEvent } from 'react';
import { ArrowRight, KeyRound, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';

import DashboardPage from '../app/page';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

type Member = {
  id: string;
  userId: string;
  instanceId: string;
  instanceName: string;
  firstName: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
};

type View = 'loading' | 'setup' | 'login' | 'dashboard';

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export function App() {
  const [view, setView] = useState<View>('loading');
  const [member, setMember] = useState<Member | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function bootstrap() {
      try {
        const setupResponse = await fetch('/api/v1/setup/status', { signal: controller.signal });
        if (!setupResponse.ok) throw new Error('Le serveur ne répond pas correctement.');
        const setup = (await setupResponse.json()) as { configured: boolean };
        if (!setup.configured) {
          setView('setup');
          return;
        }

        const meResponse = await fetch('/api/v1/me', { signal: controller.signal });
        if (meResponse.ok) {
          const payload = (await meResponse.json()) as { member: Member };
          setMember(payload.member);
          setView('dashboard');
        } else {
          setView('login');
        }
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : 'FamilyHub est momentanément indisponible.');
        setView('login');
      }
    }

    void bootstrap();
    return () => controller.abort();
  }, []);

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
      setMember(payload.member as Member);
      setView('dashboard');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible de créer le foyer.');
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
        body: JSON.stringify({ email: data.get('email'), password: data.get('password') }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error('Email ou mot de passe incorrect.');
      setMember(payload.member as Member);
      setView('dashboard');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connexion impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  if (view === 'loading') return <LoadingScreen />;
  if (view === 'dashboard' && member) {
    return <DashboardPage firstName={member.firstName} instanceName={member.instanceName} />;
  }

  return (
    <main className="grid min-h-svh place-items-center bg-[radial-gradient(circle_at_top_left,#daf4ef_0,transparent_34%),linear-gradient(150deg,#f9fcfc_0%,#eef4f7_100%)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-[#102b3f] text-white shadow-lg">
            <Sparkles className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xl font-semibold tracking-tight">FamilyHub</p>
            <p className="text-sm text-muted-foreground">Votre espace privé</p>
          </div>
        </div>

        <Card className="gap-5 border-0 bg-white/90 py-6 shadow-[0_24px_80px_-45px_rgba(16,43,63,.55)] ring-black/5 backdrop-blur">
          <CardHeader className="px-6">
            <span className="mb-2 grid size-10 place-items-center rounded-xl bg-[#e7f5f2] text-[#087f72]">
              {view === 'setup' ? <KeyRound className="size-5" aria-hidden="true" /> : <LockKeyhole className="size-5" aria-hidden="true" />}
            </span>
            <CardTitle className="text-2xl">{view === 'setup' ? 'Créer votre foyer' : 'Bon retour parmi nous'}</CardTitle>
            <CardDescription className="text-base">
              {view === 'setup'
                ? 'Cette étape ne sera demandée qu’une seule fois.'
                : 'Connectez-vous pour retrouver votre espace.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6">
            <form className="space-y-4" onSubmit={view === 'setup' ? submitSetup : submitLogin}>
              {view === 'setup' ? (
                <>
                  <FormField label="Nom du foyer" name="instanceName" placeholder="Foyer Girard" autoComplete="organization" />
                  <FormField label="Votre prénom" name="firstName" placeholder="Maxime" autoComplete="given-name" />
                </>
              ) : null}

              <FormField label="Email" name="email" type="email" placeholder="vous@exemple.fr" autoComplete="email" />
              <FormField
                label="Mot de passe"
                name="password"
                type="password"
                minLength={view === 'setup' ? 12 : 1}
                hint={view === 'setup' ? '12 caractères minimum' : undefined}
                autoComplete={view === 'setup' ? 'new-password' : 'current-password'}
              />

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
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" disabled={submitting} className="mt-2 h-11 w-full rounded-xl bg-[#087f72] text-base hover:bg-[#076d63]">
                {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                {view === 'setup' ? 'Créer le foyer' : 'Se connecter'}
                {!submitting ? <ArrowRight data-icon="inline-end" aria-hidden="true" /> : null}
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
  ...inputProps
}: React.ComponentProps<typeof Input> & { label: string; hint?: string }) {
  const name = String(inputProps.name);
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <Label htmlFor={name}>{label}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      <Input id={name} required className="h-11 rounded-xl bg-white" {...inputProps} />
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-svh place-items-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="grid size-12 place-items-center rounded-2xl bg-[#102b3f] text-white">
          <Sparkles className="size-5" aria-hidden="true" />
        </div>
        <LoaderCircle className="size-5 animate-spin" aria-label="Chargement" />
      </div>
    </main>
  );
}

function setupError(code: unknown): string {
  if (code === 'SETUP_TOKEN_INVALID') return 'Le jeton d’installation est incorrect.';
  if (code === 'INSTANCE_ALREADY_CONFIGURED') return 'Ce foyer est déjà configuré.';
  if (code === 'INVALID_REQUEST') return 'Vérifiez les informations saisies.';
  return 'Impossible de créer le foyer.';
}
