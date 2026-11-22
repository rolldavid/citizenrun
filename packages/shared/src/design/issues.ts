import { BONE, INK } from './tokens.ts';

/** Issue ids, in the order of data/issues.yaml `sort`. They must equal the ids in that file. */
export const ISSUE_IDS = [
  'rent-housing',
  'utility-bills',
  'data-centers-ai',
  'climate',
  'corporate-subsidies',
  'property-taxes',
  'wages-workers',
  'policing-justice',
  'healthcare',
  'medicare-for-all',
  'schools',
  'water-land',
  'transit',
  'voting-access',
  'money-in-politics',
  'nominations',
  'public-money',
  'defund-israel',
  'foreign-wars',
] as const;
export type IssueId = (typeof ISSUE_IDS)[number];
export type IssueTone = 'bright' | 'mid' | 'deep';
export type IssueColor = {
  pigment: string;
  tone: IssueTone;
  light: string; // issues.color_light
  dark: string; // issues.color_dark
  on: string; // the glyph color on the tile: ink on bright tones, bone on mid and deep
};

/** Token shape: issue[id].light, issue[id].dark, issue[id].on. */
export const issue: Readonly<Record<IssueId, IssueColor>> = {
  'rent-housing': { pigment: 'rose', tone: 'bright', light: '#CD527C', dark: '#E96B94', on: INK },
  'utility-bills': { pigment: 'ochre', tone: 'bright', light: '#9D7806', dark: '#B98E1C', on: INK },
  'data-centers-ai': {
    pigment: 'violet',
    tone: 'bright',
    light: '#8C6AD5',
    dark: '#A382F0',
    on: INK,
  },
  climate: { pigment: 'green', tone: 'bright', light: '#248F41', dark: '#42A859', on: INK },
  'corporate-subsidies': {
    pigment: 'maroon',
    tone: 'deep',
    light: '#882739',
    dark: '#B34F5D',
    on: BONE,
  },
  'property-taxes': { pigment: 'olive', tone: 'mid', light: '#6F6601', dark: '#8D8522', on: BONE },
  'wages-workers': {
    pigment: 'cobalt',
    tone: 'bright',
    light: '#4D79DD',
    dark: '#6392F8',
    on: INK,
  },
  'policing-justice': {
    pigment: 'navy',
    tone: 'deep',
    light: '#354298',
    dark: '#5669C2',
    on: BONE,
  },
  healthcare: { pigment: 'teal', tone: 'bright', light: '#098B88', dark: '#11A6A2', on: INK },
  'medicare-for-all': {
    pigment: 'mulberry',
    tone: 'mid',
    light: '#91489D',
    dark: '#B166BD',
    on: BONE,
  },
  schools: { pigment: 'azure', tone: 'bright', light: '#0985BB', dark: '#0F9EDD', on: INK },
  'water-land': { pigment: 'lake', tone: 'mid', light: '#2368A6', dark: '#4486C7', on: BONE },
  transit: { pigment: 'walnut', tone: 'deep', light: '#6F4016', dark: '#97643D', on: BONE },
  'voting-access': { pigment: 'bronze', tone: 'mid', light: '#915809', dark: '#B57528', on: BONE },
  'money-in-politics': {
    pigment: 'petrol',
    tone: 'deep',
    light: '#005264',
    dark: '#187A90',
    on: BONE,
  },
  nominations: { pigment: 'jade', tone: 'mid', light: '#00735D', dark: '#0E9479', on: BONE },
  'public-money': { pigment: 'forest', tone: 'deep', light: '#025637', dark: '#008053', on: BONE },
  'defund-israel': { pigment: 'plum', tone: 'deep', light: '#7B2C67', dark: '#A4538D', on: BONE },
  'foreign-wars': { pigment: 'drab', tone: 'deep', light: '#4B4E17', dark: '#70733E', on: BONE },
};

/** Type guard for an id that came from the API: the server may know an issue this build does not. */
export function isIssueId(id: string): id is IssueId {
  return (ISSUE_IDS as readonly string[]).includes(id); // includes() of the literal tuple takes only its own members
}

/** Share of the issue color in each of the five district steps, mixed in OKLab from mapLand. */
export const MAP_RAMP_STOPS = [0.22, 0.4, 0.6, 0.8, 1] as const;
/** Share of `text` in the neutral ramp ("My issues"). */
export const MAP_NEUTRAL_STOPS = [0.12, 0.24, 0.38, 0.54, 0.7] as const;

type Ramp = readonly [string, string, string, string, string];
type RampPair = { light: Ramp; dark: Ramp };

/** The 200 district fill values: map.ramp[issue][0..4] per theme, and the neutral ramp. */
export const mapRamp: Readonly<Record<IssueId | 'neutral', RampPair>> = {
  'rent-housing': {
    light: ['#EDCDCE', '#E8B2BB', '#E193A5', '#D87490', '#CD527C'],
    dark: ['#3B2529', '#603540', '#8B465A', '#B95877', '#E96B94'],
  },
  'utility-bills': {
    light: ['#DED4BC', '#CFBF99', '#BEA771', '#AE8F48', '#9D7806'],
    dark: ['#322A18', '#4E3F1D', '#705820', '#947320', '#B98E1C'],
  },
  'data-centers-ai': {
    light: ['#D9D2E5', '#C6BBE3', '#B2A0DF', '#9E86DB', '#8C6AD5'],
    dark: ['#2D293A', '#463C60', '#63528D', '#826ABE', '#A382F0'],
  },
  climate: {
    light: ['#C8DAC2', '#A6C9A4', '#80B683', '#58A262', '#248F41'],
    dark: ['#1F2F1F', '#28482C', '#32673B', '#3A874A', '#42A859'],
  },
  'corporate-subsidies': {
    light: ['#DDC2BE', '#CC9F9D', '#B7787A', '#A05159', '#882739'],
    dark: ['#321F1F', '#4D2A2D', '#6E373C', '#90434C', '#B34F5D'],
  },
  'property-taxes': {
    light: ['#D3D0B8', '#BAB793', '#A09B6A', '#878040', '#6F6601'],
    dark: ['#2A2818', '#3F3C1D', '#575320', '#726C22', '#8D8522'],
  },
  'wages-workers': {
    light: ['#CBD6E8', '#ADC1E7', '#8CAAE5', '#6C92E1', '#4D79DD'],
    dark: ['#222B3C', '#304163', '#415B92', '#5276C4', '#6392F8'],
  },
  'policing-justice': {
    light: ['#C3C8D8', '#9FA9CB', '#7987BB', '#5565AA', '#354298'],
    dark: ['#1F2432', '#2B3351', '#394575', '#47579A', '#5669C2'],
  },
  healthcare: {
    light: ['#C7D9D1', '#A4C7C0', '#7CB3AD', '#519F9A', '#098B88'],
    dark: ['#1C2E2C', '#214845', '#236662', '#208581', '#11A6A2'],
  },
  'medicare-for-all': {
    light: ['#DCCAD8', '#CBACCB', '#B88BBC', '#A56AAD', '#91489D'],
    dark: ['#312431', '#4C324E', '#6C4371', '#8E5496', '#B166BD'],
  },
  schools: {
    light: ['#C6D8DF', '#A3C5D7', '#7BB0CE', '#4F9BC5', '#0985BB'],
    dark: ['#1B2D37', '#204559', '#226283', '#1E7FAF', '#0F9EDD'],
  },
  'water-land': {
    light: ['#C4D1DA', '#A0B9CF', '#789EC2', '#5083B4', '#2368A6'],
    dark: ['#1E2933', '#273D52', '#315477', '#3B6D9E', '#4486C7'],
  },
  transit: {
    light: ['#D4C6B7', '#BDA691', '#A38368', '#896140', '#6F4016'],
    dark: ['#2C231A', '#433122', '#5E412B', '#7A5234', '#97643D'],
  },
  'voting-access': {
    light: ['#DDCDB9', '#CCB194', '#B8936B', '#A57542', '#915809'],
    dark: ['#312618', '#4D371E', '#6E4B23', '#916026', '#B57528'],
  },
  'money-in-politics': {
    light: ['#BFCBC9', '#96AEB1', '#6B8E97', '#3E707D', '#005264'],
    dark: ['#192729', '#1D383F', '#1F4D59', '#1E6374', '#187A90'],
  },
  nominations: {
    light: ['#C3D3C7', '#9EBCAD', '#74A491', '#488B77', '#00735D'],
    dark: ['#1A2B24', '#1F4136', '#205C4C', '#1C7762', '#0E9479'],
  },
  'public-money': {
    light: ['#BFCCBD', '#97AF9C', '#6B9179', '#3F7357', '#025637'],
    dark: ['#18281E', '#1B3B29', '#1B5137', '#156845', '#008053'],
  },
  'defund-israel': {
    light: ['#D8C3CA', '#C49FB2', '#AC7999', '#945380', '#7B2C67'],
    dark: ['#2F2028', '#482B3E', '#653857', '#844671', '#A4538D'],
  },
  'foreign-wars': {
    light: ['#CAC9B7', '#AAAB91', '#898B68', '#696C41', '#4B4E17'],
    dark: ['#24251A', '#353622', '#47492C', '#5B5E35', '#70733E'],
  },
  neutral: {
    light: ['#D3D1CA', '#B5B4AD', '#94938D', '#706F6A', '#4D4D49'],
    dark: ['#282825', '#403F3C', '#5D5D59', '#81807C', '#A7A6A1'],
  },
};
