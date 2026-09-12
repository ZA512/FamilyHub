import { useEffect, useState } from 'react';
import {
  Bookmark,
  ChevronRight,
  ChefHat,
  LoaderCircle,
  LibraryBig,
  NotebookText,
  Search,
  CheckSquare2,
  CalendarDays,
  ChartBar,
  ContactRound,
  FileText,
  Lightbulb,
  ShoppingBasket,
  Users,
  X,
} from 'lucide-react';

import type { SearchResult } from '@familyhub/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SearchViewProps = {
  onNavigate: (
    view:
      | 'members'
      | 'shopping'
      | 'tasks'
      | 'agenda'
      | 'meals'
      | 'bookmarks'
      | 'pages'
      | 'collections'
      | 'polls'
      | 'ideas'
      | 'contacts'
      | 'documents',
  ) => void;
};

export function SearchView({ onNavigate }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [error, setError] = useState<{
    query: string;
    message: string;
  } | null>(null);
  const normalizedQuery = query.trim();
  const searchComplete = searchedQuery === normalizedQuery;
  const currentError = error?.query === normalizedQuery ? error.message : '';

  useEffect(() => {
    if (normalizedQuery.length < 2) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch(`/api/v1/search?q=${encodeURIComponent(normalizedQuery)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error('La recherche est momentanément indisponible.');
          return (await response.json()) as { results: SearchResult[] };
        })
        .then((payload) => {
          setResults(payload.results);
          setSearchedQuery(normalizedQuery);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setError({
            query: normalizedQuery,
            message:
              reason instanceof Error
                ? reason.message
                : 'Recherche impossible.',
          });
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [normalizedQuery]);

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-6">
        <p className="mb-1 text-sm font-medium text-[#087f72]">Tout le foyer</p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
          Recherche
        </h1>
      </div>

      <div className="relative mb-6">
        <Label htmlFor="global-search" className="sr-only">
          Rechercher dans le foyer
        </Label>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="global-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          maxLength={100}
          placeholder="Une tâche, un membre, un article de courses…"
          className="h-12 rounded-2xl bg-card pl-12 pr-12 text-base shadow-sm"
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Effacer la recherche"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-xl"
          >
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <div
        aria-live="polite"
        aria-busy={normalizedQuery.length >= 2 && !searchComplete}
      >
        {normalizedQuery.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Saisissez au moins deux caractères. Seuls les contenus auxquels vous
            avez accès sont recherchés.
          </p>
        ) : currentError ? (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {currentError}
          </p>
        ) : !searchComplete ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Recherche en cours…
            </CardContent>
          </Card>
        ) : results.length ? (
          <Card className="gap-0 overflow-hidden py-0">
            {results.map((result, index) => (
              <button
                key={`${result.type}:${result.id}`}
                type="button"
                onClick={() => onNavigate(result.view)}
                className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/45 ${index ? 'border-t' : ''}`}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7f5f2] text-[#087f72]">
                  {result.type === 'member' ? (
                    <Users className="size-4" aria-hidden="true" />
                  ) : result.type === 'task' ? (
                    <CheckSquare2 className="size-4" aria-hidden="true" />
                  ) : result.type === 'agenda' ? (
                    <CalendarDays className="size-4" aria-hidden="true" />
                  ) : result.type === 'meal' ? (
                    <ChefHat className="size-4" aria-hidden="true" />
                  ) : result.type === 'bookmark' ? (
                    <Bookmark className="size-4" aria-hidden="true" />
                  ) : result.type === 'page' ? (
                    <NotebookText className="size-4" aria-hidden="true" />
                  ) : result.type === 'collection' ? (
                    <LibraryBig className="size-4" aria-hidden="true" />
                  ) : result.type === 'poll' ? (
                    <ChartBar className="size-4" aria-hidden="true" />
                  ) : result.type === 'idea' ? (
                    <Lightbulb className="size-4" aria-hidden="true" />
                  ) : result.type === 'contact' ? (
                    <ContactRound className="size-4" aria-hidden="true" />
                  ) : result.type === 'document' ? (
                    <FileText className="size-4" aria-hidden="true" />
                  ) : (
                    <ShoppingBasket className="size-4" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{result.title}</span>
                    <Badge variant="outline">
                      {result.type === 'member'
                        ? 'Membre'
                        : result.type === 'task'
                          ? 'Tâche'
                          : result.type === 'agenda'
                            ? 'Agenda'
                            : result.type === 'meal'
                              ? 'Repas'
                              : result.type === 'bookmark'
                                ? 'Bookmark'
                                : result.type === 'page'
                                  ? 'Page'
                                  : result.type === 'collection'
                                    ? 'Collection'
                                    : result.type === 'poll'
                                      ? 'Sondage'
                                      : result.type === 'idea'
                                        ? 'Idée'
                                        : result.type === 'contact'
                                          ? 'Contact'
                                          : result.type === 'document'
                                            ? 'Document'
                                            : 'Courses'}
                    </Badge>
                  </span>
                  {result.description ? (
                    <span className="mt-1 block truncate text-sm text-muted-foreground">
                      {result.description}
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            ))}
          </Card>
        ) : (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#e7f5f2] text-[#087f72]">
                <Search aria-hidden="true" />
              </span>
              <h2 className="font-semibold">Aucun résultat</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Essayez une autre tâche, un autre prénom ou un autre article.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
