/**
 * civil (wall-clock) dates and times with no time zone attached.
 *
 * the device clock is read once with `captureClock`; everything after that is calendar
 * arithmetic on plain fields, so DST transitions and time zone changes cannot shift a day.
 */

export type CivilDate = { year: number; month: number; day: number };
export type CivilDateTime = CivilDate & { hour: number; minute: number; second: number };

/** the only output formats KTD6 allows, each matched as a whole string. */
export const DATE_FORMATS = [
  'YYYY-MM-DD',
  'YYYYMMDD',
  'YYYY-MM',
  'YYYY-MM-DD HH:mm',
  'HH:mm',
  'HH:mm:ss',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** formats a reference date may be parsed from. daily-note filenames use the same set. */
export const REFERENCE_FORMATS = ['YYYY-MM-DD', 'YYYYMMDD'] as const;
export type ReferenceFormat = (typeof REFERENCE_FORMATS)[number];

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

export function isDateFormat(value: string): value is DateFormat {
  return (DATE_FORMATS as readonly string[]).includes(value);
}

export function isReferenceFormat(value: string): value is ReferenceFormat {
  return (REFERENCE_FORMATS as readonly string[]).includes(value);
}

/** reads the device's local wall clock. call once per expansion and pass the result along. */
export function captureClock(now: Date = new Date()): CivilDateTime {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hour: now.getHours(),
    minute: now.getMinutes(),
    second: now.getSeconds(),
  };
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidCivilDate({ year, month, day }: CivilDate): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/** days since 1970-01-01 in the proleptic Gregorian calendar. */
function toEpochDay({ year, month, day }: CivilDate): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return Math.round(date.getTime() / 86_400_000);
}

function fromEpochDay(epochDay: number): CivilDate {
  const date = new Date(epochDay * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** moves a date by whole calendar days. returns null outside years 1-9999. */
export function addDays(date: CivilDate, days: number): CivilDate | null {
  const result = fromEpochDay(toEpochDay(date) + days);
  return isValidCivilDate(result) ? result : null;
}

export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function sameCivilDate(a: CivilDate, b: CivilDate): boolean {
  return compareCivilDates(a, b) === 0;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function formatCivil(value: CivilDateTime, format: DateFormat): string {
  const date = `${pad(value.year, 4)}-${pad(value.month)}-${pad(value.day)}`;
  const minutes = `${pad(value.hour)}:${pad(value.minute)}`;
  switch (format) {
    case 'YYYY-MM-DD':
      return date;
    case 'YYYYMMDD':
      return date.replaceAll('-', '');
    case 'YYYY-MM':
      return date.slice(0, 7);
    case 'YYYY-MM-DD HH:mm':
      return `${date} ${minutes}`;
    case 'HH:mm':
      return minutes;
    case 'HH:mm:ss':
      return `${minutes}:${pad(value.second)}`;
  }
}

export function formatCivilDate(value: CivilDate, format: ReferenceFormat): string {
  return formatCivil({ ...value, hour: 0, minute: 0, second: 0 }, format);
}

const REFERENCE_PATTERNS: Record<ReferenceFormat, RegExp> = {
  'YYYY-MM-DD': /^(\d{4})-(\d{2})-(\d{2})$/,
  YYYYMMDD: /^(\d{4})(\d{2})(\d{2})$/,
};

/** strict parse: the text must match the format exactly and name a real calendar day. */
export function parseCivilDate(text: string, format: ReferenceFormat): CivilDate | null {
  const match = REFERENCE_PATTERNS[format].exec(text);
  if (!match) {
    return null;
  }
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return isValidCivilDate(date) ? date : null;
}
