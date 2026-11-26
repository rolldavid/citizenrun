import type { Issue } from '@citizenrun/shared';

/** The 19 issues of the product's issue list, in their order; `icon` equals the id (PIPE-data-issues). */
export const FIXTURE_ISSUES: readonly Issue[] = [
  { id: 'rent-housing', name: 'Rent and housing costs', icon: 'rent-housing', sort: 1 },
  { id: 'utility-bills', name: 'Power and utility bills', icon: 'utility-bills', sort: 2 },
  { id: 'data-centers-ai', name: 'Data centers and AI', icon: 'data-centers-ai', sort: 3 },
  { id: 'climate', name: 'Climate', icon: 'climate', sort: 4 },
  {
    id: 'corporate-subsidies',
    name: 'Corporate tax breaks and subsidies',
    icon: 'corporate-subsidies',
    sort: 5,
  },
  {
    id: 'property-taxes',
    name: 'Property taxes and fair assessment',
    icon: 'property-taxes',
    sort: 6,
  },
  { id: 'wages-workers', name: 'Wages and worker power', icon: 'wages-workers', sort: 7 },
  {
    id: 'policing-justice',
    name: 'Policing, prosecution and jails',
    icon: 'policing-justice',
    sort: 8,
  },
  { id: 'healthcare', name: 'Healthcare costs and access', icon: 'healthcare', sort: 9 },
  { id: 'medicare-for-all', name: 'Medicare for All', icon: 'medicare-for-all', sort: 10 },
  { id: 'schools', name: 'Schools', icon: 'schools', sort: 11 },
  { id: 'water-land', name: 'Water, land and environment', icon: 'water-land', sort: 12 },
  { id: 'transit', name: 'Transit', icon: 'transit', sort: 13 },
  { id: 'voting-access', name: 'Elections and voting access', icon: 'voting-access', sort: 14 },
  { id: 'money-in-politics', name: 'Money in politics', icon: 'money-in-politics', sort: 15 },
  { id: 'nominations', name: 'Who gets nominated, up to Congress', icon: 'nominations', sort: 16 },
  { id: 'public-money', name: 'Public money and divestment', icon: 'public-money', sort: 17 },
  { id: 'defund-israel', name: 'Defunding Israel', icon: 'defund-israel', sort: 18 },
  {
    id: 'foreign-wars',
    name: 'Foreign wars and military spending',
    icon: 'foreign-wars',
    sort: 19,
  },
];
