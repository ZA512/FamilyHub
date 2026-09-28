const ONE_HOUR = 60 * 60 * 1000;

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function defaultAgendaEndValue(
  startValue: string,
  allDay: boolean,
): string {
  if (!startValue) return '';
  if (allDay) return startValue.slice(0, 10);
  const start = validDate(startValue);
  return start ? localDateTimeValue(new Date(start.getTime() + ONE_HOUR)) : '';
}

export function agendaDateRange(
  startValue: string,
  endValue: string,
  allDay: boolean,
): { startAt: string; endAt: string } {
  if (!startValue || !endValue) throw new Error('Indiquez le début et la fin.');

  const start = validDate(
    allDay ? `${startValue.slice(0, 10)}T00:00:00` : startValue,
  );
  const end = validDate(
    allDay ? `${endValue.slice(0, 10)}T00:00:00` : endValue,
  );
  if (!start || !end) throw new Error('Vérifiez les dates saisies.');

  if (allDay) end.setDate(end.getDate() + 1);
  if (end.getTime() <= start.getTime())
    throw new Error('La fin doit suivre le début.');

  return { startAt: start.toISOString(), endAt: end.toISOString() };
}
