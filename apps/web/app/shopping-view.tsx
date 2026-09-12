import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  Check,
  CloudOff,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  ShoppingBasket,
} from 'lucide-react';

import type { ShoppingItem, ShoppingItemCreate } from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  instanceId,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: ShoppingViewProps) {
  const sessionKey = `${instanceId}:${currentMemberId}`;
  const member = useMemo(
    () => ({ id: currentMemberId, firstName: currentMemberName }),
    [currentMemberId, currentMemberName],
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

  const pending = useMemo(
    () => items.filter((item) => !item.purchasedAt),
    [items],
  );
  const purchased = useMemo(
    () => items.filter((item) => item.purchasedAt),
    [items],
  );

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

  async function setPurchased(item: ShoppingItem, value: boolean) {
    setBusyId(item.id);
    setError('');
    const update = { purchased: value };
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
        return;
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
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
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
              className="w-full bg-[#087f72] hover:bg-[#076d63]"
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

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-medium text-[#087f72]">
              Liste commune
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Courses
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              {pending.length
                ? `${pending.length} article${pending.length > 1 ? 's' : ''} à acheter`
                : 'La liste est à jour'}
            </p>
          </div>
          <Button
            onClick={() => onComposerOpenChange(true)}
            className="rounded-xl bg-[#087f72] hover:bg-[#076d63]"
          >
            <Plus aria-hidden="true" />
            Ajouter un article
          </Button>
        </div>

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
        ) : pending.length ? (
          <Card className="gap-0 overflow-hidden py-0">
            {pending.map((item, index) => (
              <ShoppingRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                divided={index > 0}
                onToggle={() => setPurchased(item, true)}
              />
            ))}
          </Card>
        ) : (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
                <ShoppingBasket aria-hidden="true" />
              </span>
              <h2 className="font-semibold">Rien à acheter</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Ajoutez un article dès que quelqu’un pense à quelque chose.
              </p>
            </CardContent>
          </Card>
        )}

        {purchased.length ? (
          <section className="mt-8" aria-labelledby="purchased-title">
            <h2 id="purchased-title" className="mb-3 text-lg font-semibold">
              Déjà acheté
            </h2>
            <Card className="gap-0 overflow-hidden py-0 opacity-75">
              {purchased.map((item, index) => (
                <ShoppingRow
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  divided={index > 0}
                  onToggle={() => setPurchased(item, false)}
                />
              ))}
            </Card>
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
  onToggle,
}: {
  item: ShoppingItem;
  busy: boolean;
  divided: boolean;
  onToggle: () => void;
}) {
  const purchased = Boolean(item.purchasedAt);
  const local = item.id.startsWith('offline:');
  return (
    <div
      className={`flex items-center gap-3 px-4 py-4 ${divided ? 'border-t' : ''}`}
    >
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
        className={`shrink-0 rounded-xl ${purchased ? 'text-[#087f72]' : ''}`}
      >
        {busy ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : purchased ? (
          <RotateCcw aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-medium ${purchased ? 'line-through' : ''}`}>
            {item.name}
          </p>
          {local ? (
            <Badge variant="outline" className="text-amber-800">
              À synchroniser
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {[item.quantity, item.note, `Demandé par ${item.requestedByName}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  );
}
