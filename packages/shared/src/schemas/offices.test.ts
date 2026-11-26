import { describe, expect, it } from 'vitest';
import {
  GetOfficeParamsSchema,
  GetOfficeQuerySchema,
  ListOfficeCandidatesQuerySchema,
  OfficeIdParamsSchema,
} from './offices.ts';
import { GetPersonParamsSchema } from './people.ts';

describe('office request schemas', () => {
  it('an id or slug of 200 characters parses and 201 does not', () => {
    for (const schema of [GetOfficeParamsSchema, GetPersonParamsSchema]) {
      expect(schema.safeParse({ idOrSlug: 'a'.repeat(200) }).success).toBe(true);
      expect(schema.safeParse({ idOrSlug: 'a'.repeat(201) }).success).toBe(false);
      expect(schema.safeParse({ idOrSlug: '' }).success).toBe(false);
    }
  });

  it('an unknown issue id is refused', () => {
    expect(GetOfficeQuerySchema.safeParse({ issue: 'climate' }).success).toBe(true);
    expect(GetOfficeQuerySchema.safeParse({}).success).toBe(true);
    expect(GetOfficeQuerySchema.safeParse({ issue: 'fixture-unknown' }).success).toBe(false);
  });

  it('the candidate page limit defaults to 20', () => {
    expect(ListOfficeCandidatesQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(ListOfficeCandidatesQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(ListOfficeCandidatesQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(ListOfficeCandidatesQuerySchema.safeParse({ electionId: 'nope' }).success).toBe(false);
  });

  it('an office id is a uuid', () => {
    expect(
      OfficeIdParamsSchema.safeParse({ id: '0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60' }).success,
    ).toBe(true);
    expect(OfficeIdParamsSchema.safeParse({ id: 'fixture-office' }).success).toBe(false);
  });
});
