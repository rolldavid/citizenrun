// The terms of the U.S. House and Senate, each cited to the Constitution and grounded like a
// template quote (PIPE-known-bodies), and the Senate classes' election years.
import type { RunContext } from '../lib/runner.ts';
import type { CitedNode } from '../templates/cited.ts';
import { groundCited } from '../templates/ground.ts';
import type { GroundedMark } from '../templates/ground.ts';

export const HOUSE_TERM: CitedNode & { readonly value: 2 } = {
  value: 2,
  source_url: 'https://www.archives.gov/founding-docs/constitution-transcript',
  quote:
    'The House of Representatives shall be composed of Members chosen every second Year by the People of the several States',
  citation: 'U.S. Constitution, Article I, Section 2',
};

export const SENATE_TERM: CitedNode & { readonly value: 6 } = {
  value: 6,
  source_url: 'https://www.archives.gov/founding-docs/amendments-11-27',
  quote:
    'The Senate of the United States shall be composed of two Senators from each State, elected by the people thereof, for six years',
  citation: 'U.S. Constitution, Amendment XVII',
};

/**
 * A year of each Senate class's regular election; each class is elected again every six years.
 * U.S. Constitution, Article I, Section 3 divides the Senate into three classes elected in turn.
 */
export const SENATE_CLASS_FIRST = { 1: 2024, 2: 2026, 3: 2028 } as const;

export const FEDERAL_PATHS = {
  house: 'federal.house_term',
  senate: 'federal.senate_term',
} as const;

export type FederalMarks = { readonly house: GroundedMark; readonly senate: GroundedMark };

const grounded = new WeakMap<RunContext, Promise<FederalMarks>>();

const UNCHECKED: GroundedMark = {
  grounded: false,
  checked_at: null,
  text_sha256: null,
  reason: 'fetch_error',
};

/**
 * Grounds both quotes against their pages once per run. A page that cannot be fetched (the
 * Archives is a `crawl` host, refused during the working day) leaves its term ungrounded, never
 * a failure.
 */
export function groundFederalTerms(ctx: RunContext): Promise<FederalMarks> {
  let marks = grounded.get(ctx);
  if (marks === undefined) {
    marks = (async () => {
      const result = await groundCited(
        ctx,
        [
          { path: FEDERAL_PATHS.house, node: HOUSE_TERM },
          { path: FEDERAL_PATHS.senate, node: SENATE_TERM },
        ],
        { state: null, previous: null },
      );
      return {
        house: result[FEDERAL_PATHS.house] ?? UNCHECKED,
        senate: result[FEDERAL_PATHS.senate] ?? UNCHECKED,
      };
    })();
    grounded.set(ctx, marks);
  }
  return marks;
}
