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
      bodyStorage:
        'The buckets hold {{value}} GB, projected to cost {{projected}} a month, over the threshold of {{threshold}} a month.',
      bodyUploadGrowth:
        'Uploads in the last 24 hours came to {{value}} GB, projected at {{projected}} GB a month, over the threshold of {{threshold}} GB a month.',
      bodyEmailMonth:
        '{{value}} emails were sent so far this month (UTC), projected at {{projected}} for the month, at or over the threshold of {{threshold}} emails a month.',
      bodyEmailDay:
        '{{value}} emails were sent yesterday (UTC), at or over the threshold of {{threshold}} emails a day.',
      bodySigninCeiling:
        '{{value}} sign-in code emails were sent in one UTC day, at or over the threshold of {{threshold}} a day.',
    },
  },
} as const;
