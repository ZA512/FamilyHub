import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

describe('Select', () => {
  it('renders the selected option label instead of its raw value', () => {
    const markup = renderToStaticMarkup(
      <Select value="ALL">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">Toutes les catégories</SelectItem>
          <SelectItem value="PRIVATE">Moi uniquement</SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(markup).toContain('Toutes les catégories');
    expect(markup).not.toContain('>ALL<');
  });

  it('keeps rich option labels in the trigger', () => {
    const markup = renderToStaticMarkup(
      <Select value="EVENT">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="EVENT">
            <span>Événement</span>
          </SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(markup).toContain('<span>Événement</span>');
  });
});
