export const notifications = {
  email: {
    footerOps: 'Operational alert for the {{appName}} {{env}} environment.',
    footerAddress: '{{appName}}, {{postalAddress}}',
  },
  emailSigninMethod: {
    subject: 'A sign-in method was added to your {{appName}} account',
    bodyApple: 'Sign in with Apple was added to your account on {{date}}.',
    bodyGoogle: 'Sign in with Google was added to your account on {{date}}.',
    bodyEmail: 'Sign-in with an email code was added to your account on {{date}}.',
    notYou: "If this wasn't you, email {{supportEmail}} right away.",
  },
  emailAccountDeleted: {
    subject: 'Your {{appName}} account has been deleted',
    body: 'Your account, posts, messages and other data have been deleted.',
    retained:
      'We keep only what the law or our policy requires: reports you filed with your name removed, moderation records, and material preserved under a legal hold. Backups age out within 27 days.',
  },
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
    dbSizeHigh: {
      subject: '[{{appName}} {{env}}] The database passed 15 GB',
      body: 'The database is {{gb}} GB, {{pct}} of the volume.',
    },
    bundleStale: {
      subject: '[{{appName}} {{env}}] No new data bundle for {{hoursSince}} hours',
      body: 'No full data bundle has loaded for {{hoursSince}} hours. Check the pipeline workflows.',
    },
    bundleRejected: {
      subject: '[{{appName}} {{env}}] Bundle {{version}} rejected',
      body: 'Bundle {{version}} failed the gate {{gate}}. The last good data stays loaded.',
    },
    bundleHeld: {
      subject: '[{{appName}} {{env}}] Bundle {{version}} waits for approval',
      body: 'Bundle {{version}} crossed a hold threshold. Approve or reject it in the Bundles screen.',
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
      bodyGeocoding:
        '{{value}} geocoding requests were made so far this month (UTC), projected at {{projected}} for the month, at or over the threshold of {{threshold}} requests a month.',
      bodyGeocodingDay:
        '{{value}} geocoding requests were made yesterday (UTC), at or over the threshold of {{threshold}} requests a day.',
    },
  },
} as const;
