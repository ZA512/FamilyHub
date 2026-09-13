import { describe, expect, it } from 'vitest';

import {
  groupCreateSchema,
  groupUpdateSchema,
  memberAdministrationUpdateSchema,
} from './index.js';

describe('member group contracts', () => {
  it('normalise le nom et une description vide', () => {
    expect(groupCreateSchema.parse({ name: '  Parents  ', description: ' ' })).toEqual({
      name: 'Parents',
      description: null,
    });
  });

  it('refuse un groupe sans nom', () => {
    expect(() => groupCreateSchema.parse({ name: ' ' })).toThrow();
  });

  it('refuse une mise à jour vide', () => {
    expect(() => groupUpdateSchema.parse({})).toThrow();
  });

  it('accepte une mise à jour de description seule', () => {
    expect(groupUpdateSchema.parse({ description: '  Groupe temporaire  ' })).toEqual({
      description: 'Groupe temporaire',
    });
  });

  it('valide les changements administratifs de membre', () => {
    expect(memberAdministrationUpdateSchema.parse({ role: 'ADMIN' })).toEqual({
      role: 'ADMIN',
    });
    expect(memberAdministrationUpdateSchema.parse({ status: 'INACTIVE' })).toEqual({
      status: 'INACTIVE',
    });
    expect(memberAdministrationUpdateSchema.safeParse({}).success).toBe(false);
  });
});
