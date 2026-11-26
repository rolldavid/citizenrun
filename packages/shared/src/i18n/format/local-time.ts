import type { TFunction } from './t-function.ts';

type ZoneName =
  | 'eastern'
  | 'central'
  | 'mountain'
  | 'pacific'
  | 'alaska'
  | 'hawaii'
  | 'atlantic'
  | 'chamorro'
  | 'samoa'
  | 'utc';

/** The IANA zones whose name a closing time is shown with (L-format-local-time). */
export const US_ZONE_NAMES: Readonly<Record<string, ZoneName>> = {
  'America/New_York': 'eastern',
  'America/Detroit': 'eastern',
  'America/Kentucky/Louisville': 'eastern',
  'America/Kentucky/Monticello': 'eastern',
  'America/Indiana/Indianapolis': 'eastern',
  'America/Indiana/Vincennes': 'eastern',
  'America/Indiana/Winamac': 'eastern',
  'America/Indiana/Marengo': 'eastern',
  'America/Indiana/Petersburg': 'eastern',
  'America/Indiana/Vevay': 'eastern',
  'America/Chicago': 'central',
  'America/Indiana/Tell_City': 'central',
  'America/Indiana/Knox': 'central',
  'America/Menominee': 'central',
  'America/North_Dakota/Center': 'central',
  'America/North_Dakota/New_Salem': 'central',
  'America/North_Dakota/Beulah': 'central',
  'America/Denver': 'mountain',
  'America/Boise': 'mountain',
  'America/Phoenix': 'mountain',
  'America/Los_Angeles': 'pacific',
  'America/Anchorage': 'alaska',
  'America/Juneau': 'alaska',
  'America/Sitka': 'alaska',
  'America/Yakutat': 'alaska',
  'America/Nome': 'alaska',
  'America/Metlakatla': 'alaska',
  'Pacific/Honolulu': 'hawaii',
  'America/Adak': 'hawaii',
  'America/Puerto_Rico': 'atlantic',
  'America/St_Thomas': 'atlantic',
  'Pacific/Guam': 'chamorro',
  'Pacific/Saipan': 'chamorro',
  'Pacific/Pago_Pago': 'samoa',
  'Etc/UTC': 'utc',
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Hours on a 12-hour clock (L-format-local-time). */
const HALF_DAY_HOURS = 12;

function zoneText(zone: string | null, t: TFunction): string {
  const name =
    zone !== null && Object.prototype.hasOwnProperty.call(US_ZONE_NAMES, zone)
      ? US_ZONE_NAMES[zone]
      : undefined;
  // One literal call per name, so the catalog check can read every key.
  switch (name) {
    case 'eastern':
      return t('common:zone.eastern');
    case 'central':
      return t('common:zone.central');
    case 'mountain':
      return t('common:zone.mountain');
    case 'pacific':
      return t('common:zone.pacific');
    case 'alaska':
      return t('common:zone.alaska');
    case 'hawaii':
      return t('common:zone.hawaii');
    case 'atlantic':
      return t('common:zone.atlantic');
    case 'chamorro':
      return t('common:zone.chamorro');
    case 'samoa':
      return t('common:zone.samoa');
    case 'utc':
      return t('common:zone.utc');
    case undefined:
      return t('common:zone.local');
  }
}

function timeText(time: string, t: TFunction): string {
  const match = TIME_PATTERN.exec(time);
  if (match === null) {
    throw new RangeError('Not a 24-hour HH:MM time.');
  }
  const hours = Number(match[1]);
  const minutes = match[2] ?? '';
  if (time === '12:00') {
    return t('common:time.noon');
  }
  if (time === '00:00') {
    return t('common:time.midnight');
  }
  const clock = `${String(hours % HALF_DAY_HOURS === 0 ? HALF_DAY_HOURS : hours % HALF_DAY_HOURS)}:${minutes}`;
  return hours < HALF_DAY_HOURS
    ? t('common:time.am', { time: clock })
    : t('common:time.pm', { time: clock });
}

/**
 * A local time of day as written, with its zone named ("12:00 noon Eastern", "5:00 pm Central");
 * the closing-time-unknown sentence when `time` is null, "local time" when the zone is null or not
 * in US_ZONE_NAMES. Never converted to another zone. RangeError for a time that is not HH:MM.
 */
export function formatLocalTime(time: string | null, zone: string | null, t: TFunction): string {
  if (time === null) {
    return t('common:time.closingUnknown');
  }
  return t('common:time.withZone', { time: timeText(time, t), zone: zoneText(zone, t) });
}
