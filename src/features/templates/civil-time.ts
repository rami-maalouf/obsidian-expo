/**
 * civil (wall-clock) dates and times with no time zone attached.
 *
 * the device clock is read once with `captureClock`; everything after that is calendar
 * arithmetic on plain fields, so DST transitions and time zone changes cannot shift a day.
 */

export type CivilDate = { year: number; month: number; day: number };
export type CivilDateTime = CivilDate & { hour: number; minute: number; second: number };

/** the Moment tokens a date pattern may use (KTD6). WW is the ISO week number, as in Moment. */
export const PATTERN_FIELDS = ['YYYY', 'MM', 'DD', 'HH', 'mm', 'ss', 'WW'] as const;
export type PatternField = (typeof PATTERN_FIELDS)[number];
export type PatternToken = { kind: 'field'; field: PatternField } | { kind: 'literal'; text: string };
export type DatePattern = { source: string; tokens: PatternToken[] };

/** characters copied as they are, like Moment does with characters that are not tokens. */
const PATTERN_SEPARATORS = ' -:/._,';

/** formats a reference date may be parsed from. daily-note filenames use the same set. */
export const REFERENCE_FORMATS = ['YYYY-MM-DD', 'YYYYMMDD'] as const;
export type ReferenceFormat = (typeof REFERENCE_FORMATS)[number];

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

/**
 * parses a Moment-style pattern made only of PATTERN_FIELDS, separators, the letter T, and
 * [bracketed text]. a run of one letter must be exactly one field, so DDDD or Do is rejected
 * rather than read as something Moment would print differently. returns null when unsupported.
 */
export function parseDatePattern(source: string): DatePattern | null {
  const tokens: PatternToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '[') {
      const end = source.indexOf(']', index + 1);
      if (end === -1) {
        return null;
      }
      tokens.push({ kind: 'literal', text: source.slice(index + 1, end) });
      index = end + 1;
    } else if (/[A-Za-z]/.test(char)) {
      let end = index;
      while (end < source.length && source[end] === char) {
        end++;
      }
      const run = source.slice(index, end);
      if (char === 'T') {
        tokens.push({ kind: 'literal', text: run });
      } else if ((PATTERN_FIELDS as readonly string[]).includes(run)) {
        tokens.push({ kind: 'field', field: run as PatternField });
      } else {
        return null;
      }
      index = end;
    } else if (PATTERN_SEPARATORS.includes(char)) {
      tokens.push({ kind: 'literal', text: char });
      index++;
    } else {
      return null;
    }
  }
  return tokens.some((token) => token.kind === 'field') ? { source, tokens } : null;
}

/** true when the pattern can read a date: YYYY, MM, and DD once each, and only literals besides. */
export function isDateReadingPattern(pattern: DatePattern): boolean {
  const fields = pattern.tokens.flatMap((token) => (token.kind === 'field' ? [token.field] : []));
  return fields.length === 3 && ['YYYY', 'MM', 'DD'].every((field) => fields.includes(field as PatternField));
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

/**
 * the ISO 8601 week number (1-53), which Moment prints for WW. like Moment, a pattern that pairs
 * it with YYYY uses the calendar year, so 2027-01-01 prints as 2027-W53.
 */
export function isoWeek(date: CivilDate): number {
  const epochDay = toEpochDay(date);
  // 1970-01-01 was a thursday; monday is 0.
  const weekday = (((epochDay + 3) % 7) + 7) % 7;
  const thursday = epochDay - weekday + 3;
  const firstOfYear = toEpochDay({ year: fromEpochDay(thursday).year, month: 1, day: 1 });
  return Math.floor((thursday - firstOfYear) / 7) + 1;
}

export function formatPattern(value: CivilDateTime, pattern: DatePattern): string {
  return pattern.tokens
    .map((token) => {
      if (token.kind === 'literal') {
        return token.text;
      }
      switch (token.field) {
        case 'YYYY':
          return pad(value.year, 4);
        case 'MM':
          return pad(value.month);
        case 'DD':
          return pad(value.day);
        case 'HH':
          return pad(value.hour);
        case 'mm':
          return pad(value.minute);
        case 'ss':
          return pad(value.second);
        case 'WW':
          return pad(isoWeek(value));
      }
    })
    .join('');
}

/** strict read of a date written with a date-reading pattern; null unless it names a real day. */
export function parseWithPattern(text: string, pattern: DatePattern): CivilDate | null {
  const groups: PatternField[] = [];
  const source = pattern.tokens
    .map((token) => {
      if (token.kind === 'literal') {
        return token.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      groups.push(token.field);
      return token.field === 'YYYY' ? '(\\d{4})' : '(\\d{2})';
    })
    .join('');
  const match = new RegExp(`^${source}$`).exec(text);
  if (!match) {
    return null;
  }
  const value = (field: PatternField) => Number(match[groups.indexOf(field) + 1]);
  const date = { year: value('YYYY'), month: value('MM'), day: value('DD') };
  return isValidCivilDate(date) ? date : null;
}

export function formatCivilDate(value: CivilDate, format: ReferenceFormat): string {
  const pattern = parseDatePattern(format);
  return pattern ? formatPattern({ ...value, hour: 0, minute: 0, second: 0 }, pattern) : '';
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
