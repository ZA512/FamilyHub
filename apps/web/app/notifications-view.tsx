import { useEffect, useState } from 'react';
import { localeTag } from '@/lib/i18n';
import {
  Bell,
  Bookmark,
  ChartBar,
  ContactRound,
  FileText,
  Lightbulb,
  NotebookText,
  Check,
  CheckCheck,
  LoaderCircle,
  LibraryBig,
  Music2,
  ShoppingBasket,
} from 'lucide-react';

import type { FamilyNotification } from '@familyhub/contracts';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type NotificationsViewProps = {
  csrfToken: string;
  onUnreadCountChange: (count: number) => void;
};

export function NotificationsView({
  csrfToken,
  onUnreadCountChange,
}: NotificationsViewProps) {
  const [notifications, setNotifications] = useState<FamilyNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/notifications', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Impossible de charger les notifications.');
        return (await response.json()) as {
          notifications: FamilyNotification[];
          unreadCount: number;
        };
      })
      .then((payload) => {
        setNotifications(payload.notifications);
        onUnreadCountChange(payload.unreadCount);
        setError('');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'Notifications indisponibles.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [onUnreadCountChange]);

  const unreadCount = notifications.filter(
    (notification) => !notification.readAt,
  ).length;

  async function markRead(notification: FamilyNotification) {
    setBusyId(notification.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/notifications/${notification.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ read: true }),
      });
      if (!response.ok)
        throw new Error('La notification n’a pas pu être marquée comme lue.');
      const payload = (await response.json()) as {
        notification: FamilyNotification;
      };
      setNotifications((current) =>
        current.map((candidate) =>
          candidate.id === payload.notification.id
            ? payload.notification
            : candidate,
        ),
      );
      onUnreadCountChange(Math.max(0, unreadCount - 1));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setMarkingAll(true);
    setError('');
    try {
      const response = await fetch('/api/v1/notifications', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ read: true }),
      });
      if (!response.ok)
        throw new Error('Les notifications n’ont pas pu être mises à jour.');
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((notification) => ({
          ...notification,
          readAt: notification.readAt ?? readAt,
        })),
      );
      onUnreadCountChange(0);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm font-medium text-primary">
            À ne pas manquer
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
            Notifications
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            {unreadCount
              ? `${unreadCount} notification${unreadCount > 1 ? 's' : ''} non lue${unreadCount > 1 ? 's' : ''}`
              : 'Vous êtes à jour'}
          </p>
        </div>
        {unreadCount ? (
          <Button
            variant="outline"
            disabled={markingAll || !csrfToken}
            onClick={() => void markAllRead()}
            className="rounded-xl"
          >
            {markingAll ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <CheckCheck aria-hidden="true" />
            )}
            Tout marquer comme lu
          </Button>
        ) : null}
      </div>

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
            Chargement des notifications…
          </CardContent>
        </Card>
      ) : notifications.length ? (
        <Card className="gap-0 overflow-hidden py-0">
          {notifications.map((notification, index) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              divided={index > 0}
              busy={busyId === notification.id}
              onRead={() => void markRead(notification)}
            />
          ))}
        </Card>
      ) : (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center py-12 text-center">
            <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
              <Bell aria-hidden="true" />
            </span>
            <h2 className="font-semibold">Aucune notification</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Les nouvelles demandes et informations importantes apparaîtront
              ici.
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function NotificationRow({
  notification,
  divided,
  busy,
  onRead,
}: {
  notification: FamilyNotification;
  divided: boolean;
  busy: boolean;
  onRead: () => void;
}) {
  const unread = !notification.readAt;
  return (
    <article
      className={`flex items-start gap-3 px-4 py-4 ${divided ? 'border-t' : ''} ${unread ? 'bg-accent/35' : ''}`}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
        {notification.moduleKey === 'shopping' ? (
          <ShoppingBasket className="size-4" aria-hidden="true" />
        ) : notification.moduleKey === 'bookmarks' ? (
          <Bookmark className="size-4" aria-hidden="true" />
        ) : notification.moduleKey === 'pages' ? (
          <NotebookText className="size-4" aria-hidden="true" />
        ) : notification.moduleKey === 'collections' ? (
          <LibraryBig className="size-4" aria-hidden="true" />
        ) : notification.moduleKey === 'polls' ? (
          <ChartBar className="size-4" aria-hidden="true" />
        ) : notification.moduleKey === 'ideas' ? (
          <Lightbulb className="size-4" aria-hidden="true" />
        ) : notification.moduleKey === 'contacts' ? (
          <ContactRound className="size-4" aria-hidden="true" />
        ) : notification.moduleKey === 'documents' ? (
          <FileText className="size-4" aria-hidden="true" />
        ) : notification.moduleKey === 'music' ? (
          <Music2 className="size-4" aria-hidden="true" />
        ) : (
          <Bell className="size-4" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="font-medium">{notification.title}</h2>
          {unread ? (
            <span
              className="size-2 rounded-full bg-[#e49131]"
              aria-label="Non lue"
            />
          ) : null}
        </div>
        {notification.body ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {notification.body}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {new Intl.DateTimeFormat(localeTag(), {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(notification.createdAt))}
        </p>
      </div>
      {unread ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={busy}
          aria-label={`Marquer « ${notification.title} » comme lue`}
          onClick={onRead}
          className="shrink-0 rounded-xl"
        >
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
        </Button>
      ) : null}
    </article>
  );
}
