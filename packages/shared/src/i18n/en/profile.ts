export const profile = {
  own: {
    avatarPending: 'Your new photo is being checked.',
  },
  person: {
    documentTitle: 'Profile',
    holds: '{{office}}, {{place}}',
    fromFilings: 'Created from public filings',
    retired: 'This profile is no longer listed.',
    seats: 'Offices held',
    since: 'Since {{year}}',
    until: 'Until {{year}}',
    sinceUnknown: 'Start year not known yet',
    noSeats: 'Offices held are not known yet.',
  },
  notFound: {
    title: "We can't find that profile.",
    home: 'See your offices',
  },
  photo: {
    credit: 'Photo: {{credit}}, {{license}}.',
    creditNoLicense: 'Photo: {{credit}}.',
    creditUnknown: 'Photo credit not known yet.',
  },
} as const;
