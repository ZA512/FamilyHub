import { useEffect, useState, type SyntheticEvent } from 'react';
import { formatBinarySize, localeTag, t } from '@/lib/i18n';
import {
  Bookmark,
  BellRing,
  CalendarDays,
  CheckSquare2,
  ContactRound,
  Download,
  FileText,
  Gauge,
  HardDrive,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  NotebookText,
  Palette,
  ShieldCheck,
  ShoppingBasket,
  Upload,
  Utensils,
  Vote,
} from 'lucide-react';

import type {
  InstanceSettings,
  ModuleConfig,
  ModuleKey,
  NotificationPreference,
  StorageUsage,
} from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { parseBookmarkImport } from '@/lib/bookmark-import';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import type { PersonalPreferences } from '@/lib/personal-preferences';
import { urlBase64ToUint8Array } from '@/lib/push';
import { Switch } from '@/components/ui/switch';
import { ProfileSettings } from './profile-settings';

const functionalModules = [
  {
    key: 'chat' as const,
    label: 'Chat',
    description: 'Conversations privées et de groupe.',
    icon: MessageCircle,
  },
  {
    key: 'agenda' as const,
    label: 'Agenda',
    description: 'Événements, rendez-vous et rappels.',
    icon: CalendarDays,
  },
  {
    key: 'tasks' as const,
    label: 'Tâches et corvées',
    description: 'Travail partagé, échéances et historique.',
    icon: CheckSquare2,
  },
  {
    key: 'meals' as const,
    label: 'Repas',
    description: 'Plats et planning des repas.',
    icon: Utensils,
  },
  {
    key: 'shopping' as const,
    label: 'Courses',
    description: 'Liste commune et demandes de courses.',
    icon: ShoppingBasket,
  },
  {
    key: 'bookmarks' as const,
    label: 'Bookmarks',
    description: 'Liens utiles partagés avec le foyer.',
    icon: Bookmark,
  },
  {
    key: 'pages' as const,
    label: 'Pages',
    description: 'Notes structurées et informations durables.',
    icon: NotebookText,
  },
  {
    key: 'collections' as const,
    label: 'Collections',
    description: 'Listes d’idées et de recommandations.',
    icon: ListChecks,
  },
  {
    key: 'polls' as const,
    label: 'Sondages',
    description: 'Décisions rapides entre membres.',
    icon: Vote,
  },
  {
    key: 'ideas' as const,
    label: 'Boîte à idées',
    description: 'Propositions à discuter ou convertir.',
    icon: Lightbulb,
  },
  {
    key: 'contacts' as const,
    label: 'Contacts externes',
    description: 'Coordonnées utiles au foyer.',
    icon: ContactRound,
  },
  {
    key: 'documents' as const,
    label: 'Documents',
    description: 'Fichiers et documents partagés.',
    icon: FileText,
  },
];

type SettingsViewProps = {
  role: 'ADMIN' | 'MEMBER';
  modules: ModuleConfig[] | null;
  loadError: string;
  csrfToken: string;
  onToggle: (key: ModuleKey, enabled: boolean) => Promise<void>;
  personalPreferences: PersonalPreferences;
  onPersonalPreferencesChange: (preferences: PersonalPreferences) => void;
  onFirstNameChange: (firstName: string) => void;
  onLogout: () => Promise<void>;
};

export function SettingsView({
  role,
  modules,
  loadError,
  csrfToken,
  onToggle,
  personalPreferences,
  onPersonalPreferencesChange,
  onFirstNameChange,
  onLogout,
}: SettingsViewProps) {
  const [busyKey, setBusyKey] = useState<ModuleKey | null>(null);
  const [error, setError] = useState('');

  async function toggle(key: ModuleKey, enabled: boolean) {
    setBusyKey(key);
    setError('');
    try {
      await onToggle(key, enabled);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'La modification n’a pas été enregistrée.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section>
      <div className="mb-6">
        <p className="mb-1 text-sm font-medium text-[#087f72]">Votre espace</p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
          Paramètres
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Gérez votre profil et la configuration du foyer.
        </p>
      </div>

      <ProfileSettings
        csrfToken={csrfToken}
        onFirstNameChange={onFirstNameChange}
        onLogout={onLogout}
      />

      <PersonalDisplaySettings
        preferences={personalPreferences}
        onChange={onPersonalPreferencesChange}
      />

      <NotificationSettings csrfToken={csrfToken} />

      <Card className="mb-8">
        <CardHeader className="flex-row items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fff0dc] text-[#b86210]">
            <Download className="size-5" aria-hidden="true" />
          </span>
          <div>
            <CardTitle className="text-base">Exporter les données</CardTitle>
            <CardDescription className="mt-1">
              Archive ZIP lisible contenant JSON, CSV, calendrier ICS, bookmarks
              HTML, pages Markdown et fichiers originaux.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-3">
            <a
              className={buttonVariants({ variant: 'outline' })}
              href="/api/v1/exports/personal"
              download
            >
              <Download aria-hidden="true" /> Mes données
            </a>
            {role === 'ADMIN' ? (
              <a
                className={buttonVariants({
                  className: 'bg-[#087f72] text-white hover:bg-[#076d63]',
                })}
                href="/api/v1/exports/instance"
                download
              >
                <Download aria-hidden="true" /> Tout le foyer
              </a>
            ) : null}
          </div>
          <BookmarkImport csrfToken={csrfToken} />
        </CardContent>
      </Card>

      <RateLimitSettings role={role} csrfToken={csrfToken} />

      {role === 'ADMIN' ? <AuditLogSettings /> : null}

      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Modules</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les données d’un module désactivé restent conservées.
        </p>
      </div>

      {role !== 'ADMIN' ? (
        <p className="mb-4 rounded-xl border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
          Seul un administrateur peut modifier les modules du foyer.
        </p>
      ) : null}

      {loadError || error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {t(error || loadError)}
        </p>
      ) : null}

      <Card className="mb-6 gap-3 bg-[#102b3f] text-white">
        <CardHeader>
          <CardTitle className="text-base">Toujours disponibles</CardTitle>
          <CardDescription className="text-white/60">
            Accueil, membres, notifications, recherche et paramètres sont
            indispensables.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {[
            'Accueil',
            'Membres',
            'Notifications',
            'Recherche',
            'Paramètres',
          ].map((label) => (
            <Badge
              key={label}
              className="border-white/10 bg-white/10 text-white"
            >
              {label}
            </Badge>
          ))}
        </CardContent>
      </Card>

      {!modules ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            Chargement des modules…
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          {functionalModules.map((module, index) => {
            const enabled =
              modules.find((entry) => entry.key === module.key)?.enabled ??
              false;
            const busy = busyKey === module.key;
            return (
              <div
                key={module.key}
                className={`flex items-center gap-4 px-4 py-4 sm:px-5 ${index ? 'border-t' : ''}`}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7f5f2] text-[#087f72]">
                  <module.icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{module.label}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {module.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {busy ? (
                    <LoaderCircle
                      className="size-4 animate-spin text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                  <Switch
                    checked={enabled}
                    disabled={role !== 'ADMIN' || busyKey !== null}
                    onCheckedChange={(checked) =>
                      void toggle(module.key, checked)
                    }
                    aria-label={`${enabled ? 'Désactiver' : 'Activer'} le module ${module.label}`}
                  />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

function BookmarkImport({ csrfToken }: { csrfToken: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function importBookmarks() {
    if (!file) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (file.size > 5_242_880) throw new Error('Le fichier dépasse 5 Mio.');
      const payload = parseBookmarkImport(await file.text());
      const response = await fetch('/api/v1/imports/bookmarks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(
          'Les favoris n’ont pas pu être importés. Vérifiez le format du fichier.',
        );
      const result = (await response.json()) as {
        imported: number;
        skipped: number;
      };
      setMessage(
        `${result.imported} bookmark${result.imported > 1 ? 's' : ''} importé${result.imported > 1 ? 's' : ''}` +
          (result.skipped
            ? `, ${result.skipped} doublon${result.skipped > 1 ? 's' : ''} ignoré${result.skipped > 1 ? 's' : ''}.`
            : '.'),
      );
      setFile(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Import impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t pt-4">
      <div className="mb-3 flex items-start gap-3">
        <Upload className="mt-0.5 size-4 text-[#087f72]" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">Importer des bookmarks</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sélectionnez un export HTML ou JSON de Chrome, Firefox, Edge, Safari
            ou FamilyHub. Les liens restent privés et les doublons sont ignorés.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          key={file?.name ?? 'empty'}
          type="file"
          accept="application/json,text/html,.json,.html,.htm"
          className="max-w-md"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setMessage('');
            setError('');
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!file || busy || !csrfToken}
          onClick={() => void importBookmarks()}
        >
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload aria-hidden="true" />
          )}
          Importer
        </Button>
      </div>
      {message ? (
        <output className="mt-3 block text-sm text-[#087f72]">
          {t(message)}
        </output>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PersonalDisplaySettings({
  preferences,
  onChange,
}: {
  preferences: PersonalPreferences;
  onChange: (preferences: PersonalPreferences) => void;
}) {
  function toggleHidden(key: ModuleKey, hidden: boolean) {
    onChange({
      ...preferences,
      hiddenModules: hidden
        ? [...preferences.hiddenModules, key]
        : preferences.hiddenModules.filter((candidate) => candidate !== key),
    });
  }

  return (
    <Card className="mb-8">
      <CardHeader className="flex-row items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#eef0ff] text-[#5651a8]">
          <Palette className="size-5" aria-hidden="true" />
        </span>
        <div>
          <CardTitle className="text-base">Affichage personnel</CardTitle>
          <CardDescription className="mt-1">
            Ces choix restent sur cet appareil et n’affectent pas les autres
            membres.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="max-w-xs space-y-2">
          <Label htmlFor="theme-preference">Thème</Label>
          <NativeSelect
            id="theme-preference"
            className="w-full"
            value={preferences.theme}
            onChange={(event) =>
              onChange({
                ...preferences,
                theme: event.target.value as PersonalPreferences['theme'],
              })
            }
          >
            <NativeSelectOption value="system">Système</NativeSelectOption>
            <NativeSelectOption value="light">Clair</NativeSelectOption>
            <NativeSelectOption value="dark">Sombre</NativeSelectOption>
          </NativeSelect>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium">
            Modules masqués dans ma navigation
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {functionalModules.map((module) => {
              const hidden = preferences.hiddenModules.includes(module.key);
              return (
                <label
                  key={module.key}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"
                >
                  <span>{module.label}</span>
                  <Switch
                    checked={!hidden}
                    onCheckedChange={(visible) =>
                      toggleHidden(module.key, !visible)
                    }
                    aria-label={`${hidden ? 'Afficher' : 'Masquer'} ${module.label} dans ma navigation`}
                  />
                </label>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationSettings({ csrfToken }: { csrfToken: string }) {
  const [preferences, setPreferences] = useState<NotificationPreference | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pushSupported =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  const [pushConfigured, setPushConfigured] = useState<boolean | null>(() =>
    pushSupported ? null : false,
  );
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/notification-preferences', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'Impossible de charger vos préférences de notifications.',
          );
        return (await response.json()) as {
          preferences: NotificationPreference;
        };
      })
      .then((payload) => setPreferences(payload.preferences))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Préférences indisponibles.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!pushSupported) return;
    const controller = new AbortController();
    fetch('/api/v1/push/config', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Configuration Web Push indisponible.');
        return (await response.json()) as {
          enabled: boolean;
          publicKey: string | null;
        };
      })
      .then(async (payload) => {
        setPushConfigured(payload.enabled);
        setPushPublicKey(payload.publicKey);
        if (payload.enabled) {
          const registration = await navigator.serviceWorker.ready;
          setPushSubscribed(
            Boolean(await registration.pushManager.getSubscription()),
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPushConfigured(false);
      });
    return () => controller.abort();
  }, [pushSupported]);

  async function togglePush() {
    if (!pushSupported || !pushPublicKey) return;
    setPushBusy(true);
    setError('');
    setMessage('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        const response = await fetch('/api/v1/push/subscriptions', {
          method: 'DELETE',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ endpoint: current.endpoint }),
        });
        if (!response.ok) throw new Error('Désactivation Web Push impossible.');
        await current.unsubscribe();
        setPushSubscribed(false);
        setMessage('Notifications Web Push désactivées sur cet appareil.');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
        throw new Error('Le navigateur n’a pas autorisé les notifications.');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
      });
      const serialized = subscription.toJSON();
      if (
        !serialized.endpoint ||
        !serialized.keys?.p256dh ||
        !serialized.keys.auth
      ) {
        await subscription.unsubscribe();
        throw new Error('Abonnement Web Push incomplet.');
      }
      const response = await fetch('/api/v1/push/subscriptions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          endpoint: serialized.endpoint,
          keys: {
            p256dh: serialized.keys.p256dh,
            auth: serialized.keys.auth,
          },
        }),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error('Activation Web Push impossible.');
      }
      setPushSubscribed(true);
      setMessage('Notifications Web Push activées sur cet appareil.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Web Push indisponible.',
      );
    } finally {
      setPushBusy(false);
    }
  }

  function toggleModule(
    key: NotificationPreference['mutedModules'][number],
    muted: boolean,
  ) {
    if (!preferences) return;
    setMessage('');
    setPreferences({
      ...preferences,
      mutedModules: muted
        ? [...preferences.mutedModules, key]
        : preferences.mutedModules.filter((candidate) => candidate !== key),
    });
  }

  async function save() {
    if (!preferences) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/v1/notification-preferences', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(preferences),
      });
      if (!response.ok)
        throw new Error('Les préférences n’ont pas pu être enregistrées.');
      const payload = (await response.json()) as {
        preferences: NotificationPreference;
      };
      setPreferences(payload.preferences);
      setMessage('Préférences enregistrées.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-8">
      <CardHeader className="flex-row items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fff0dc] text-[#b86210]">
          <BellRing className="size-5" aria-hidden="true" />
        </span>
        <div>
          <CardTitle className="text-base">Notifications</CardTitle>
          <CardDescription className="mt-1">
            Choisissez le niveau d’alerte et les modules que vous souhaitez
            rendre silencieux.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Chargement…
          </div>
        ) : preferences ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="notification-level">Niveau</Label>
                <NativeSelect
                  id="notification-level"
                  className="w-full"
                  value={preferences.level}
                  onChange={(event) => {
                    setMessage('');
                    setPreferences({
                      ...preferences,
                      level: event.target
                        .value as NotificationPreference['level'],
                    });
                  }}
                >
                  <NativeSelectOption value="ALL">Toutes</NativeSelectOption>
                  <NativeSelectOption value="IMPORTANT">
                    Importantes uniquement
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quiet-start">Silencieux à partir de</Label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={preferences.quietStart ?? ''}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      quietStart: event.target.value || null,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quiet-end">Jusqu’à</Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={preferences.quietEnd ?? ''}
                  onChange={(event) =>
                    setPreferences({
                      ...preferences,
                      quietEnd: event.target.value || null,
                    })
                  }
                />
              </div>
            </div>

            <div>
              <p className="mb-3 text-sm font-medium">Modules silencieux</p>
              <div className="flex flex-wrap gap-2">
                {functionalModules.map((module) => {
                  const muted = preferences.mutedModules.includes(module.key);
                  return (
                    <Button
                      key={module.key}
                      type="button"
                      size="sm"
                      variant={muted ? 'default' : 'outline'}
                      onClick={() => toggleModule(module.key, !muted)}
                      className={muted ? 'bg-[#102b3f] hover:bg-[#183b55]' : ''}
                      aria-pressed={muted}
                    >
                      {module.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/25 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Notifications Web Push</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {!pushSupported
                    ? 'Non prises en charge par ce navigateur.'
                    : pushConfigured === null
                      ? 'Vérification de la configuration…'
                      : !pushConfigured
                        ? 'À activer dans la configuration du serveur.'
                        : pushSubscribed
                          ? 'Actives sur cet appareil.'
                          : 'Recevez les alertes même lorsque FamilyHub est fermé.'}
                </p>
              </div>
              {pushSupported && pushConfigured ? (
                <Button
                  type="button"
                  variant={pushSubscribed ? 'outline' : 'default'}
                  disabled={pushBusy || !csrfToken}
                  onClick={() => void togglePush()}
                  className={
                    pushSubscribed ? '' : 'bg-[#087f72] hover:bg-[#076d63]'
                  }
                >
                  {pushBusy ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : null}
                  {pushSubscribed ? 'Désactiver' : 'Activer'}
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div>
                {message ? (
                  <output className="text-sm text-[#087f72]">
                    {t(message)}
                  </output>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                disabled={saving || !csrfToken}
                onClick={() => void save()}
                className="bg-[#087f72] hover:bg-[#076d63]"
              >
                {saving ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : null}
                Enregistrer
              </Button>
            </div>
          </>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

type AuditLogEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
};

function AuditLogSettings() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/admin/audit-log?limit=30', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Impossible de charger le journal administratif.');
        return (await response.json()) as { entries: AuditLogEntry[] };
      })
      .then((payload) => setEntries(payload.entries))
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Journal indisponible.',
          );
      });
    return () => controller.abort();
  }, []);

  return (
    <Card className="mb-8">
      <CardHeader className="flex-row items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7f5f2] text-[#087f72]">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <div>
          <CardTitle className="text-base">Journal administratif</CardTitle>
          <CardDescription className="mt-1">
            Les 30 dernières actions sensibles de l’instance, réservées aux
            administrateurs.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : entries ? (
          entries.length ? (
            <div className="divide-y rounded-xl border">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm"
                >
                  <span className="font-medium">
                    {entry.action.replaceAll('.', ' · ')}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.actorName ?? 'Système'}
                  </span>
                  <time
                    className="ml-auto text-xs text-muted-foreground"
                    dateTime={entry.createdAt}
                  >
                    {new Intl.DateTimeFormat(localeTag(), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(entry.createdAt))}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucune action enregistrée.
            </p>
          )
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Chargement…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RateLimitSettings({
  role,
  csrfToken,
}: {
  role: 'ADMIN' | 'MEMBER';
  csrfToken: string;
}) {
  const [limit, setLimit] = useState(1_200);
  const [quotaGiB, setQuotaGiB] = useState(10);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch('/api/v1/instance-settings', { signal: controller.signal }),
      fetch('/api/v1/storage/usage', { signal: controller.signal }),
    ])
      .then(async ([settingsResponse, usageResponse]) => {
        if (!settingsResponse.ok || !usageResponse.ok)
          throw new Error('Impossible de charger les limites de l’instance.');
        return Promise.all([
          settingsResponse.json() as Promise<{ settings: InstanceSettings }>,
          usageResponse.json() as Promise<{ usage: StorageUsage }>,
        ]);
      })
      .then(([settingsPayload, usagePayload]) => {
        setLimit(settingsPayload.settings.apiRateLimitPerMinute);
        setQuotaGiB(settingsPayload.settings.storageQuotaBytes / 1_073_741_824);
        setUsage(usagePayload.usage);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error ? reason.message : 'Limites indisponibles.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/v1/instance-settings', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          apiRateLimitPerMinute: limit,
          storageQuotaBytes: Math.round(quotaGiB * 1_073_741_824),
        }),
      });
      if (!response.ok)
        throw new Error('La limite n’a pas pu être enregistrée.');
      const payload = (await response.json()) as { settings: InstanceSettings };
      setLimit(payload.settings.apiRateLimitPerMinute);
      setQuotaGiB(payload.settings.storageQuotaBytes / 1_073_741_824);
      setUsage((current) =>
        current
          ? { ...current, quotaBytes: payload.settings.storageQuotaBytes }
          : current,
      );
      setMessage('Les nouvelles limites sont actives immédiatement.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-8">
      <CardHeader className="flex-row items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7f5f2] text-[#087f72]">
          <HardDrive className="size-5" aria-hidden="true" />
        </span>
        <div>
          <CardTitle className="text-base">Limites de l’instance</CardTitle>
          <CardDescription className="mt-1">
            Contrôlez la charge API et l’espace occupé par les documents et
            pièces jointes du foyer.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {usage ? (
          <div className="mb-6 rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">Stockage utilisé</span>
              <span className="text-muted-foreground">
                {formatStorageSize(usage.usedBytes)} sur{' '}
                {formatStorageSize(usage.quotaBytes)} · {usage.attachmentCount}{' '}
                fichier{usage.attachmentCount > 1 ? 's' : ''}
              </span>
            </div>
            <Progress
              className="mt-3 [&_[data-slot=progress-indicator]]:bg-[#087f72] [&_[data-slot=progress-track]]:h-2"
              value={Math.min(
                100,
                ((usage.usedBytes + usage.reservedBytes) / usage.quotaBytes) *
                  100,
              )}
              aria-label="Espace de stockage utilisé"
            />
            {usage.reservedBytes > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {formatStorageSize(usage.reservedBytes)} temporairement réservé
                par des envois en cours.
              </p>
            ) : null}
            {usage.filesystemFreeBytes !== null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {formatStorageSize(usage.filesystemFreeBytes)} libres sur le
                volume physique.
              </p>
            ) : null}
          </div>
        ) : null}
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
          onSubmit={save}
        >
          <div className="space-y-2">
            <Label htmlFor="api-rate-limit" className="flex items-center gap-2">
              <Gauge className="size-4" aria-hidden="true" />
              Requêtes/minute/session
            </Label>
            <Input
              id="api-rate-limit"
              type="number"
              min={300}
              max={10_000}
              step={100}
              value={limit}
              disabled={loading || role !== 'ADMIN'}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="storage-quota">Quota de stockage (Gio)</Label>
            <Input
              id="storage-quota"
              type="number"
              min={0.1}
              max={10_240}
              step={0.1}
              value={quotaGiB}
              disabled={loading || role !== 'ADMIN'}
              onChange={(event) => setQuotaGiB(Number(event.target.value))}
            />
          </div>
          {role === 'ADMIN' ? (
            <Button
              type="submit"
              variant="outline"
              disabled={
                loading ||
                saving ||
                !csrfToken ||
                limit < 300 ||
                limit > 10_000 ||
                quotaGiB < 0.1 ||
                quotaGiB > 10_240
              }
            >
              {saving ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              Enregistrer
            </Button>
          ) : null}
        </form>
        {role !== 'ADMIN' ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Seul un administrateur peut modifier cette limite.
          </p>
        ) : null}
        {message ? (
          <output className="mt-3 block text-sm text-[#087f72]">
            {t(message)}
          </output>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatStorageSize(bytes: number): string {
  return formatBinarySize(bytes);
}
