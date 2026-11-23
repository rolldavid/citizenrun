import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';
import { COST_LINES } from './cost-lines.ts';
import type { CostLine, CostLineResult } from './cost-lines.ts';

// One cost_projection email a day per line.
const COST_PROJECTION_THROTTLE_SECONDS = 86_400;

/**
 * J-cost.check over `lines` (default COST_LINES): computes every line first, so an error in any of
 * them is thrown before an alert is sent, then raises `cost_projection` for each line over its
 * threshold (D-405).
 */
export function createCostCheckJob(
  lines: readonly CostLine[] = COST_LINES,
): JobDefinition<'cost.check'> {
  return {
    name: 'cost.check',
    queue: QUEUE_OPTIONS['cost.check'].queue,
    work: QUEUE_OPTIONS['cost.check'].work,
    async handle(_payload, ctx) {
      const results: CostLineResult[] = [];
      for (const line of lines) {
        results.push(await line.compute(ctx));
        await ctx.touch();
      }
      let alerts = 0;
      for (const result of results) {
        if (!result.over) {
          continue;
        }
        const id = await ctx.enqueue(
          'ops.alert',
          {
            kind: 'cost_projection',
            values: {
              line: result.line,
              value: result.value,
              projected: result.projected,
              threshold: result.threshold,
            },
          },
          {
            throttle: {
              seconds: COST_PROJECTION_THROTTLE_SECONDS,
              key: `cost:${result.line}`,
            },
          },
        );
        // A null id is a throttled send: this line already alerted today.
        if (id !== null) {
          alerts += 1;
        }
      }
      ctx.log.info('cost.check.done', { lines: results.length, alerts });
    },
  };
}

/** J-cost.check with every line. */
export const costCheckJob: JobDefinition<'cost.check'> = createCostCheckJob(COST_LINES);
