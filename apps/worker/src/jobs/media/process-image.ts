import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';
import { processAvatar } from './avatar.ts';

/**
 * J-media.process on the image queue (D-238): re-encodes one uploaded photo through the shared
 * photo function. Milestone 1 has the avatar target only.
 */
export const mediaProcessImage: JobDefinition<'media.process.image'> = {
  name: 'media.process.image',
  queue: QUEUE_OPTIONS['media.process.image'].queue,
  work: QUEUE_OPTIONS['media.process.image'].work,
  async handle(payload, ctx) {
    // One target so far, so there is nothing to switch on: a second member of the payload union
    // makes this call fail to compile until the handler switches on `payload.target`.
    return processAvatar(payload, ctx);
  },
};
