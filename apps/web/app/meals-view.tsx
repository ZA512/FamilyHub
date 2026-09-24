import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { localeTag, t } from '@/lib/i18n';
import { useDeviceViewMode } from '@/lib/device-view-mode';
import {
  CalendarPlus,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Heart,
  LayoutGrid,
  List,
  LoaderCircle,
  Lock,
  Minus,
  Pencil,
  Plus,
  Search,
  ShoppingBasket,
  ThumbsDown,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import type {
  FamilyMeal,
  InstanceSettings,
  MealPlanEntry,
  MealPreference,
  MealListMember,
  MealSlot,
  ModuleConfig,
  WeekStartsOn,
} from '@familyhub/contracts';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  readMealPlanCache,
  readMealsCache,
  writeMealPlanCache,
  writeMealsCache,
} from '@/lib/offline-storage';
import { normalizeWeekStartsOn, startOfMealWeek } from '@/lib/meal-week';
import {
  filterMeals,
  mealPreferenceFor,
  type MealPreferenceFilter,
} from '@/lib/meal-library';

type MealsViewProps = {
  currentMemberId: string;
  instanceId: string;
  role: 'ADMIN' | 'MEMBER';
  csrfToken: string;
  composerOpen: boolean;
  onComposerOpenChange: (open: boolean) => void;
};

type IngredientDraft = {
  key: string;
  name: string;
  quantity: string;
  unit: string;
};

const emptyIngredient = (): IngredientDraft => ({
  key: crypto.randomUUID(),
  name: '',
  quantity: '',
  unit: '',
});

const slotLabels: Record<MealSlot, string> = {
  LUNCH: 'Déjeuner',
  DINNER: 'Dîner',
  OTHER: 'Autre',
};

export function MealsView({
  currentMemberId,
  instanceId,
  role,
  csrfToken,
  composerOpen,
  onComposerOpenChange,
}: MealsViewProps) {
  const sessionKey = `${instanceId}:${currentMemberId}`;
  const [meals, setMeals] = useState<FamilyMeal[]>([]);
  const [members, setMembers] = useState<MealListMember[]>([]);
  const [entries, setEntries] = useState<MealPlanEntry[]>([]);
  const [shoppingEnabled, setShoppingEnabled] = useState(true);
  const [weekStartsOn, setWeekStartsOn] = useState<WeekStartsOn>(1);
  const [mealReferencePortions, setMealReferencePortions] = useState(4);
  const [weekStart, setWeekStart] = useState(() =>
    startOfMealWeek(new Date(), 1),
  );
  const [weekSettingsLoaded, setWeekSettingsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [planLoading, setPlanLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingMeal, setEditingMeal] = useState<FamilyMeal | null>(null);
  const [mealToDelete, setMealToDelete] = useState<FamilyMeal | null>(null);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([
    emptyIngredient(),
  ]);
  const [visibility, setVisibility] = useState<'PRIVATE' | 'ALL_MEMBERS'>(
    'ALL_MEMBERS',
  );
  const [planOpen, setPlanOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MealPlanEntry | null>(null);
  const [planDate, setPlanDate] = useState(toDateInput(new Date()));
  const [planMealId, setPlanMealId] = useState('');
  const [planSlot, setPlanSlot] = useState<MealSlot>('DINNER');
  const [shoppingMeal, setShoppingMeal] = useState<FamilyMeal | null>(null);
  const [shoppingPortions, setShoppingPortions] = useState(
    mealReferencePortions,
  );
  const [selectedIngredients, setSelectedIngredients] = useState<Set<string>>(
    new Set(),
  );
  const [libraryView, setLibraryView] = useDeviceViewMode(
    currentMemberId,
    'meals',
    'list',
  );
  const [mealQuery, setMealQuery] = useState('');
  const [memberFilter, setMemberFilter] = useState('all');
  const [preferenceFilter, setPreferenceFilter] =
    useState<MealPreferenceFilter>('all');

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const filteredMeals = useMemo(() => {
    return filterMeals(meals, members, {
      query: mealQuery,
      memberId: memberFilter,
      preference: preferenceFilter,
    });
  }, [mealQuery, meals, memberFilter, members, preferenceFilter]);
  const ingredientSuggestions = useMemo(
    () =>
      [
        ...new Set(
          meals.flatMap((meal) =>
            meal.ingredients.map((ingredient) => ingredient.name),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b, localeTag())),
    [meals],
  );
  const unitSuggestions = useMemo(
    () =>
      [
        ...new Set(
          meals.flatMap((meal) =>
            meal.ingredients.map((ingredient) => ingredient.unit),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b, localeTag())),
    [meals],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function loadMeals() {
      const cached = await readMealsCache(sessionKey).catch(() => null);
      if (controller.signal.aborted) return;
      if (cached) {
        setMeals(cached.meals);
        setMembers(cached.members);
        setShoppingEnabled(cached.shoppingEnabled);
      }
      try {
        const [mealsResponse, modulesResponse, settingsResponse] =
          await Promise.all([
            fetch('/api/v1/meals', { signal: controller.signal }),
            fetch('/api/v1/modules', { signal: controller.signal }),
            fetch('/api/v1/instance-settings', { signal: controller.signal }),
          ]);
        const settingsPayload = settingsResponse.ok
          ? ((await settingsResponse.json()) as { settings: InstanceSettings })
          : null;
        const firstDay = normalizeWeekStartsOn(
          settingsPayload?.settings.mealPlanWeekStartsOn,
        );
        setWeekStartsOn(firstDay);
        if (settingsPayload)
          setMealReferencePortions(
            settingsPayload.settings.mealReferencePortions,
          );
        setWeekStart(startOfMealWeek(new Date(), firstDay));
        if (!mealsResponse.ok)
          throw new Error('Impossible de charger les plats.');
        const mealsPayload = (await mealsResponse.json()) as {
          meals: FamilyMeal[];
          members: MealListMember[];
        };
        const modulesPayload = modulesResponse.ok
          ? ((await modulesResponse.json()) as { modules: ModuleConfig[] })
          : { modules: [] };
        const shopping =
          modulesPayload.modules.find((module) => module.key === 'shopping')
            ?.enabled ?? false;
        setMeals(mealsPayload.meals);
        setMembers(mealsPayload.members);
        setShoppingEnabled(shopping);
        await writeMealsCache(
          sessionKey,
          mealsPayload.meals,
          mealsPayload.members,
          shopping,
        ).catch(() => undefined);
        setError('');
      } catch (reason) {
        if (!controller.signal.aborted && !cached) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Les repas sont indisponibles.',
          );
        } else if (!controller.signal.aborted) {
          setError(
            'Plats affichés depuis cet appareil · lecture seule hors connexion.',
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setWeekSettingsLoaded(true);
        }
      }
    }
    void loadMeals();
    return () => controller.abort();
  }, [sessionKey]);

  useEffect(() => {
    if (!weekSettingsLoaded) return;
    const controller = new AbortController();
    const start = toDateInput(weekStart);
    const end = toDateInput(addDays(weekStart, 6));
    async function loadPlan() {
      setPlanLoading(true);
      const cached = await readMealPlanCache(sessionKey, start, end).catch(
        () => null,
      );
      if (controller.signal.aborted) return;
      if (cached) setEntries(cached);
      try {
        const response = await fetch(
          `/api/v1/meal-plan?start=${start}&end=${end}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error('Impossible de charger le planning des repas.');
        const payload = (await response.json()) as {
          entries: MealPlanEntry[];
        };
        setEntries(payload.entries);
        await writeMealPlanCache(sessionKey, start, end, payload.entries).catch(
          () => undefined,
        );
      } catch (reason) {
        if (!controller.signal.aborted && !cached) {
          setError(
            reason instanceof Error ? reason.message : 'Planning indisponible.',
          );
        }
      } finally {
        if (!controller.signal.aborted) setPlanLoading(false);
      }
    }
    void loadPlan();
    return () => controller.abort();
  }, [sessionKey, weekSettingsLoaded, weekStart]);

  useEffect(() => {
    if (!loading) {
      void writeMealsCache(sessionKey, meals, members, shoppingEnabled).catch(
        () => undefined,
      );
    }
  }, [loading, meals, members, sessionKey, shoppingEnabled]);

  useEffect(() => {
    if (!planLoading) {
      const start = toDateInput(weekStart);
      const end = toDateInput(addDays(weekStart, 6));
      void writeMealPlanCache(sessionKey, start, end, entries).catch(
        () => undefined,
      );
    }
  }, [entries, planLoading, sessionKey, weekStart]);

  function resetMealComposer() {
    setEditingMeal(null);
    setIngredients([emptyIngredient()]);
    setVisibility('ALL_MEMBERS');
  }

  function openMealEditor(meal?: FamilyMeal) {
    if (meal) {
      setEditingMeal(meal);
      setIngredients(
        meal.ingredients.map((ingredient) => ({
          key: ingredient.id,
          name: ingredient.name,
          quantity: String(ingredient.quantity),
          unit: ingredient.unit,
        })),
      );
      setVisibility(meal.visibility);
    } else {
      resetMealComposer();
    }
    onComposerOpenChange(true);
  }

  async function saveMeal(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tagsEntry = data.get('tags');
    const payload = {
      name: data.get('name'),
      description: data.get('description'),
      photoUrl: data.get('photoUrl') || null,
      referencePortions: Number(data.get('referencePortions')),
      ingredients: ingredients.map(({ name, quantity, unit }) => ({
        name,
        quantity: Number(quantity),
        unit,
      })),
      instructions: data.get('instructions'),
      tags: (typeof tagsEntry === 'string' ? tagsEntry : '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      comments: data.get('comments'),
      visibility,
      ...(editingMeal ? {} : { clientMutationId: crypto.randomUUID() }),
    };
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        editingMeal ? `/api/v1/meals/${editingMeal.id}` : '/api/v1/meals',
        {
          method: editingMeal ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok)
        throw new Error(
          await mealError(response, 'Enregistrement impossible.'),
        );
      const result = (await response.json()) as { meal: FamilyMeal };
      setMeals((current) =>
        editingMeal
          ? current.map((meal) =>
              meal.id === result.meal.id ? result.meal : meal,
            )
          : [...current, result.meal].sort((a, b) =>
              a.name.localeCompare(b.name, localeTag()),
            ),
      );
      onComposerOpenChange(false);
      resetMealComposer();
      setNotice(
        editingMeal ? 'Plat mis à jour.' : 'Plat ajouté à la bibliothèque.',
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Enregistrement impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function setPreference(meal: FamilyMeal, value: MealPreference) {
    setBusyId(meal.id);
    setError('');
    try {
      const response = await fetch(`/api/v1/meals/${meal.id}/preference`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ value }),
      });
      if (!response.ok)
        throw new Error('La préférence n’a pas pu être enregistrée.');
      const payload = (await response.json()) as { meal: FamilyMeal };
      replaceMeal(payload.meal);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Modification impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  function openPlan(
    date: Date,
    entry?: MealPlanEntry,
    preferredMealId?: string,
  ) {
    setEditingEntry(entry ?? null);
    setPlanDate(entry?.date ?? toDateInput(date));
    setPlanMealId(entry?.mealId ?? preferredMealId ?? meals[0]?.id ?? '');
    setPlanSlot(entry?.slot ?? 'DINNER');
    setPlanOpen(true);
  }

  async function savePlan(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        editingEntry
          ? `/api/v1/meal-plan/${editingEntry.id}`
          : '/api/v1/meal-plan',
        {
          method: editingEntry ? 'PUT' : 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            mealId: planMealId,
            date: planDate,
            slot: planSlot,
            slotLabel: planSlot === 'OTHER' ? data.get('slotLabel') : null,
            portions: Number(data.get('portions')),
            note: data.get('note'),
            ...(editingEntry ? {} : { clientMutationId: crypto.randomUUID() }),
          }),
        },
      );
      if (!response.ok) throw new Error('Le repas n’a pas pu être planifié.');
      const payload = (await response.json()) as { entry: MealPlanEntry };
      setEntries((current) =>
        editingEntry
          ? current.map((entry) =>
              entry.id === payload.entry.id ? payload.entry : entry,
            )
          : [...current, payload.entry],
      );
      setPlanOpen(false);
      setEditingEntry(null);
      setNotice('Planning mis à jour.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Planification impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function deletePlan(entry: MealPlanEntry) {
    setBusyId(entry.id);
    try {
      const response = await fetch(`/api/v1/meal-plan/${entry.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('Suppression impossible.');
      setEntries((current) =>
        current.filter((candidate) => candidate.id !== entry.id),
      );
      setPlanOpen(false);
      setEditingEntry(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  function openShoppingDialog(
    meal: FamilyMeal,
    portions = meal.referencePortions,
  ) {
    setShoppingMeal(meal);
    setShoppingPortions(portions);
    setSelectedIngredients(
      new Set(meal.ingredients.map((ingredient) => ingredient.id)),
    );
  }

  async function addToShopping() {
    if (!shoppingMeal || !selectedIngredients.size) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(
        `/api/v1/meals/${shoppingMeal.id}/to-shopping-list`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({
            portions: shoppingPortions,
            items: [...selectedIngredients].map((ingredientId) => ({
              ingredientId,
              clientMutationId: crypto.randomUUID(),
            })),
          }),
        },
      );
      if (!response.ok) throw new Error('Ajout aux courses impossible.');
      const payload = (await response.json()) as { addedCount: number };
      setShoppingMeal(null);
      setNotice(
        `${payload.addedCount} ingrédient${payload.addedCount > 1 ? 's ajoutés' : ' ajouté'} aux courses.`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Ajout aux courses impossible.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteMeal() {
    if (!mealToDelete) return;
    setBusyId(mealToDelete.id);
    try {
      const response = await fetch(`/api/v1/meals/${mealToDelete.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('Suppression impossible.');
      setMeals((current) =>
        current.filter((meal) => meal.id !== mealToDelete.id),
      );
      setEntries((current) =>
        current.filter((entry) => entry.mealId !== mealToDelete.id),
      );
      setMealToDelete(null);
      setNotice('Plat supprimé.');
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Suppression impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  function replaceMeal(meal: FamilyMeal) {
    setMeals((current) =>
      current.map((candidate) => (candidate.id === meal.id ? meal : candidate)),
    );
  }

  return (
    <>
      <MealComposer
        open={composerOpen}
        meal={editingMeal}
        ingredients={ingredients}
        ingredientSuggestions={ingredientSuggestions}
        unitSuggestions={unitSuggestions}
        defaultPortions={mealReferencePortions}
        visibility={visibility}
        submitting={submitting}
        error={error}
        onOpenChange={(open) => {
          onComposerOpenChange(open);
          if (!open) resetMealComposer();
        }}
        onIngredientsChange={setIngredients}
        onVisibilityChange={setVisibility}
        onSubmit={saveMeal}
      />

      <PlanDialog
        open={planOpen}
        entry={editingEntry}
        meals={meals}
        defaultPortions={mealReferencePortions}
        date={planDate}
        mealId={planMealId}
        slot={planSlot}
        submitting={submitting}
        busy={Boolean(busyId)}
        onOpenChange={setPlanOpen}
        onDateChange={setPlanDate}
        onMealChange={setPlanMealId}
        onSlotChange={setPlanSlot}
        onSubmit={savePlan}
        onDelete={() => editingEntry && deletePlan(editingEntry)}
      />

      <ShoppingDialog
        meal={shoppingMeal}
        portions={shoppingPortions}
        selected={selectedIngredients}
        submitting={submitting}
        onOpenChange={(open) => !open && setShoppingMeal(null)}
        onPortionsChange={setShoppingPortions}
        onSelectedChange={setSelectedIngredients}
        onSubmit={addToShopping}
      />

      <AlertDialog
        open={Boolean(mealToDelete)}
        onOpenChange={(open) => !open && setMealToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce plat ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le plat et ses occurrences planifiées seront supprimés. Cette
              action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={deleteMeal} disabled={Boolean(busyId)}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-sm font-medium text-primary">À table</p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              Repas
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              Planifiez la semaine et transformez les ingrédients en liste de
              courses.
            </p>
          </div>
          <Button
            onClick={() => openMealEditor()}
            className="rounded-xl bg-primary hover:bg-primary/80"
          >
            <Plus aria-hidden="true" /> Ajouter un plat
          </Button>
        </div>

        {error && !composerOpen && !planOpen && !shoppingMeal ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <span>{notice}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Fermer"
              onClick={() => setNotice('')}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        <Tabs defaultValue="planning">
          <TabsList className="mb-4 h-10 rounded-xl">
            <TabsTrigger value="planning">Planning</TabsTrigger>
            <TabsTrigger value="library">Plats ({meals.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="planning">
            <Planner
              days={weekDays}
              entries={entries}
              loading={planLoading || loading}
              hasMeals={Boolean(meals.length)}
              shoppingEnabled={shoppingEnabled}
              onPrevious={() => setWeekStart(addDays(weekStart, -7))}
              onNext={() => setWeekStart(addDays(weekStart, 7))}
              onToday={() =>
                setWeekStart(startOfMealWeek(new Date(), weekStartsOn))
              }
              onAdd={openPlan}
              onEdit={(entry) => openPlan(parseDate(entry.date), entry)}
              onShopping={(entry) => {
                const meal = meals.find(
                  (candidate) => candidate.id === entry.mealId,
                );
                if (meal) openShoppingDialog(meal, entry.portions);
              }}
            />
          </TabsContent>
          <TabsContent value="library">
            {loading ? (
              <Card>
                <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
                  <LoaderCircle className="animate-spin" /> Chargement des
                  plats…
                </CardContent>
              </Card>
            ) : meals.length ? (
              <>
                <MealLibraryToolbar
                  query={mealQuery}
                  memberFilter={memberFilter}
                  preferenceFilter={preferenceFilter}
                  members={members}
                  view={libraryView}
                  visibleCount={filteredMeals.length}
                  totalCount={meals.length}
                  onQueryChange={setMealQuery}
                  onMemberFilterChange={setMemberFilter}
                  onPreferenceFilterChange={setPreferenceFilter}
                  onViewChange={setLibraryView}
                  onReset={() => {
                    setMealQuery('');
                    setMemberFilter('all');
                    setPreferenceFilter('all');
                  }}
                />
                {filteredMeals.length ? (
                  libraryView === 'list' ? (
                    <MealList
                      meals={filteredMeals}
                      members={members}
                      currentMemberId={currentMemberId}
                      busyId={busyId}
                      shoppingEnabled={shoppingEnabled}
                      onPreference={setPreference}
                      onEdit={openMealEditor}
                      onDelete={setMealToDelete}
                      onShopping={(meal) => openShoppingDialog(meal)}
                      onPlan={(meal) =>
                        openPlan(new Date(), undefined, meal.id)
                      }
                    />
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      {filteredMeals.map((meal) => (
                        <MealCard
                          key={meal.id}
                          meal={meal}
                          currentMemberId={currentMemberId}
                          role={role}
                          busy={busyId === meal.id}
                          shoppingEnabled={shoppingEnabled}
                          onPreference={(value) => setPreference(meal, value)}
                          onEdit={() => openMealEditor(meal)}
                          onDelete={() => setMealToDelete(meal)}
                          onShopping={() => openShoppingDialog(meal)}
                          onPlan={() =>
                            openPlan(new Date(), undefined, meal.id)
                          }
                        />
                      ))}
                    </div>
                  )
                ) : (
                  <Card className="border-dashed bg-muted/20">
                    <CardContent className="py-10 text-center">
                      <h2 className="font-semibold">Aucun plat trouvé</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Modifiez la recherche ou les filtres pour afficher
                        d’autres plats.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4"
                        onClick={() => {
                          setMealQuery('');
                          setMemberFilter('all');
                          setPreferenceFilter('all');
                        }}
                      >
                        Réinitialiser les filtres
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="border-dashed bg-muted/20">
                <CardContent className="flex flex-col items-center py-12 text-center">
                  <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#fff0dc] text-[#b86210]">
                    <ChefHat />
                  </span>
                  <h2 className="font-semibold">Aucun plat enregistré</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Ajoutez un premier plat avec ses ingrédients pour commencer
                    à planifier.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </section>
    </>
  );
}

function Planner({
  days,
  entries,
  loading,
  hasMeals,
  shoppingEnabled,
  onPrevious,
  onNext,
  onToday,
  onAdd,
  onEdit,
  onShopping,
}: {
  days: Date[];
  entries: MealPlanEntry[];
  loading: boolean;
  hasMeals: boolean;
  shoppingEnabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onAdd: (date: Date) => void;
  onEdit: (entry: MealPlanEntry) => void;
  onShopping: (entry: MealPlanEntry) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">
            Semaine du {formatDay(days[0]!, true)}
          </h2>
          <p className="text-sm text-muted-foreground">
            Déjeuners, dîners et autres moments du foyer
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Semaine précédente"
            onClick={onPrevious}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={onToday}>
            Aujourd’hui
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Semaine suivante"
            onClick={onNext}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
            <LoaderCircle className="animate-spin" /> Chargement du planning…
          </CardContent>
        </Card>
      ) : !hasMeals ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="py-10 text-center text-muted-foreground">
            Ajoutez d’abord un plat pour pouvoir le planifier.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((day) => {
            const date = toDateInput(day);
            const dayEntries = entries.filter((entry) => entry.date === date);
            const today = date === toDateInput(new Date());
            return (
              <Card
                key={date}
                className={`gap-3 py-3 ${today ? 'border-primary bg-accent/45' : ''}`}
              >
                <CardContent className="px-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {formatWeekday(day)}
                      </p>
                      <p className="font-semibold">{formatDay(day)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Planifier le ${formatDay(day, true)}`}
                      onClick={() => onAdd(day)}
                    >
                      <Plus />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {dayEntries.length ? (
                      dayEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="rounded-xl border bg-background p-2.5"
                        >
                          <button
                            className="w-full text-left"
                            onClick={() => onEdit(entry)}
                          >
                            <span className="block text-xs font-medium text-primary">
                              {entry.slot === 'OTHER'
                                ? entry.slotLabel
                                : slotLabels[entry.slot]}
                            </span>
                            <span className="mt-0.5 block text-sm font-semibold leading-tight">
                              {entry.mealName}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {entry.portions} portion
                              {entry.portions > 1 ? 's' : ''}
                            </span>
                          </button>
                          {shoppingEnabled ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-1 h-7 w-full text-xs"
                              onClick={() => onShopping(entry)}
                            >
                              <ShoppingBasket /> Courses
                            </Button>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <button
                        onClick={() => onAdd(day)}
                        className="w-full rounded-xl border border-dashed px-2 py-4 text-xs text-muted-foreground hover:bg-muted/45"
                      >
                        À planifier
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MealLibraryToolbar({
  query,
  memberFilter,
  preferenceFilter,
  members,
  view,
  visibleCount,
  totalCount,
  onQueryChange,
  onMemberFilterChange,
  onPreferenceFilterChange,
  onViewChange,
  onReset,
}: {
  query: string;
  memberFilter: string;
  preferenceFilter: MealPreferenceFilter;
  members: MealListMember[];
  view: 'list' | 'cards';
  visibleCount: number;
  totalCount: number;
  onQueryChange: (value: string) => void;
  onMemberFilterChange: (value: string) => void;
  onPreferenceFilterChange: (value: MealPreferenceFilter) => void;
  onViewChange: (value: 'list' | 'cards') => void;
  onReset: () => void;
}) {
  const filtered = Boolean(
    query || memberFilter !== 'all' || preferenceFilter !== 'all',
  );

  return (
    <div className="mb-4 rounded-xl border bg-card p-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(10rem,14rem)_minmax(10rem,14rem)_auto]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Rechercher un plat ou un ingrédient…"
            aria-label="Rechercher par titre ou ingrédient"
            className="pl-9"
          />
        </div>
        <Select
          value={memberFilter}
          onValueChange={(value) => {
            if (value !== null) onMemberFilterChange(String(value));
          }}
        >
          <SelectTrigger className="w-full" aria-label="Filtrer par membre">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les membres</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.firstName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={preferenceFilter}
          onValueChange={(value) => {
            if (value !== null)
              onPreferenceFilterChange(String(value) as MealPreferenceFilter);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Filtrer par avis">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les avis</SelectItem>
            <SelectItem value="1">Adore</SelectItem>
            <SelectItem value="0">Neutre</SelectItem>
            <SelectItem value="-1">N’aime pas</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            size="sm"
            variant={view === 'list' ? 'secondary' : 'ghost'}
            aria-label="Vue en liste"
            aria-pressed={view === 'list'}
            onClick={() => onViewChange('list')}
          >
            <List aria-hidden="true" /> Liste
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'cards' ? 'secondary' : 'ghost'}
            aria-label="Vue en cartes"
            aria-pressed={view === 'cards'}
            onClick={() => onViewChange('cards')}
          >
            <LayoutGrid aria-hidden="true" /> Cartes
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {t('{0} résultats sur {1}', {
            0: visibleCount,
            1: totalCount,
          })}
        </span>
        {filtered ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            <X aria-hidden="true" /> Réinitialiser les filtres
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function MealList({
  meals,
  members,
  currentMemberId,
  busyId,
  shoppingEnabled,
  onPreference,
  onEdit,
  onDelete,
  onShopping,
  onPlan,
}: {
  meals: FamilyMeal[];
  members: MealListMember[];
  currentMemberId: string;
  busyId: string | null;
  shoppingEnabled: boolean;
  onPreference: (meal: FamilyMeal, value: MealPreference) => void;
  onEdit: (meal: FamilyMeal) => void;
  onDelete: (meal: FamilyMeal) => void;
  onShopping: (meal: FamilyMeal) => void;
  onPlan: (meal: FamilyMeal) => void;
}) {
  const otherMembers = members.filter(
    (member) => member.id !== currentMemberId,
  );

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <TooltipProvider delay={350}>
        <Table className="min-w-max">
          <TableHeader className="bg-muted/35">
            <TableRow>
              <TableHead className="sticky left-0 z-10 min-w-56 bg-muted/95 px-4">
                Recette
              </TableHead>
              <TableHead className="text-center">Mon avis</TableHead>
              {otherMembers.map((member) => (
                <TableHead key={member.id} className="min-w-20 text-center">
                  {member.firstName}
                </TableHead>
              ))}
              <TableHead className="px-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meals.map((meal) => {
              const ownPreference = mealPreferenceFor(meal, currentMemberId);
              return (
                <TableRow key={meal.id} className="group">
                  <TableCell className="sticky left-0 z-10 bg-card px-4 group-hover:bg-muted/50">
                    <div className="flex items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#fff0dc] text-[#b86210]">
                        <ChefHat className="size-4" aria-hidden="true" />
                      </span>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`Aperçu de ${meal.name}`}
                              className="max-w-56 truncate text-left font-semibold underline-offset-4 hover:text-primary hover:underline focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          }
                        >
                          {meal.name}
                        </TooltipTrigger>
                        <TooltipContent
                          side="right"
                          align="start"
                          sideOffset={10}
                          className="block w-96 max-w-[calc(100vw-2rem)] rounded-xl bg-popover p-0 text-popover-foreground shadow-xl ring-1 ring-foreground/10"
                        >
                          <MealPreview meal={meal} />
                        </TooltipContent>
                      </Tooltip>
                      {meal.visibility === 'PRIVATE' ? (
                        <Lock
                          className="size-3.5 text-muted-foreground"
                          aria-label="Privé"
                        />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <MealPreferenceButtons
                      value={ownPreference}
                      busy={busyId === meal.id}
                      onChange={(value) => onPreference(meal, value)}
                    />
                  </TableCell>
                  {otherMembers.map((member) => (
                    <TableCell key={member.id} className="text-center">
                      <MealPreferenceIndicator
                        memberName={member.firstName}
                        value={mealPreferenceFor(meal, member.id)}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="px-4">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        onClick={() => onPlan(meal)}
                        className="bg-primary hover:bg-primary/80"
                      >
                        <CalendarPlus aria-hidden="true" /> Planifier
                      </Button>
                      {shoppingEnabled ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onShopping(meal)}
                        >
                          <ShoppingBasket aria-hidden="true" /> Courses
                        </Button>
                      ) : null}
                      {meal.editable ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onEdit(meal)}
                          >
                            <Pencil aria-hidden="true" /> Modifier
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => onDelete(meal)}
                          >
                            <Trash2 aria-hidden="true" /> Supprimer
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TooltipProvider>
    </Card>
  );
}

function MealPreferenceButtons({
  value,
  busy,
  onChange,
}: {
  value: MealPreference;
  busy: boolean;
  onChange: (value: MealPreference) => void;
}) {
  return (
    <div className="flex justify-center gap-1">
      <Button
        variant={value === 1 ? 'default' : 'outline'}
        size="icon-sm"
        aria-label="J’adore"
        disabled={busy}
        onClick={() => onChange(value === 1 ? 0 : 1)}
        className={value === 1 ? 'bg-rose-500 hover:bg-rose-600' : ''}
      >
        <Heart aria-hidden="true" />
      </Button>
      <Button
        variant={value === -1 ? 'destructive' : 'outline'}
        size="icon-sm"
        aria-label="Je n’aime pas"
        disabled={busy}
        onClick={() => onChange(value === -1 ? 0 : -1)}
      >
        <ThumbsDown aria-hidden="true" />
      </Button>
    </div>
  );
}

function MealPreferenceIndicator({
  memberName,
  value,
}: {
  memberName: string;
  value: MealPreference;
}) {
  const label =
    value === 1
      ? t('{0} adore', { 0: memberName })
      : value === -1
        ? t('{0} n’aime pas', { 0: memberName })
        : t('{0} est neutre', { 0: memberName });
  return (
    <span
      title={label}
      className="inline-flex size-8 items-center justify-center rounded-lg bg-muted/50"
    >
      {value === 1 ? (
        <Heart
          className="size-4 fill-rose-500 text-rose-500"
          aria-hidden="true"
        />
      ) : value === -1 ? (
        <ThumbsDown className="size-4 text-destructive" aria-hidden="true" />
      ) : (
        <Minus className="size-4 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function MealPreview({ meal }: { meal: FamilyMeal }) {
  return (
    <div className="overflow-hidden rounded-xl">
      {meal.photoUrl ? (
        // Images are user-provided URLs; a build-time image optimizer cannot resolve them.
        // oxlint-disable-next-line next/no-img-element
        <img
          src={meal.photoUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-32 w-full object-cover"
        />
      ) : null}
      <div className="p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">{meal.name}</h3>
          {meal.visibility === 'PRIVATE' ? (
            <Badge variant="outline">
              <Lock aria-hidden="true" /> Privé
            </Badge>
          ) : null}
        </div>
        {meal.description ? (
          <p className="mt-1 whitespace-normal text-sm text-muted-foreground">
            {meal.description}
          </p>
        ) : null}
        <p className="mt-3 text-sm font-medium">
          {meal.ingredients.length} ingrédient
          {meal.ingredients.length > 1 ? 's' : ''} · {meal.referencePortions}{' '}
          portions
        </p>
        <ul className="mt-2 grid gap-1 whitespace-normal text-sm text-muted-foreground sm:grid-cols-2">
          {meal.ingredients.map((ingredient) => (
            <li key={ingredient.id}>
              {formatNumber(ingredient.quantity)} {ingredient.unit} ·{' '}
              {ingredient.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MealCard({
  meal,
  currentMemberId,
  busy,
  shoppingEnabled,
  onPreference,
  onEdit,
  onDelete,
  onShopping,
  onPlan,
}: {
  meal: FamilyMeal;
  currentMemberId: string;
  role: 'ADMIN' | 'MEMBER';
  busy: boolean;
  shoppingEnabled: boolean;
  onPreference: (value: MealPreference) => void;
  onEdit: () => void;
  onDelete: () => void;
  onShopping: () => void;
  onPlan: () => void;
}) {
  const ownPreference =
    meal.preferences.find((entry) => entry.memberId === currentMemberId)
      ?.value ?? 0;
  return (
    <Card className="overflow-hidden py-0">
      {meal.photoUrl ? (
        // Images are user-provided URLs; a build-time image optimizer cannot resolve them.
        // oxlint-disable-next-line next/no-img-element
        <img
          src={meal.photoUrl}
          alt={`Présentation de ${meal.name}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-40 w-full object-cover"
        />
      ) : null}
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fff0dc] text-[#b86210]">
            <ChefHat />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{meal.name}</h2>
              {meal.visibility === 'PRIVATE' ? (
                <Badge variant="outline">
                  <Lock /> Privé
                </Badge>
              ) : null}
            </div>
            {meal.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {meal.description}
              </p>
            ) : null}
          </div>
        </div>
        {meal.tags.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {meal.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="mt-4 rounded-xl bg-muted/45 p-3">
          <p className="mb-2 text-sm font-medium">
            {meal.ingredients.length} ingrédient
            {meal.ingredients.length > 1 ? 's' : ''} · {meal.referencePortions}{' '}
            portions
          </p>
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {meal.ingredients.map((ingredient) => (
              <li key={ingredient.id}>
                {formatNumber(ingredient.quantity)} {ingredient.unit} ·{' '}
                {ingredient.name}
              </li>
            ))}
          </ul>
        </div>
        {meal.instructions ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium">
              Instructions
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {meal.instructions}
            </p>
          </details>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm text-muted-foreground">Mon avis</span>
          <Button
            variant={ownPreference === 1 ? 'default' : 'outline'}
            size="icon-sm"
            aria-label="J’adore"
            disabled={busy}
            onClick={() => onPreference(ownPreference === 1 ? 0 : 1)}
            className={
              ownPreference === 1 ? 'bg-rose-500 hover:bg-rose-600' : ''
            }
          >
            <Heart />
          </Button>
          <Button
            variant={ownPreference === -1 ? 'destructive' : 'outline'}
            size="icon-sm"
            aria-label="Je n’aime pas"
            disabled={busy}
            onClick={() => onPreference(ownPreference === -1 ? 0 : -1)}
          >
            <ThumbsDown />
          </Button>
          {meal.preferences.filter((entry) => entry.value !== 0).length ? (
            <span className="text-xs text-muted-foreground">
              {meal.preferences
                .filter((entry) => entry.value === 1)
                .map((entry) => entry.memberName)
                .join(', ') || 'Personne'}{' '}
              adore
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          <Button
            size="sm"
            onClick={onPlan}
            className="bg-primary hover:bg-primary/80"
          >
            <CalendarPlus /> Planifier
          </Button>
          {shoppingEnabled ? (
            <Button size="sm" variant="outline" onClick={onShopping}>
              <ShoppingBasket /> Courses
            </Button>
          ) : null}
          {meal.editable ? (
            <>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                <Pencil /> Modifier
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={onDelete}
              >
                <Trash2 /> Supprimer
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MealComposer({
  open,
  meal,
  ingredients,
  ingredientSuggestions,
  unitSuggestions,
  defaultPortions,
  visibility,
  submitting,
  error,
  onOpenChange,
  onIngredientsChange,
  onVisibilityChange,
  onSubmit,
}: {
  open: boolean;
  meal: FamilyMeal | null;
  ingredients: IngredientDraft[];
  ingredientSuggestions: string[];
  unitSuggestions: string[];
  defaultPortions: number;
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
  submitting: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onIngredientsChange: (ingredients: IngredientDraft[]) => void;
  onVisibilityChange: (value: 'PRIVATE' | 'ALL_MEMBERS') => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  function updateIngredient(
    key: string,
    field: keyof IngredientDraft,
    value: string,
  ) {
    onIngredientsChange(
      ingredients.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, [field]: value } : ingredient,
      ),
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {meal ? 'Modifier le plat' : 'Nouveau plat'}
          </DialogTitle>
          <DialogDescription>
            Décrivez le plat et les quantités pour les portions de référence.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <Field
              label="Nom"
              name="name"
              defaultValue={meal?.name}
              maxLength={160}
              placeholder="Curry de pois chiches"
            />
            <Field
              label="Portions de référence"
              name="referencePortions"
              type="number"
              min={1}
              max={100}
              key={meal?.id ?? `new-${defaultPortions}`}
              defaultValue={meal?.referencePortions ?? defaultPortions}
            />
          </div>
          <TextField
            label="Description"
            name="description"
            defaultValue={meal?.description ?? ''}
            maxLength={2000}
            placeholder="Un plat rapide pour le soir…"
          />
          <Field
            label="Adresse de la photo (facultatif)"
            name="photoUrl"
            type="url"
            defaultValue={meal?.photoUrl ?? ''}
            maxLength={2000}
            placeholder="https://…"
            required={false}
          />
          <fieldset className="space-y-3 rounded-2xl border p-4">
            <legend className="px-1 text-sm font-semibold">Ingrédients</legend>
            <datalist id="meal-ingredient-suggestions">
              {ingredientSuggestions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </datalist>
            <datalist id="meal-unit-suggestions">
              {unitSuggestions.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </datalist>
            {ingredients.map((ingredient, index) => (
              <div
                key={ingredient.key}
                className="grid grid-cols-[1fr_90px_90px_auto] gap-2"
              >
                <Input
                  aria-label={`Ingrédient ${index + 1}`}
                  value={ingredient.name}
                  list="meal-ingredient-suggestions"
                  onChange={(event) =>
                    updateIngredient(ingredient.key, 'name', event.target.value)
                  }
                  required
                  maxLength={120}
                  placeholder="Pois chiches"
                />
                <Input
                  aria-label={`Quantité ${index + 1}`}
                  type="number"
                  step="any"
                  min="0.001"
                  max="100000"
                  value={ingredient.quantity}
                  onChange={(event) =>
                    updateIngredient(
                      ingredient.key,
                      'quantity',
                      event.target.value,
                    )
                  }
                  required
                  placeholder="400"
                />
                <Input
                  aria-label={`Unité ${index + 1}`}
                  value={ingredient.unit}
                  list="meal-unit-suggestions"
                  onChange={(event) =>
                    updateIngredient(ingredient.key, 'unit', event.target.value)
                  }
                  required
                  maxLength={40}
                  placeholder="g"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Retirer l’ingrédient ${index + 1}`}
                  disabled={ingredients.length === 1}
                  onClick={() =>
                    onIngredientsChange(
                      ingredients.filter(
                        (candidate) => candidate.key !== ingredient.key,
                      ),
                    )
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onIngredientsChange([...ingredients, emptyIngredient()])
              }
            >
              <Plus /> Ajouter un ingrédient
            </Button>
          </fieldset>
          <TextField
            label="Instructions"
            name="instructions"
            defaultValue={meal?.instructions ?? ''}
            maxLength={10000}
            placeholder="Étapes de préparation…"
          />
          <Field
            label="Tags, séparés par des virgules"
            name="tags"
            defaultValue={meal?.tags.join(', ') ?? ''}
            maxLength={800}
            placeholder="Rapide, végétarien"
            required={false}
          />
          <TextField
            label="Commentaires"
            name="comments"
            defaultValue={meal?.comments ?? ''}
            maxLength={2000}
            placeholder="Variantes ou remarques du foyer…"
          />
          <div className="space-y-2">
            <Label>Visibilité</Label>
            <Select
              value={visibility}
              onValueChange={(value) =>
                onVisibilityChange(value as 'PRIVATE' | 'ALL_MEMBERS')
              }
            >
              <SelectTrigger className="h-11 w-full rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL_MEMBERS">
                  <Users /> Tout le foyer
                </SelectItem>
                <SelectItem value="PRIVATE">
                  <Lock /> Moi uniquement
                </SelectItem>
              </SelectContent>
            </Select>
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
              <LoaderCircle className="animate-spin" />
            ) : (
              <ChefHat />
            )}{' '}
            {meal ? 'Enregistrer les modifications' : 'Ajouter le plat'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlanDialog({
  open,
  entry,
  meals,
  defaultPortions,
  date,
  mealId,
  slot,
  submitting,
  busy,
  onOpenChange,
  onDateChange,
  onMealChange,
  onSlotChange,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  entry: MealPlanEntry | null;
  meals: FamilyMeal[];
  defaultPortions: number;
  date: string;
  mealId: string;
  slot: MealSlot;
  submitting: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDateChange: (value: string) => void;
  onMealChange: (value: string) => void;
  onSlotChange: (value: MealSlot) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  onDelete: () => void;
}) {
  const readOnly = Boolean(entry && !entry.editable);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {entry ? 'Modifier le repas planifié' : 'Planifier un repas'}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? `Planifié par ${entry?.createdByName}.`
              : 'Choisissez un plat, un jour et le nombre de personnes.'}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label>Plat</Label>
            <Select
              value={mealId}
              disabled={readOnly}
              onValueChange={(value) => onMealChange(value ?? '')}
            >
              <SelectTrigger className="h-11 w-full rounded-xl">
                <SelectValue placeholder="Choisir un plat" />
              </SelectTrigger>
              <SelectContent>
                {meals.map((meal) => (
                  <SelectItem key={meal.id} value={meal.id}>
                    {meal.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="meal-plan-date">Date</Label>
              <Input
                id="meal-plan-date"
                type="date"
                value={date}
                disabled={readOnly}
                onChange={(event) => onDateChange(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Créneau</Label>
              <Select
                value={slot}
                disabled={readOnly}
                onValueChange={(value) => onSlotChange(value as MealSlot)}
              >
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LUNCH">Déjeuner</SelectItem>
                  <SelectItem value="DINNER">Dîner</SelectItem>
                  <SelectItem value="OTHER">Autre</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {slot === 'OTHER' ? (
            <Field
              label="Nom du créneau"
              name="slotLabel"
              defaultValue={entry?.slotLabel ?? ''}
              disabled={readOnly}
              maxLength={80}
              placeholder="Goûter"
            />
          ) : null}
          <Field
            label="Portions"
            name="portions"
            type="number"
            min={1}
            max={100}
            key={entry?.id ?? `new-${defaultPortions}`}
            defaultValue={entry?.portions ?? defaultPortions}
            disabled={readOnly}
          />
          <TextField
            label="Note"
            name="note"
            defaultValue={entry?.note ?? ''}
            maxLength={500}
            placeholder="Une précision pour ce repas…"
            disabled={readOnly}
          />
          <div className="flex gap-2">
            {!readOnly ? (
              <Button
                type="submit"
                disabled={submitting || !mealId}
                className="flex-1 bg-primary hover:bg-primary/80"
              >
                {submitting ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CalendarPlus />
                )}{' '}
                Enregistrer
              </Button>
            ) : null}
            {entry?.editable ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                disabled={busy}
                aria-label="Supprimer du planning"
                onClick={onDelete}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShoppingDialog({
  meal,
  portions,
  selected,
  submitting,
  onOpenChange,
  onPortionsChange,
  onSelectedChange,
  onSubmit,
}: {
  meal: FamilyMeal | null;
  portions: number;
  selected: Set<string>;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onPortionsChange: (value: number) => void;
  onSelectedChange: (value: Set<string>) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={Boolean(meal)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter aux courses</DialogTitle>
          <DialogDescription>
            Décochez ce que vous avez déjà. Les quantités seront adaptées.
          </DialogDescription>
        </DialogHeader>
        {meal ? (
          <div className="space-y-4">
            <Field
              label="Nombre de portions"
              name="shoppingPortions"
              type="number"
              min={1}
              max={100}
              value={portions}
              onChange={(event) => onPortionsChange(Number(event.target.value))}
            />
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border p-3">
              {meal.ingredients.map((ingredient) => {
                const checked = selected.has(ingredient.id);
                return (
                  <Label
                    key={ingredient.id}
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => {
                        const next = new Set(selected);
                        if (value) next.add(ingredient.id);
                        else next.delete(ingredient.id);
                        onSelectedChange(next);
                      }}
                    />
                    <span className="flex-1">{ingredient.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatNumber(
                        (ingredient.quantity * portions) /
                          meal.referencePortions,
                      )}{' '}
                      {ingredient.unit}
                    </span>
                  </Label>
                );
              })}
            </div>
            <Button
              className="w-full bg-primary hover:bg-primary/80"
              disabled={submitting || !selected.size}
              onClick={onSubmit}
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ShoppingBasket />
              )}{' '}
              Ajouter {selected.size} ingrédient{selected.size > 1 ? 's' : ''}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required = true,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; required?: boolean }) {
  const id = `meal-${String(props.name)}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        required={required}
        className="h-11 rounded-xl"
        {...props}
      />
    </div>
  );
}

function TextField({
  label,
  ...props
}: React.ComponentProps<typeof Textarea> & { label: string }) {
  const id = `meal-${String(props.name)}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} {...props} />
    </div>
  );
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

function formatDay(date: Date, long = false): string {
  return new Intl.DateTimeFormat(
    localeTag(),
    long
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'short' },
  ).format(date);
}

function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat(localeTag(), { weekday: 'short' }).format(
    date,
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(localeTag(), {
    maximumFractionDigits: 3,
  }).format(value);
}

async function mealError(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (payload.error === 'DUPLICATE_INGREDIENT')
    return 'Un ingrédient apparaît plusieurs fois.';
  if (payload.error === 'MEAL_ACTION_FORBIDDEN')
    return 'Vous ne pouvez pas modifier ce plat.';
  if (payload.error === 'INVALID_REQUEST')
    return 'Vérifiez le plat et ses ingrédients.';
  return fallback;
}
