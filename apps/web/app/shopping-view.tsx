import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { formatDate } from '@/lib/i18n';
import {
  Check,
  CloudOff,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShoppingBasket,
  Trash2,
} from 'lucide-react';

import type {
  ShoppingItem,
  ShoppingItemCreate,
  ShoppingItemUpdate,
} from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  groupPendingShoppingItems,
  shoppingHistoryItems,
  sortPendingShoppingItems,
  type ShoppingHistoryScope,
} from '@/lib/shopping-history';
import {
  applyOptimisticShoppingUpdate,
  createOptimisticShoppingItem,
  discardShoppingConflicts,
  enqueueShoppingCreate,
  enqueueShoppingUpdate,
  readShoppingCache,
  shoppingMutationCounts,
  synchronizeShoppingMutations,
  writeShoppingCache,
} from '@/lib/offline-storage';

type ShoppingViewProps = {
  currentMemberId: string;
  currentMemberName: string;
  currentMemberAvatarUrl?: string | null;
  instanceId: string;
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export function ShoppingView({
  currentMemberId,
  currentMemberName,
  currentMemberAvatarUrl = null,
  instanceId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: ShoppingViewProps) {
  const sessionKey = `${instanceId}:${currentMemberId}`;
  const member = useMemo(
    () => ({
      id: currentMemberId,
      firstName: currentMemberName,
      avatarUrl: currentMemberAvatarUrl,
    }),
    [currentMemberAvatarUrl, currentMemberId, currentMemberName],
  );
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [serverAvailable, setServerAvailable] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<ShoppingHistoryScope>('mine');
  const [editedItem, setEditedItem] = useState<ShoppingItem | null>(null);
  const [toDelete, setToDelete] = useState<ShoppingItem | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(20);
  const synchronization = useRef<Promise<void> | null>(null);

  const refreshCounts = useCallback(async () => {
    const counts = await shoppingMutationCounts(sessionKey);
    setPendingCount(counts.pending);
    setConflictCount(counts.conflicts);
  }, [sessionKey]);

  const synchronize = useCallback(() => {
    if (synchronization.current) return synchronization.current;
    if (!navigator.onLine || !csrfToken) return Promise.resolve();

    const operation = (async () => {
      setSyncing(true);
      try {
        const result = await synchronizeShoppingMutations({
          sessionKey,
          csrfToken,
        });
        setPendingCount(result.pending);
        setConflictCount(result.conflicts);
        if (result.authenticationRequired) {
          setError(
            'Votre session doit être renouvelée avant la synchronisation.',
          );
          return;
        }

        const response = await fetch('/api/v1/shopping-items');
        if (!response.ok)
          throw new Error('Impossible de rafraîchir la liste de courses.');
        const payload = (await response.json()) as { items: ShoppingItem[] };
        setItems(payload.items);
        await writeShoppingCache(sessionKey, payload.items);
        setServerAvailable(true);
        setError('');
      } catch {
        setServerAvailable(false);
        const cached = await readShoppingCache(sessionKey);
        if (cached) {
          setItems(cached);
        } else {
          setError(
            'Le serveur est indisponible et aucune liste locale n’a encore été enregistrée.',
          );
        }
      } finally {
        setLoading(false);
        setSyncing(false);
      }
    })().finally(() => {
      synchronization.current = null;
    });
    synchronization.current = operation;
    return operation;
  }, [csrfToken, sessionKey]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const cached = await readShoppingCache(sessionKey).catch(() => null);
      if (!active) return;
      if (cached) setItems(cached);
      await refreshCounts();
      if (!active) return;
      if (navigator.onLine && csrfToken) {
        await synchronize();
      } else {
        setLoading(false);
        if (!cached) {
          setError(
            'Aucune liste n’est encore disponible hors connexion sur cet appareil.',
          );
        }
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, [csrfToken, refreshCounts, sessionKey, synchronize]);

  useEffect(() => {
    function handleOffline() {
      setOnline(false);
      setServerAvailable(false);
    }
    function handleOnline() {
      setOnline(true);
      void synchronize();
    }
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [synchronize]);

  const pending = useMemo(() => sortPendingShoppingItems(items), [items]);
  const visiblePending = pending.filter(
    (item) => scope === 'all' || item.requestedBy === currentMemberId,
  );
  const pendingGroups = groupPendingShoppingItems(visiblePending);
  const now = new Date();
  const recentHistory = shoppingHistoryItems(
    items,
    scope,
    'purchased',
    currentMemberId,
    now,
  );
  const fullHistory = shoppingHistoryItems(
    items,
    scope,
    'purchased',
    currentMemberId,
    now,
    true,
  );
  const history = showOlder ? fullHistory : recentHistory;
  const visibleHistory = history.slice(0, visibleHistoryCount);

  async function queueCreate(item: ShoppingItem, payload: ShoppingItemCreate) {
    await writeShoppingCache(sessionKey, items);
    await enqueueShoppingCreate(sessionKey, item, payload);
    setItems((current) => [item, ...current]);
    await refreshCounts();
  }

  async function createItem(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const clientMutationId = crypto.randomUUID();
    const payload = {
      name: formText(data, 'name'),
      quantity: formText(data, 'quantity') || null,
      note: formText(data, 'note') || null,
      clientMutationId,
    } satisfies ShoppingItemCreate;
    const optimisticItem = createOptimisticShoppingItem(
      clientMutationId,
      payload,
      member,
    );

    try {
      if (!navigator.onLine || !csrfToken) {
        await queueCreate(optimisticItem, payload);
      } else {
        let response: Response | null = null;
        try {
          response = await fetch('/api/v1/shopping-items', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrfToken,
            },
            body: JSON.stringify(payload),
          });
        } catch {
          setServerAvailable(false);
        }

        if (!response || response.status === 429 || response.status >= 500) {
          await queueCreate(optimisticItem, payload);
        } else if (!response.ok) {
          throw new Error('Impossible d’ajouter cet article.');
        } else {
          const body = (await response.json()) as { item: ShoppingItem };
          const nextItems = [body.item, ...items];
          setItems(nextItems);
          await writeShoppingCache(sessionKey, nextItems);
          setServerAvailable(true);
        }
      }
      form.reset();
      onComposerOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ajout impossible.');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateItem(item: ShoppingItem, update: ShoppingItemUpdate) {
    setBusyId(item.id);
    setError('');
    const optimisticItem = applyOptimisticShoppingUpdate(item, update, member);
    const optimisticItems = items.map((candidate) =>
      candidate.id === item.id ? optimisticItem : candidate,
    );
    setItems(optimisticItems);
    await writeShoppingCache(sessionKey, optimisticItems);

    try {
      if (!navigator.onLine || !csrfToken || item.id.startsWith('offline:')) {
        await enqueueShoppingUpdate(sessionKey, optimisticItem, update);
        await refreshCounts();
        return true;
      }

      let response: Response | null = null;
      try {
        response = await fetch(`/api/v1/shopping-items/${item.id}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(update),
        });
      } catch {
        setServerAvailable(false);
      }
      if (!response || response.status === 429 || response.status >= 500) {
        await enqueueShoppingUpdate(sessionKey, optimisticItem, update);
        await refreshCounts();
      } else if (!response.ok) {
        setItems(items);
        await writeShoppingCache(sessionKey, items);
        throw new Error('La modification n’a pas pu être enregistrée.');
      } else {
        const body = (await response.json()) as { item: ShoppingItem };
        const nextItems = optimisticItems.map((candidate) =>
          candidate.id === body.item.id ? body.item : candidate,
        );
        setItems(nextItems);
        await writeShoppingCache(sessionKey, nextItems);
        setServerAvailable(true);
      }
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function setPurchased(item: ShoppingItem, value: boolean) {
    await updateItem(item, { purchased: value });
  }

  async function editItem(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editedItem) return;
    const data = new FormData(event.currentTarget);
    const update = {
      name: formText(data, 'name'),
      quantity: formText(data, 'quantity') || null,
      note: formText(data, 'note') || null,
    } satisfies ShoppingItemUpdate;
    if (await updateItem(editedItem, update)) setEditedItem(null);
  }

  async function deleteItem() {
    if (!toDelete) return;
    if (!navigator.onLine || !csrfToken || toDelete.id.startsWith('offline:')) {
      setError(
        'La suppression sera disponible dès que cet article aura été synchronisé.',
      );
      setToDelete(null);
      return;
    }
    setBusyId(toDelete.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/shopping-items/${toDelete.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('Impossible de supprimer cet article.');
      const nextItems = items.filter((item) => item.id !== toDelete.id);
      setItems(nextItems);
      await writeShoppingCache(sessionKey, nextItems);
      setToDelete(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function acceptServerVersion() {
    await discardShoppingConflicts(sessionKey);
    await synchronize();
  }

  const connectionProblem = !online || !serverAvailable;

  return (
    <>
      <Dialog open={composerOpen} onOpenChange={onComposerOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter aux courses</DialogTitle>
            <DialogDescription>
              Ajoutez la quantité ou une précision si nécessaire.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={createItem}>
            <div className="space-y-2">
              <Label htmlFor="shopping-name">Article</Label>
              <Input
                id="shopping-name"
                name="name"
                required
                maxLength={160}
                placeholder="Shampoing"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shopping-quantity">Quantité</Label>
              <Input
                id="shopping-quantity"
                name="quantity"
                maxLength={80}
                placeholder="2 bouteilles"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shopping-note">Note</Label>
              <Textarea
                id="shopping-note"
                name="note"
                maxLength={500}
                placeholder="Sans parfum"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-primary hover:bg-primary/80"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              {connectionProblem
                ? 'Ajouter hors connexion'
                : 'Ajouter à la liste'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editedItem)}
        onOpenChange={(open) => {
          if (!open && !busyId) setEditedItem(null);
        }}
      >
        <DialogContent key={editedItem?.id} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier l’article</DialogTitle>
            <DialogDescription>
              Mettez à jour le nom, la quantité ou la note.
            </DialogDescription>
          </DialogHeader>
          {editedItem ? (
            <form className="space-y-4" onSubmit={editItem}>
              <div className="space-y-2">
                <Label htmlFor="shopping-edit-name">Article</Label>
                <Input
                  id="shopping-edit-name"
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={editedItem.name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shopping-edit-quantity">Quantité</Label>
                <Input
                  id="shopping-edit-quantity"
                  name="quantity"
                  maxLength={80}
                  defaultValue={editedItem.quantity ?? ''}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shopping-edit-note">Note</Label>
                <Textarea
                  id="shopping-edit-note"
                  name="note"
                  maxLength={500}
                  defaultValue={editedItem.note ?? ''}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(busyId)}
                  onClick={() => setEditedItem(null)}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={Boolean(busyId)}>
                  {busyId ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : null}
                  Enregistrer
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => {
          if (!open && !busyId) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet article ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {toDelete?.name} » disparaîtra de la liste de courses.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busyId)}
              onClick={() => void deleteItem()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {busyId ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-medium text-primary">
              Liste commune
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Courses
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              {pendingGroups.length
                ? `${pendingGroups.length} article${pendingGroups.length > 1 ? 's' : ''} à acheter`
                : 'La liste est à jour'}
            </p>
          </div>
          <Button
            onClick={() => onComposerOpenChange(true)}
            className="rounded-xl bg-primary hover:bg-primary/80"
          >
            <Plus aria-hidden="true" />
            Ajouter un article
          </Button>
        </div>

        <Tabs
          value={scope}
          onValueChange={(value) => {
            setScope(value as ShoppingHistoryScope);
            setShowOlder(false);
            setVisibleHistoryCount(20);
          }}
          className="mb-5"
        >
          <TabsList className="max-w-full">
            <TabsTrigger value="mine">Mes demandes</TabsTrigger>
            <TabsTrigger value="all">Toutes les demandes</TabsTrigger>
          </TabsList>
        </Tabs>

        {connectionProblem || pendingCount || conflictCount || syncing ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {syncing ? (
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
            ) : connectionProblem ? (
              <CloudOff className="size-4" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            <p className="min-w-0 flex-1">
              {syncing
                ? 'Synchronisation des courses…'
                : conflictCount
                  ? `${conflictCount} changement${conflictCount > 1 ? 's' : ''} à résoudre.`
                  : pendingCount
                    ? `${pendingCount} changement${pendingCount > 1 ? 's' : ''} sera synchronisé à la reconnexion.`
                    : 'Liste affichée depuis cet appareil. Vous pouvez continuer à la modifier.'}
            </p>
            {conflictCount ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void acceptServerVersion()}
              >
                Utiliser la version du serveur
              </Button>
            ) : online &&
              csrfToken &&
              !syncing &&
              (pendingCount || !serverAvailable) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void synchronize()}
              >
                {pendingCount ? 'Synchroniser' : 'Réessayer'}
              </Button>
            ) : null}
          </div>
        ) : null}

        {error && !composerOpen ? (
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
              Chargement de la liste…
            </CardContent>
          </Card>
        ) : visiblePending.length ? (
          <Card className="gap-0 overflow-hidden py-0">
            {pendingGroups.map((group, index) => (
              <div
                key={group.items[0]!.id}
                className={index > 0 ? 'border-t' : ''}
              >
                {group.items.length > 1 ? (
                  <details>
                    <summary className="cursor-pointer px-4 py-4 font-medium">
                      {group.items.length} {group.name} ({group.summary})
                    </summary>
                    <div className="border-t bg-muted/10">
                      {group.items.map((item, itemIndex) => (
                        <ShoppingRow
                          key={item.id}
                          item={item}
                          busy={busyId === item.id}
                          divided={itemIndex > 0}
                          editable={item.requestedBy === currentMemberId}
                          requesterAvatarUrl={
                            item.requestedBy === currentMemberId
                              ? currentMemberAvatarUrl
                              : item.requestedByAvatarUrl
                          }
                          onToggle={() => setPurchased(item, true)}
                          onEdit={() => setEditedItem(item)}
                          onDelete={() => setToDelete(item)}
                        />
                      ))}
                    </div>
                  </details>
                ) : (
                  <ShoppingRow
                    item={group.items[0]!}
                    busy={busyId === group.items[0]!.id}
                    divided={false}
                    editable={group.items[0]!.requestedBy === currentMemberId}
                    requesterAvatarUrl={
                      group.items[0]!.requestedBy === currentMemberId
                        ? currentMemberAvatarUrl
                        : group.items[0]!.requestedByAvatarUrl
                    }
                    onToggle={() => setPurchased(group.items[0]!, true)}
                    onEdit={() => setEditedItem(group.items[0]!)}
                    onDelete={() => setToDelete(group.items[0]!)}
                  />
                )}
              </div>
            ))}
          </Card>
        ) : (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
                <ShoppingBasket aria-hidden="true" />
              </span>
              <h2 className="font-semibold">Rien à acheter</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Ajoutez un article dès que quelqu’un pense à quelque chose.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading ? (
          <section className="mt-8" aria-labelledby="shopping-purchased-title">
            <h2
              id="shopping-purchased-title"
              className="mb-3 text-lg font-semibold"
            >
              Déjà achetés
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Achats des trois derniers jours. Ils sont supprimés après sept
              jours.
            </p>
            {visibleHistory.length ? (
              <Card className="gap-0 overflow-hidden py-0">
                {visibleHistory.map((item, index) => (
                  <ShoppingRow
                    key={item.id}
                    item={item}
                    busy={busyId === item.id}
                    divided={index > 0}
                    editable={item.requestedBy === currentMemberId}
                    requesterAvatarUrl={
                      item.requestedBy === currentMemberId
                        ? currentMemberAvatarUrl
                        : item.requestedByAvatarUrl
                    }
                    onToggle={() => setPurchased(item, !item.purchasedAt)}
                    onEdit={() => setEditedItem(item)}
                    onDelete={() => setToDelete(item)}
                  />
                ))}
              </Card>
            ) : (
              <Card className="border-dashed bg-muted/20">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {scope === 'mine'
                    ? 'Aucune de vos demandes n’a été achetée récemment.'
                    : 'Aucune demande achetée récemment.'}
                </CardContent>
              </Card>
            )}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {!showOlder && fullHistory.length > recentHistory.length ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowOlder(true)}
                >
                  Voir jusqu’à sept jours
                </Button>
              ) : null}
              {history.length > visibleHistoryCount ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVisibleHistoryCount((count) => count + 20)}
                >
                  Afficher plus
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}
      </section>
    </>
  );
}

function ShoppingRow({
  item,
  busy,
  divided,
  editable,
  requesterAvatarUrl,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: ShoppingItem;
  busy: boolean;
  divided: boolean;
  editable: boolean;
  requesterAvatarUrl?: string | null;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [mobileActionsVisible, setMobileActionsVisible] = useState(false);
  const purchased = Boolean(item.purchasedAt);
  const local = item.id.startsWith('offline:');
  const date = formatDate(item.purchasedAt ?? item.createdAt, {
    day: 'numeric',
    month: 'short',
  });
  const activity = purchased
    ? item.purchasedByName
      ? `Acheté le ${date} par ${item.purchasedByName}`
      : `Acheté le ${date}`
    : `Demandé le ${date} par ${item.requestedByName}`;

  return (
    <div
      className={`group relative flex min-w-0 items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4 ${divided ? 'border-t' : ''}`}
    >
      {editable ? (
        <button
          type="button"
          className="absolute inset-0 z-0 cursor-pointer md:hidden"
          onClick={() => setMobileActionsVisible((visible) => !visible)}
          aria-label={
            mobileActionsVisible
              ? `Masquer les actions pour ${item.name}`
              : `Afficher les actions pour ${item.name}`
          }
        />
      ) : null}
      <Button
        type="button"
        size="icon"
        variant={purchased ? 'secondary' : 'outline'}
        disabled={busy}
        aria-label={
          purchased
            ? `Remettre ${item.name} sur la liste`
            : `Marquer ${item.name} comme acheté`
        }
        onClick={onToggle}
        className={`relative z-10 size-11 shrink-0 rounded-xl sm:size-12 ${purchased ? 'text-primary' : ''}`}
      >
        {busy ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : purchased ? (
          <RotateCcw aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
      </Button>
      <Avatar
        className="size-8"
        title={item.requestedByName}
        aria-label={`Demandé par ${item.requestedByName}`}
      >
        {requesterAvatarUrl ? (
          <AvatarImage src={requesterAvatarUrl} alt="" />
        ) : null}
        <AvatarFallback className="text-[10px] font-semibold uppercase">
          {item.requestedByName.trim().slice(0, 2)}
        </AvatarFallback>
      </Avatar>
      <span
        className="max-w-20 min-w-7 shrink-0 truncate text-center text-sm font-semibold text-foreground"
        title={item.quantity ?? '1'}
      >
        {item.quantity || '1'}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={`truncate font-medium ${purchased ? 'line-through text-muted-foreground' : ''}`}
          title={item.note ? `${item.name} — ${item.note}` : item.name}
        >
          {item.name}
        </span>
        <Badge
          variant="secondary"
          className={`${mobileActionsVisible ? 'hidden sm:inline-flex' : 'inline-flex'} h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs`}
        >
          {item.source === 'MANUAL' ? 'Demande' : 'Repas'}
        </Badge>
        {local ? (
          <Badge
            variant="outline"
            className="hidden shrink-0 text-amber-800 lg:inline-flex"
          >
            À synchroniser
          </Badge>
        ) : null}
        <span
          className={`${mobileActionsVisible ? 'hidden sm:inline' : 'inline'} shrink-0 text-[11px] text-muted-foreground sm:text-xs`}
        >
          {date}
        </span>
      </div>
      {editable ? (
        <div
          className={`${mobileActionsVisible ? 'flex' : 'hidden'} relative z-10 shrink-0 items-center gap-0.5 md:flex md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100`}
        >
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            onClick={onEdit}
            aria-label={`Modifier ${item.name}`}
            title="Modifier"
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            onClick={onDelete}
            aria-label={`Supprimer ${item.name}`}
            title="Supprimer"
            className="hover:text-red-600"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <span className="sr-only">{activity}</span>
    </div>
  );
}
