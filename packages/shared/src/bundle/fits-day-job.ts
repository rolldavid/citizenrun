export type MeetingTime = 'daytime' | 'evenings' | 'weekends';
export const FITS_FULL_TIME_HOURS = 30; // L-fits-day-job
export const FITS_YES_MAX_HOURS = 20; // L-fits-day-job
export const FITS_DAYTIME_MAX_HOURS = 10; // L-fits-day-job

/**
 * "Keeps a day job?": yes, likely or no from time and meeting times (L-fits-day-job, D-500); null when
 * full time, hours a week and meeting times are all unknown. Throws RangeError for negative or non-finite hours.
 */
export function fitsDayJob(
  fullTime: boolean | null,
  hoursPerWeek: number | null,
  meetingTimes: readonly MeetingTime[] | null,
): 'yes' | 'likely' | 'no' | null {
  if (hoursPerWeek !== null && (!Number.isFinite(hoursPerWeek) || hoursPerWeek < 0)) {
    throw new RangeError('hoursPerWeek must be a non-negative finite number');
  }
  if (fullTime === true) {
    return 'no';
  }
  if (hoursPerWeek !== null && hoursPerWeek > FITS_FULL_TIME_HOURS) {
    return 'no';
  }
  if (meetingTimes !== null && meetingTimes.includes('daytime')) {
    return hoursPerWeek !== null && hoursPerWeek <= FITS_DAYTIME_MAX_HOURS ? 'likely' : 'no';
  }
  if (fullTime === null && hoursPerWeek === null && meetingTimes === null) {
    return null;
  }
  if (
    meetingTimes !== null &&
    meetingTimes.length > 0 &&
    hoursPerWeek !== null &&
    hoursPerWeek <= FITS_YES_MAX_HOURS
  ) {
    return 'yes';
  }
  return 'likely';
}
