export const hello = {
  documentTitle: 'Status',
  title: '{{appName}} is running.',
  intro: 'This screen checks that the app can reach its server.',
  status: {
    heading: 'Status',
    server: 'Server',
    serverOk: 'Answering',
    database: 'Database',
    databaseOk: 'Ready',
    worker: 'Background jobs',
    workerOk: 'Running',
    workerStale: 'Not seen in the last 5 minutes',
  },
  refresh: 'Check again',
} as const;
