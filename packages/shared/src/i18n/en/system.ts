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
  agreements: {
    title: 'We updated our terms.',
    body: 'Read the <terms>Terms</terms>, the <policy>Content policy</policy> and the <privacy>Privacy policy</privacy>. Tap Agree to keep using {{appName}}.',
    agree: 'Agree',
    privacyTitle: 'We updated the privacy policy.',
    privacyBody: 'Read the <privacy>Privacy policy</privacy>. Tap OK to keep using {{appName}}.',
    leave: 'If you do not agree, you can <delete>delete your account</delete>.',
  },
  stateUnavailable: {
    title: '{{appName}} is not available in {{state}} yet.',
    titleGeneric: '{{appName}} is not available where you live yet.',
    body: 'You can still read public office and candidate pages.',
    browse: 'Browse offices',
    delete: 'Delete my account',
  },
} as const;
