import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { ElectionKindSchema, TurnoutClassSchema } from '../bundle/common.ts';
import type { ElectionKind, TurnoutClass } from './turnout-class.ts';

describe('turnout unions', () => {
  it('the unions equal the bundle schemas', () => {
    expectTypeOf<TurnoutClass>().toEqualTypeOf<z.infer<typeof TurnoutClassSchema>>();
    expectTypeOf<ElectionKind>().toEqualTypeOf<z.infer<typeof ElectionKindSchema>>();
    expect(TurnoutClassSchema.options).toHaveLength(9);
    expect(ElectionKindSchema.options).toHaveLength(5);
  });
});
