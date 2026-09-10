import { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  LoaderCircle,
  ShoppingBasket,
  Sparkles,
} from 'lucide-react';

import type {
  HomeActivity,
  HomeAttention,
  HomeSummary,
} from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

type HomeViewProps = {
  firstName: string;
  onNavigate: (view: 'notifications' | 'shopping') => void;
  onUnreadCountChange: (count: number) => void;
};

export function HomeView({
  firstName,
  onNavigate,
  onUnreadCountChange,
}: HomeViewProps) {
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const todayLabel = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/home', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Impossible de charger l’accueil.');
        return (await response.json()) as HomeSummary;
      })
      .then((payload) => {
        setSummary(payload);
        onUnreadCountChange(payload.unreadNotificationCount);
        setError('');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error ? reason.message : 'Accueil indisponible.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onUnreadCountChange]);

  return (
    <>
      <section className="mb-7">
        <p className="mb-1 text-sm font-medium text-[#087f72]">
          {todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
          Bonjour {firstName}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          Voici ce qui compte aujourd’hui.
        </p>
      </section>

      {error ? (
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
            Chargement de l’accueil…
          </CardContent>
        </Card>
      ) : summary ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.85fr)]">
          <AttentionSection items={summary.attention} onNavigate={onNavigate} />
          <ActivitySection items={summary.activity} onNavigate={onNavigate} />
        </div>
      ) : null}
    </>
  );
}

function AttentionSection({
  items,
  onNavigate,
}: {
  items: HomeAttention[];
  onNavigate: HomeViewProps['onNavigate'];
}) {
  return (
    <section aria-labelledby="attention-title">
      <div className="mb-3 flex items-center justify-between">
        <h2
          id="attention-title"
          className="text-lg font-semibold tracking-tight"
        >
          À voir
        </h2>
        {items.length ? (
          <Badge variant="secondary" className="bg-[#e7f5f2] text-[#075e55]">
            {items.length} sujet{items.length > 1 ? 's' : ''}
          </Badge>
        ) : null}
      </div>

      {items.length ? (
        <Card className="gap-0 overflow-hidden py-0">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.view)}
              className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/45 ${index ? 'border-t' : ''}`}
            >
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-xl ${item.id === 'notifications' ? 'bg-[#eef0ff] text-[#5651a8]' : 'bg-[#fff3df] text-[#a55e10]'}`}
              >
                {item.id === 'notifications' ? (
                  <Bell className="size-4" aria-hidden="true" />
                ) : (
                  <ShoppingBasket className="size-4" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{item.title}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {item.detail}
                </span>
              </span>
              <ChevronRight
                className="size-4 text-muted-foreground/60"
                aria-hidden="true"
              />
            </button>
          ))}
        </Card>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex items-center gap-4 py-8">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
              <CheckCircle2 aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-semibold">Rien d’urgent</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Aucune notification ni course en attente.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function ActivitySection({
  items,
  onNavigate,
}: {
  items: HomeActivity[];
  onNavigate: HomeViewProps['onNavigate'];
}) {
  return (
    <section aria-labelledby="activity-title">
      <h2
        id="activity-title"
        className="mb-3 text-lg font-semibold tracking-tight"
      >
        Activité récente
      </h2>
      {items.length ? (
        <Card className="gap-0 py-1">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.view)}
              className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/45"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-foreground/70">
                {item.actorName.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-snug">
                  {item.actorName}{' '}
                  {item.type === 'shopping.purchased'
                    ? 'a acheté'
                    : 'a ajouté aux courses'}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {item.subject} · {formatRelativeDate(item.occurredAt)}
                </span>
              </span>
            </button>
          ))}
        </Card>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center py-10 text-center">
            <span className="mb-3 grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Sparkles aria-hidden="true" />
            </span>
            <h3 className="font-semibold">Pas encore d’activité</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Les actions récentes du foyer apparaîtront ici.
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const elapsedMinutes = Math.round((date.getTime() - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
  if (Math.abs(elapsedMinutes) < 60)
    return formatter.format(elapsedMinutes, 'minute');
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24)
    return formatter.format(elapsedHours, 'hour');
  return formatter.format(Math.round(elapsedHours / 24), 'day');
}
