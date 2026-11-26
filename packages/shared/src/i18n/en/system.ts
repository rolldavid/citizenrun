export const system = {
  notFound: {
    title: 'This page does not exist.',
    body: 'Check the link, or start from Home.',
    action: 'Go to Home',
  },
  update: {
    title: 'Update {{appName}} to keep going.',
    body: 'This version is too old to work with the service.',
    bodyNoStore: 'Close {{appName}} and open it again in a few minutes.',
    action: 'Update',
  },
  error: {
    title: 'Something went wrong.',
    body: 'Try again. If it keeps happening, update the app.',
  },
  adultsOnly: {
    title: 'This app is for adults.',
  },
  stateUnavailable: {
    title: '{{appName}} is not available in {{state}} yet.',
    titleGeneric: '{{appName}} is not available where you live yet.',
    body: 'You can still read public office and candidate pages.',
    browse: 'Browse offices',
    delete: 'Delete my account',
  },
} as const;
