import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  Check,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShoppingBasket,
} from 'lucide-react';

import type { ShoppingItem } from '@familyhub/contracts';

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

type ShoppingViewProps = {
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

export function ShoppingView({
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: ShoppingViewProps) {
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/shopping-items', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Impossible de charger la liste de courses.');
        return (await response.json()) as { items: ShoppingItem[] };
      })
      .then((payload) => {
        setItems(payload.items);
        setError('');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : 'La liste est indisponible.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const pending = useMemo(
    () => items.filter((item) => !item.purchasedAt),
    [items],
  );
  const purchased = useMemo(
    () => items.filter((item) => item.purchasedAt),
    [items],
  );

  async function createItem(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch('/api/v1/shopping-items', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          name: data.get('name'),
          quantity: data.get('quantity'),
          note: data.get('note'),
          clientMutationId: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error('Impossible d’ajouter cet article.');
      const payload = (await response.json()) as { item: ShoppingItem };
      setItems((current) => [payload.item, ...current]);
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
    try {
      const response = await fetch(`/api/v1/shopping-items/${item.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ purchased: value }),
      });
      if (!response.ok)
        throw new Error('La modification n’a pas pu être enregistrée.');
      const payload = (await response.json()) as { item: ShoppingItem };
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === payload.item.id ? payload.item : candidate,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

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
              disabled={submitting || !csrfToken}
              className="w-full bg-[#087f72] hover:bg-[#076d63]"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              Ajouter à la liste
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
        <p className={`font-medium ${purchased ? 'line-through' : ''}`}>
          {item.name}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {[item.quantity, item.note, `Demandé par ${item.requestedByName}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  );
}
