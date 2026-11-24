import type {
  FormFillValues,
  FormSource,
  PdfModule,
  PdfOutputAction,
  PdfOutputOutcome,
} from '@/platform/pdf/types';

/** remember records the sources that had a value, never the values. */
export type PdfFakeCall =
  | { op: 'output'; action: PdfOutputAction }
  | { op: 'discard' }
  | { op: 'remember'; sources: readonly FormSource[] }
  | { op: 'forgetRemembered' };

const OUTPUTS: Readonly<Record<PdfOutputAction, boolean>> = {
  preview: true,
  share: true,
  print: true,
  download: false,
};

const calls: PdfFakeCall[] = [];
const state: {
  rememberSupported: boolean;
  output: PdfOutputOutcome;
  remembered: FormFillValues | null;
} = { rememberSupported: true, output: 'done', remembered: null };

export const pdf: PdfModule = {
  get rememberSupported() {
    return state.rememberSupported;
  },
  outputs: OUTPUTS,
  output: (_document, action) => {
    calls.push({ op: 'output', action });
    return Promise.resolve(state.output);
  },
  discard: () => {
    calls.push({ op: 'discard' });
  },
  remember: (values) => {
    const sources = (Object.keys(values) as FormSource[]).filter(
      (source) => values[source] !== null,
    ); // the record's own keys
    calls.push({ op: 'remember', sources });
    if (state.rememberSupported) {
      state.remembered = { ...values };
    }
    return Promise.resolve();
  },
  loadRemembered: () => Promise.resolve(state.remembered),
  forgetRemembered: () => {
    calls.push({ op: 'forgetRemembered' });
    state.remembered = null;
    return Promise.resolve();
  },
};

export const pdfFake = {
  calls: calls as readonly PdfFakeCall[],
  scriptOutput: (outcome: PdfOutputOutcome): void => {
    state.output = outcome;
  },
  setRememberSupported: (value: boolean): void => {
    state.rememberSupported = value;
  },
  reset: (): void => {
    calls.length = 0;
    state.rememberSupported = true;
    state.output = 'done';
    state.remembered = null;
  },
};
