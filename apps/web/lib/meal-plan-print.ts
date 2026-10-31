import type { MealPlanEntry } from '@familyhub/contracts';

import { getLocale, localeTag, t } from './i18n';

const printStyles = `
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: black; }
  body { font-family: Arial, sans-serif; }
  .sheet {
    width: 148.5mm;
    height: 210mm;
    padding: 8mm;
    display: flex;
    flex-direction: column;
  }
  h1 { margin: 0 0 2mm; font-size: 23pt; line-height: 1.15; }
  .dates { margin: 0 0 5mm; font-size: 11pt; }
  table {
    display: grid;
    grid-template-columns: 26mm repeat(2, minmax(0, 1fr));
    grid-template-rows: 11mm repeat(7, minmax(0, 1fr));
    flex: 1;
    min-height: 0;
    border-top: 0.3mm solid black;
    border-left: 0.3mm solid black;
  }
  thead, tbody, tr { display: contents; }
  th, td {
    min-width: 0;
    min-height: 0;
    padding: 2mm;
    border-right: 0.3mm solid black;
    border-bottom: 0.3mm solid black;
    display: flex;
    align-items: center;
    overflow-wrap: anywhere;
  }
  thead th { justify-content: center; font-size: 15pt; }
  tbody th { flex-direction: column; align-items: flex-start; justify-content: center; }
  .weekday { font-size: 12pt; text-transform: capitalize; }
  .day-date { margin-top: 1.5mm; font-size: 11pt; font-weight: normal; }
  .meals { width: 100%; font-size: 14pt; line-height: 1.2; font-weight: 600; }
  .meal + .meal { margin-top: 2mm; }
`;

/** Prints an A5 portrait plan on the left half of an A4 landscape sheet. */
export async function printMealPlan(days: Date[], entries: MealPlanEntry[]) {
  // Keep printing separate from the app layout, including mobile and dark mode.
  document.getElementById('meal-plan-print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'meal-plan-print-frame';
  frame.title = t('Imprimer le planning repas');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:297mm;height:210mm;border:0;';

  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${printStyles}</style></head><body></body></html>`;
      document.body.append(frame);
    });
    const printWindow = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!printWindow || !doc) throw new Error(t('Impression indisponible.'));

    doc.documentElement.lang = getLocale();
    doc.title = t('Planning repas');
    function element<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      text = '',
      className = '',
    ) {
      const node = doc!.createElement(tag);
      node.textContent = text;
      node.className = className;
      return node;
    }

    const sheet = element('main', '', 'sheet');
    sheet.append(element('h1', t('Planning repas')));
    const formatDate = (date: Date) =>
      new Intl.DateTimeFormat(localeTag(), {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(date);
    sheet.append(
      element(
        'p',
        `${formatDate(days[0]!)} – ${formatDate(days[6]!)}`,
        'dates',
      ),
    );
    const table = element('table');
    table.setAttribute('aria-label', t('Planning repas'));
    const head = element('thead');
    const headings = element('tr');
    for (const label of ['Jour', 'Midi', 'Soir']) {
      const heading = element('th', t(label));
      heading.scope = 'col';
      headings.append(heading);
    }
    head.append(headings);
    table.append(head);
    const body = element('tbody');
    for (const day of days) {
      const row = element('tr');
      const heading = element('th');
      heading.scope = 'row';
      heading.append(
        element(
          'span',
          new Intl.DateTimeFormat(localeTag(), { weekday: 'long' }).format(day),
          'weekday',
        ),
        element(
          'span',
          new Intl.DateTimeFormat(localeTag(), {
            day: 'numeric',
            month: '2-digit',
          }).format(day),
          'day-date',
        ),
      );
      row.append(heading);
      const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      for (const slot of ['LUNCH', 'DINNER'] as const) {
        const cell = element('td');
        const meals = element('div', '', 'meals');
        for (const entry of entries.filter(
          (entry) => entry.date === date && entry.slot === slot,
        )) {
          meals.append(element('div', entry.mealName, 'meal'));
        }
        cell.append(meals);
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    sheet.append(table);
    doc.body.append(sheet);

    await doc.fonts.ready;
    await new Promise<void>((resolve) =>
      printWindow.requestAnimationFrame(() => resolve()),
    );
    // Preserve large text normally, and shrink only crowded cells to fit the A5.
    for (const meals of doc.querySelectorAll<HTMLElement>('.meals')) {
      const cell = meals.parentElement!;
      const style = printWindow.getComputedStyle(cell);
      const availableHeight =
        cell.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      let fontSize = 14;
      while (
        meals.getBoundingClientRect().height > availableHeight &&
        fontSize > 1
      ) {
        fontSize -= 0.5;
        meals.style.fontSize = `${fontSize}pt`;
      }
    }

    printWindow.addEventListener(
      'afterprint',
      () => {
        window.setTimeout(() => frame.remove(), 0);
      },
      { once: true },
    );
    printWindow.focus();
    printWindow.print();
  } catch (reason) {
    frame.remove();
    throw reason;
  }
}
