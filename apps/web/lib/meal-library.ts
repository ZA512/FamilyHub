import type {
  FamilyMeal,
  MealListMember,
  MealPreference,
} from '@familyhub/contracts';

export type MealPreferenceFilter = 'all' | '-1' | '0' | '1';

export function mealPreferenceFor(
  meal: FamilyMeal,
  memberId: string,
): MealPreference {
  return (
    meal.preferences.find((entry) => entry.memberId === memberId)?.value ?? 0
  );
}

function normalizeMealSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

export function filterMeals(
  meals: FamilyMeal[],
  members: MealListMember[],
  filters: {
    query: string;
    memberId: string;
    preference: MealPreferenceFilter;
  },
): FamilyMeal[] {
  const query = normalizeMealSearch(filters.query);
  const preference =
    filters.preference === 'all' ? null : Number(filters.preference);
  const memberIds =
    filters.memberId === 'all'
      ? members.map((member) => member.id)
      : [filters.memberId];

  return meals.filter((meal) => {
    if (
      query &&
      !normalizeMealSearch(
        [
          meal.name,
          ...meal.ingredients.map((ingredient) => ingredient.name),
        ].join(' '),
      ).includes(query)
    ) {
      return false;
    }
    if (preference === null) return true;
    return memberIds.some(
      (memberId) => mealPreferenceFor(meal, memberId) === preference,
    );
  });
}
