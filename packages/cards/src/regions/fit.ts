import { CANVAS } from '../canvas.ts';
import { measureText } from '../layout-text.ts';
import { overflowsBigSlot } from '../model/figures.ts';
import type { FactModel, OfficeTopModel } from '../model/region-models.ts';
import type { RunAgainstModel } from '../model/run-against.ts';
import { layoutBigNumber } from './big-number.tsx';
import { FACT_COLUMNS, layoutFact } from './facts.tsx';
import { capitals, layoutKicker } from './kicker.tsx';
import { layoutSources } from './sources.tsx';

// The fit checks of the regions: one sentence per line of catalog text that leaves its slot. A
// title, a place or a holder line cut when it is drawn is data, and is no problem here.

/** The most code points each catalog string of a canvas may have. */
const BUDGET = {
  kicker: 30,
  caption: 40,
  aboutWord: 6,
  phrase: 18,
  factLabel: 17,
  factLabelFlag: 16,
  dateLine: 20,
  source: 39,
} as const;

/** The length of a string in code points. */
function lengthOf(text: string): number {
  return Array.from(text).length;
}

function kickerProblems(model: OfficeTopModel): string[] {
  const label = capitals(model.kicker.label);
  // Measured beside a tile whenever the model names an issue: the narrower of the two rows.
  const { cut } = layoutKicker(model.kicker, model.kicker.issueId !== null).label;
  if (lengthOf(label) > BUDGET.kicker) {
    return [`kicker label "${label}" is over ${String(BUDGET.kicker)} characters`];
  }
  return cut ? [`kicker label "${label}" is cut`] : [];
}

function bigProblems(model: RunAgainstModel): string[] {
  const { big } = model;
  const layout = layoutBigNumber(big);
  const problems: string[] = [];
  if (big.kind === 'figure' && overflowsBigSlot(big.value, big.aboutWord)) {
    problems.push(`big number "${big.value}" does not fit the measure`);
  }
  if (lengthOf(big.caption) > BUDGET.caption) {
    problems.push(`caption "${big.caption}" is over ${String(BUDGET.caption)} characters`);
  } else if (layout.caption.cut) {
    problems.push(`caption "${big.caption}" does not fit the measure`);
  }
  return problems;
}

/** One sentence per estimate word over its budget, each word once. */
function aboutWordProblems(model: RunAgainstModel): string[] {
  const words = [
    model.big.kind === 'figure' ? model.big.aboutWord : null,
    ...model.facts.map((fact) => (fact.kind === 'figure' ? fact.aboutWord : null)),
  ].filter((word): word is string => word !== null);
  return [...new Set(words)]
    .filter((word) => lengthOf(word) > BUDGET.aboutWord)
    .map((word) => `estimate word "${word}" is over ${String(BUDGET.aboutWord)} characters`);
}

function factProblems(fact: FactModel, column: { x: number; width: number }): string[] {
  const layout = layoutFact(fact, column);
  const problems: string[] = [];
  if (fact.kind === 'phrase') {
    const smallest = CANVAS.type.unknown.at(-1) ?? CANVAS.type.unknown[0];
    if (lengthOf(fact.phrase) > BUDGET.phrase) {
      problems.push(`fact phrase "${fact.phrase}" is over ${String(BUDGET.phrase)} characters`);
    } else if (measureText(fact.phrase, { face: 'medium', size: smallest }) > column.width) {
      problems.push(`fact phrase "${fact.phrase}" does not fit its column`);
    }
  } else if (layout.figure?.fits === false) {
    problems.push(`fact figure "${fact.value}" does not fit its column`);
  }
  const label = capitals(fact.label);
  const flagged = fact.kind === 'figure' && fact.flag;
  const labelBudget = flagged ? BUDGET.factLabelFlag : BUDGET.factLabel;
  if (lengthOf(label) > labelBudget) {
    problems.push(`fact label "${label}" is over ${String(labelBudget)} characters`);
  } else if (layout.label.cut) {
    problems.push(`fact label "${label}" is cut`);
  }
  if (fact.dateLine !== null) {
    if (lengthOf(fact.dateLine) > BUDGET.dateLine) {
      problems.push(`date line "${fact.dateLine}" is over ${String(BUDGET.dateLine)} characters`);
    } else if (layout.dateLine?.cut === true) {
      problems.push(`date line "${fact.dateLine}" does not fit its column`);
    }
  }
  return problems;
}

function sourceProblems(model: RunAgainstModel): string[] {
  return layoutSources(model.sources).flatMap((line) => {
    if (lengthOf(line.text) > BUDGET.source) {
      return [`source line "${line.text}" is over ${String(BUDGET.source)} characters`];
    }
    return line.width > CANVAS.measure
      ? [`source line "${line.text}" does not fit the measure`]
      : [];
  });
}

/** One sentence per fit problem of the run-against canvas; [] when every line keeps to its slot. */
export function runAgainstFitProblems(model: RunAgainstModel): string[] {
  return [
    ...officeTopFitProblems(model.top),
    ...bigProblems(model),
    ...aboutWordProblems(model),
    ...factProblems(model.facts[0], FACT_COLUMNS[0]),
    ...factProblems(model.facts[1], FACT_COLUMNS[1]),
    ...sourceProblems(model),
  ];
}

/** The same for an office top drawn alone (the hero). */
export function officeTopFitProblems(model: OfficeTopModel): string[] {
  return kickerProblems(model);
}
