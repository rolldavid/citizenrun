import type { Db } from '@citizenrun/db';
import { ID_CHUNK } from '@citizenrun/db/bundle';
import { sql } from 'drizzle-orm';
import { deferForCivicLock, withCivicLock } from '../../lib/civic-lock.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import { RetryableJobError } from '../types.ts';
import type { JobDefinition } from '../types.ts';

// J-score.issues: rebuilds office_issues from office_powers and issue_powers. An issue's relevance
// for an office is the highest relevance among the office's powers that move it.

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** 04's two statements in one transaction, for at most ID_CHUNK office ids. */
export async function rebuildOfficeIssues(db: Db, officeIds: readonly string[]): Promise<void> {
  const ids = sql`${sql.param([...officeIds])}::uuid[]`;
  await db.transaction(async (tx) => {
    // index: office_issues_pkey (office_id prefix)
    await tx.execute(sql`delete from office_issues where office_id = any(${ids})`);
    // index: office_powers_pkey (office_id prefix); issue_powers_power
    await tx.execute(
      sql`insert into office_issues (office_id, issue_id, relevance)
          select op.office_id, ip.issue_id, max(op.relevance)
          from office_powers op
          join issue_powers ip on ip.power_id = op.power_id
          where op.office_id = any(${ids})
          group by op.office_id, ip.issue_id`,
    );
  });
}

/** Walks the live offices by id, one transaction per chunk, touching after each; stops at shutdown. */
export async function rebuildAllOfficeIssues(
  db: Db,
  opts: { chunkSize: number; signal: AbortSignal; touch: () => Promise<void> },
): Promise<{ offices: number; chunks: number }> {
  let offices = 0;
  let chunks = 0;
  let after = NIL_UUID;
  for (;;) {
    if (opts.signal.aborted) {
      throw new RetryableJobError('shutdown');
    }
    // index: offices_pkey
    const rows = await db.execute<{ id: string }>(
      sql`select id from offices where retired_at is null and id > ${after}::uuid
          order by id
          limit ${opts.chunkSize}`,
      'objects',
    );
    const last = rows.at(-1);
    if (last === undefined) {
      break;
    }
    await rebuildOfficeIssues(
      db,
      rows.map((row) => row.id),
    );
    offices += rows.length;
    chunks += 1;
    await opts.touch();
    if (rows.length < opts.chunkSize) {
      break;
    }
    after = last.id;
  }
  return { offices, chunks };
}

export const scoreIssues: JobDefinition<'score.issues'> = {
  name: 'score.issues',
  queue: QUEUE_OPTIONS['score.issues'].queue,
  work: QUEUE_OPTIONS['score.issues'].work,
  async handle(payload, ctx) {
    const locked = await withCivicLock(ctx.db, async () => {
      if (payload.scope === 'offices') {
        await rebuildOfficeIssues(ctx.db, payload.officeIds);
        return { offices: payload.officeIds.length, chunks: 1 };
      }
      return rebuildAllOfficeIssues(ctx.db, {
        chunkSize: ID_CHUNK,
        signal: ctx.signal,
        touch: () => ctx.touch(),
      });
    });
    if (!locked.ran) {
      await deferForCivicLock(ctx, 'score.issues', payload);
      return;
    }
    ctx.log.info('score.issues.done', {
      scope: payload.scope,
      offices: locked.value.offices,
      chunks: locked.value.chunks,
    });
  },
};
