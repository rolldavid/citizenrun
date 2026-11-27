export const office = {
  run: {
    unavailable: {
      placeholder: 'No filing details yet',
      retired: 'No longer listed',
      noElection: 'No election scheduled',
      closed: 'Filing closed',
    },
  },
  meter: {
    easeName: 'Ease',
    impactName: 'Impact',
    ease: {
      high: 'Easier than most',
      high_about: 'About: easier than most',
      medium: 'Average to win',
      medium_about: 'About: average to win',
      low: 'Harder than most',
      low_about: 'About: harder than most',
    },
    impact: {
      high: 'High on {{issue}}',
      medium: 'Medium on {{issue}}',
      low: 'Low on {{issue}}',
      none: 'Does not touch your issues',
    },
  },
  card: {
    cost: {
      feeAndRun_about: '{{fee}} to file. About {{cost}} to run.',
      feeOnly: '{{fee}} to file.',
      noFeeAndRun_about: 'No filing fee. About {{cost}} to run.',
      noFee: 'No filing fee.',
      feeSignaturesAndRun_about_one: '{{fee}} to file. {{count}} signature. About {{cost}} to run.',
      feeSignaturesAndRun_about_other:
        '{{fee}} to file. {{count}} signatures. About {{cost}} to run.',
    },
    source: {
      high: 'High confidence · Sources',
      medium: 'Medium confidence · Sources',
      low: 'Low confidence · Sources',
      none: 'Sources',
    },
  },
  holder: {
    since: 'Holder since {{year}}',
    current: 'Current holder',
  },
  candidate: {
    filedOn: 'Filed {{date}} · created from public filings',
    committee: 'Registered a campaign committee',
    fromFilings: 'Created from public filings',
  },
} as const;
