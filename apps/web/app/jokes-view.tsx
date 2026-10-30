import { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Smile,
} from 'lucide-react';
import type {
  AdminJoke,
  AdminJokesResponse,
  JokeModerationResponse,
} from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

const pageSize = 20;
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('fr');

export function JokesView({ csrfToken }: { csrfToken: string }) {
  const [data, setData] = useState<AdminJokesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/admin/jokes', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Impossible de charger les blagues.');
        return (await response.json()) as AdminJokesResponse;
      })
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Impossible de charger les blagues.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  async function toggle(joke: AdminJoke) {
    setPendingId(joke.id);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/v1/admin/jokes/${joke.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ enabled: !joke.enabled }),
      });
      if (!response.ok) throw new Error('Impossible de modifier cette blague.');
      const payload = (await response.json()) as JokeModerationResponse;
      setData((current) =>
        current
          ? {
              jokes: current.jokes.map((item) =>
                item.id === payload.joke.id ? payload.joke : item,
              ),
              dailyJoke: payload.dailyJoke,
            }
          : current,
      );
      setNotice(
        joke.enabled
          ? 'Blague désactivée pour tout le foyer.'
          : 'Blague réactivée pour le foyer.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Impossible de modifier cette blague.',
      );
    } finally {
      setPendingId(null);
    }
  }

  const categories = [
    ...new Set(data?.jokes.map((joke) => joke.category) ?? []),
  ].sort((a, b) => a.localeCompare(b, 'fr'));
  const activeCount = data?.jokes.filter((joke) => joke.enabled).length ?? 0;
  const filtered =
    data?.jokes.filter(
      (joke) =>
        (category === 'ALL' || joke.category === category) &&
        (status === 'ALL' || (status === 'ENABLED') === joke.enabled) &&
        normalize(joke.text).includes(normalize(query.trim())),
    ) ?? [];
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const today = data?.dailyJoke;
  const todayEntry = today
    ? data?.jokes.find((joke) => joke.id === today.id)
    : undefined;

  function toggleButton(joke: AdminJoke) {
    return (
      <Button
        variant={joke.enabled ? 'outline' : 'secondary'}
        size="sm"
        disabled={pendingId !== null || loading || !csrfToken}
        onClick={() => void toggle(joke)}
      >
        {pendingId === joke.id ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : joke.enabled ? (
          <Ban aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        {joke.enabled ? 'Désactiver' : 'Réactiver'}
      </Button>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Administration
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Gestion des blagues
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Choisissez les blagues qui peuvent être affichées aux membres du
            foyer. Les blagues désactivées peuvent être réactivées à tout
            moment.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading || pendingId !== null}
          onClick={() => {
            setLoading(true);
            setReload((value) => value + 1);
          }}
        >
          <RefreshCw aria-hidden="true" />
          Actualiser
        </Button>
      </header>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <output className="block rounded-xl bg-primary/10 p-4 text-sm">
          {notice}
        </output>
      ) : null}
      {loading ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Chargement des blagues…
        </p>
      ) : null}
      {data ? (
        <>
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Smile className="size-5 text-primary" aria-hidden="true" />
                  La blague du jour
                </h2>
                {todayEntry ? toggleButton(todayEntry) : null}
              </div>
              {today ? (
                <>
                  <Badge variant="secondary" lang="fr">
                    {today.category}
                  </Badge>
                  <p
                    className="whitespace-pre-wrap break-words text-sm leading-relaxed"
                    lang="fr"
                  >
                    {today.text}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Aucune blague active. Réactivez une blague pour rétablir la
                  blague du jour.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Désactiver la blague du jour la remplace automatiquement par une
                autre blague active.
              </p>
            </CardContent>
          </Card>
          <section aria-labelledby="joke-catalog-title" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="joke-catalog-title" className="text-lg font-semibold">
                Catalogue des blagues
              </h2>
              <p className="text-sm text-muted-foreground">
                {activeCount} actives · {data.jokes.length - activeCount}{' '}
                désactivées
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div className="space-y-2">
                <Label htmlFor="joke-search">Rechercher une blague</Label>
                <Input
                  id="joke-search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Un mot dans la blague…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="joke-category">Catégorie</Label>
                <NativeSelect
                  id="joke-category"
                  className="w-full"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setPage(1);
                  }}
                >
                  <NativeSelectOption value="ALL">
                    Toutes les catégories
                  </NativeSelectOption>
                  {categories.map((item) => (
                    <NativeSelectOption key={item} value={item}>
                      {item}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="joke-status">État</Label>
                <NativeSelect
                  id="joke-status"
                  className="w-full"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <NativeSelectOption value="ALL">
                    Toutes les blagues
                  </NativeSelectOption>
                  <NativeSelectOption value="ENABLED">
                    Actives
                  </NativeSelectOption>
                  <NativeSelectOption value="DISABLED">
                    Désactivées
                  </NativeSelectOption>
                </NativeSelect>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
            </p>
            <div className="space-y-3">
              {filtered
                .slice((currentPage - 1) * pageSize, currentPage * pageSize)
                .map((joke) => (
                  <Card
                    key={joke.id}
                    className={joke.enabled ? '' : 'border-dashed bg-muted/30'}
                  >
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" lang="fr">
                          {joke.category}
                        </Badge>
                        <Badge variant="outline">
                          {joke.enabled ? 'Active' : 'Désactivée'}
                        </Badge>
                        {today?.id === joke.id ? (
                          <Badge>Aujourd’hui</Badge>
                        ) : null}
                        <div className="ml-auto">{toggleButton(joke)}</div>
                      </div>
                      <p
                        className="whitespace-pre-wrap break-words text-sm leading-relaxed"
                        lang="fr"
                      >
                        {joke.text}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              {!filtered.length ? (
                <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Aucune blague ne correspond à ces filtres.
                </p>
              ) : null}
            </div>
            <nav
              aria-label="Pagination des blagues"
              className="flex items-center justify-between gap-3"
            >
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Précédent
              </Button>
              <span className="text-sm text-muted-foreground">
                {currentPage} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Suivant
                <ChevronRight aria-hidden="true" />
              </Button>
            </nav>
          </section>
        </>
      ) : null}
    </div>
  );
}
