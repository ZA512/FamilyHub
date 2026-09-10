import { useState } from 'react';
import {
  Bookmark,
  CalendarDays,
  CheckSquare2,
  ContactRound,
  FileText,
  Lightbulb,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  NotebookText,
  ShoppingBasket,
  Utensils,
  Vote,
} from 'lucide-react';

import type { ModuleConfig, ModuleKey } from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

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
  onToggle: (key: ModuleKey, enabled: boolean) => Promise<void>;
};

export function SettingsView({
  role,
  modules,
  loadError,
  onToggle,
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
        <p className="mb-1 text-sm font-medium text-[#087f72]">
          Configuration du foyer
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
          Modules
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
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
          {error || loadError}
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
