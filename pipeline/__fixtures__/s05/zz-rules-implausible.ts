// The ZZ rules module with one defect: for the track set zz_nonpartisan the closing date is one day
// after the election. Every other answer is the ZZ module's own.
import { addDays } from '@citizenrun/rules';
import type { StateRules } from '@citizenrun/rules';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';

export const ZZ_RULES_IMPLAUSIBLE: StateRules = {
  ...ZZ_RULES,
  filingTracks(input) {
    const tracks = ZZ_RULES.filingTracks(input);
    if (input.office.trackSet !== 'zz_nonpartisan') {
      return tracks;
    }
    return tracks.map((track) => ({
      ...track,
      closesOn: { ...track.closesOn, value: addDays(input.contest.date, 1) },
    }));
  },
};
