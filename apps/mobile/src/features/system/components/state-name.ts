import { RESOURCES } from '@citizenrun/shared';

type StateSegment = keyof (typeof RESOURCES)['en']['common']['state'];

/** The catalog key of one state's name. */
export type StateNameKey = `common:state.${StateSegment}`;

function isStateSegment(segment: string): segment is StateSegment {
  return Object.hasOwn(RESOURCES.en.common.state, segment);
}

/** The key of a state's name: 'VT' gives 'common:state.vt'. Null for a code the catalog does not name. */
export function stateNameKey(code: string): StateNameKey | null {
  const segment = code.toLowerCase();
  return isStateSegment(segment) ? `common:state.${segment}` : null;
}
