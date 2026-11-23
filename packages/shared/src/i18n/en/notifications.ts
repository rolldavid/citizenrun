export const notifications = {
  email: { footerOps: 'Operational alert for the {{appName}} {{env}} environment.' },
  opsAlert: {
    jobFailed: {
      subject: '[{{appName}} {{env}}] A job failed three times: {{queue}}',
      body: 'Job {{jobId}} on {{queue}} failed three times with {{errorClass}}. Further failures of this queue within the hour are not emailed.',
    },
    dumpStale: {
      subject: '[{{appName}} {{env}}] No recent database backup',
      body: 'The newest database dump is older than 36 hours or missing. Age in hours: {{hoursSinceNewest}}.',
    },
    connectionsHigh: {
      subject: '[{{appName}} {{env}}] Database connections at {{count}}',
      body: '{{count}} of {{max}} database connections are in use. The budget is in the infrastructure runbook.',
    },
    costProjection: {
      subject: '[{{appName}} {{env}}] Cost projection over threshold: {{line}}',
      body: '{{line}} is at {{value}} and projected at {{projected}}, over its threshold of {{threshold}}.',
    },
  },
} as const;
