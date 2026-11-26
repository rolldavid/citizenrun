import { appEvents } from '@citizenrun/db';
import type { Db, Tx } from '@citizenrun/db';
import { APP_EVENT_NAMES } from '@citizenrun/shared';
import type { AppEventName } from '@citizenrun/shared';
import { z } from 'zod';
import type { Platform } from '../../middleware/session.ts';

// L-app-events: props hold small scalars only, never text a user typed.
const MAX_PROPS = 10;
const MAX_PROP_KEY_LENGTH = 64;
const MAX_PROP_STRING_LENGTH = 64;

const AppEventSchema = z.object({
  userId: z.uuid().nullable(),
  name: APP_EVENT_NAMES,
  props: z
    .record(
      z.string().min(1).max(MAX_PROP_KEY_LENGTH),
      z.union([z.string().max(MAX_PROP_STRING_LENGTH), z.number(), z.boolean(), z.null()]),
    )
    .refine((props) => Object.keys(props).length <= MAX_PROPS),
  platform: z.enum(['ios', 'android', 'web']).nullable(),
});

/** One product event: who, which, its small scalar props and the request's platform. */
export type AppEvent = {
  userId: string | null;
  name: AppEventName;
  props: Readonly<Record<string, string | number | boolean | null>>;
  platform: Platform | null;
};

/**
 * The API's one writer of `app_events` (L-app-events, D-470): parses the event and inserts one row
 * on `tx`, so it commits with the write it describes. Throws, writing nothing, on an event outside
 * the schema.
 */
export async function writeAppEvent(tx: Tx | Db, event: AppEvent): Promise<void> {
  const parsed = AppEventSchema.parse(event);
  await tx.insert(appEvents).values({
    userId: parsed.userId,
    name: parsed.name,
    props: parsed.props,
    platform: parsed.platform,
  });
}
