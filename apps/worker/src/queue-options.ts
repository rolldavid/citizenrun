import { JOB_POLICIES } from '@citizenrun/shared';
import type { JobName } from '@citizenrun/shared';
import type { QueueOptions, WorkOptions } from './jobs/types.ts';

// Every queue: three attempts in all with backoff, finished jobs kept 24 hours, and a dead letter
// to ops.dead except on ops.dead itself (D-238). The policy is JOB_POLICIES's (D-827). The other
// values are tunable constants of the queue's job; a job file reads its row here, never from queues.ts.

/** Each queue's pg-boss queue options and work options. */
export const QUEUE_OPTIONS: {
  readonly [N in JobName]: { readonly queue: QueueOptions; readonly work: WorkOptions };
} = {
  'ops.dead': {
    queue: {
      policy: JOB_POLICIES['ops.dead'], // J-ops.dead
      retryLimit: 2, // D-238
      retryDelay: 60, // J-ops.dead
      retryBackoff: true, // D-238
      retryDelayMax: 600, // J-ops.dead
      expireInSeconds: 300, // J-ops.dead
      heartbeatSeconds: null, // J-ops.dead
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: null, // D-238: the dead-letter queue has none of its own
    },
    work: {
      localConcurrency: 1, // J-ops.dead
      pollingIntervalSeconds: 5, // J-ops.dead
    },
  },
  'ops.alert': {
    queue: {
      policy: JOB_POLICIES['ops.alert'], // J-ops.alert
      retryLimit: 2, // D-238
      retryDelay: 60, // J-ops.alert
      retryBackoff: true, // D-238
      retryDelayMax: 900, // J-ops.alert
      expireInSeconds: 120, // J-ops.alert
      heartbeatSeconds: null, // J-ops.alert
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: 'ops.dead', // D-238
    },
    work: {
      localConcurrency: 1, // J-ops.alert
      pollingIntervalSeconds: 5, // J-ops.alert
    },
  },
  'ops.heartbeat': {
    queue: {
      policy: JOB_POLICIES['ops.heartbeat'], // J-ops.heartbeat
      retryLimit: 2, // D-238
      retryDelay: 5, // J-ops.heartbeat
      retryBackoff: true, // D-238
      retryDelayMax: 30, // J-ops.heartbeat
      expireInSeconds: 30, // J-ops.heartbeat
      heartbeatSeconds: null, // J-ops.heartbeat
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: 'ops.dead', // D-238
    },
    work: {
      localConcurrency: 1, // J-ops.heartbeat
      pollingIntervalSeconds: 5, // J-ops.heartbeat
    },
  },
  'backup.check': {
    queue: {
      policy: JOB_POLICIES['backup.check'], // J-backup.check
      retryLimit: 2, // D-238
      retryDelay: 300, // J-backup.check
      retryBackoff: true, // D-238
      retryDelayMax: 3600, // J-backup.check
      expireInSeconds: 300, // J-backup.check
      heartbeatSeconds: null, // J-backup.check
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: 'ops.dead', // D-238
    },
    work: {
      localConcurrency: 1, // J-backup.check
      pollingIntervalSeconds: 10, // J-backup.check
    },
  },
  'db.connections-check': {
    queue: {
      policy: JOB_POLICIES['db.connections-check'], // J-db.connections-check
      retryLimit: 2, // D-238
      retryDelay: 300, // J-db.connections-check
      retryBackoff: true, // D-238
      retryDelayMax: 3600, // J-db.connections-check
      expireInSeconds: 120, // J-db.connections-check
      heartbeatSeconds: null, // J-db.connections-check
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: 'ops.dead', // D-238
    },
    work: {
      localConcurrency: 1, // J-db.connections-check
      pollingIntervalSeconds: 10, // J-db.connections-check
    },
  },
  'cost.check': {
    queue: {
      policy: JOB_POLICIES['cost.check'], // J-cost.check
      retryLimit: 2, // D-238
      retryDelay: 300, // J-cost.check
      retryBackoff: true, // D-238
      retryDelayMax: 3600, // J-cost.check
      expireInSeconds: 1800, // J-cost.check
      heartbeatSeconds: 60, // J-cost.check
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: 'ops.dead', // D-238
    },
    work: {
      localConcurrency: 1, // J-cost.check
      pollingIntervalSeconds: 10, // J-cost.check
    },
  },
  'account.delete': {
    queue: {
      policy: JOB_POLICIES['account.delete'], // J-account.delete
      retryLimit: 2, // D-238
      retryDelay: 60, // J-account.delete
      retryBackoff: true, // D-238
      retryDelayMax: 3600, // J-account.delete
      expireInSeconds: 3600, // J-account.delete
      heartbeatSeconds: 60, // J-account.delete
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: 'ops.dead', // D-238
    },
    work: {
      localConcurrency: 2, // J-account.delete
      pollingIntervalSeconds: 5, // J-account.delete
    },
  },
  'account.export': {
    queue: {
      policy: JOB_POLICIES['account.export'], // J-account.export
      retryLimit: 2, // D-238
      retryDelay: 60, // J-account.export
      retryBackoff: true, // D-238
      retryDelayMax: 1800, // J-account.export
      expireInSeconds: 1800, // J-account.export
      heartbeatSeconds: 60, // J-account.export
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: 'ops.dead', // D-238
    },
    work: {
      localConcurrency: 2, // J-account.export
      pollingIntervalSeconds: 5, // J-account.export
    },
  },
  'notify.email': {
    queue: {
      policy: JOB_POLICIES['notify.email'], // J-notify.email
      retryLimit: 2, // D-238
      retryDelay: 60, // J-notify.email
      retryBackoff: true, // D-238
      retryDelayMax: 1800, // J-notify.email
      expireInSeconds: 120, // J-notify.email
      heartbeatSeconds: null, // J-notify.email
      deleteAfterSeconds: 86400, // finished jobs kept 24 hours
      deadLetter: 'ops.dead', // D-238
    },
    work: {
      localConcurrency: 4, // J-notify.email
      pollingIntervalSeconds: 2, // J-notify.email
    },
  },
};
