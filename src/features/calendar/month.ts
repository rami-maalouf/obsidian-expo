/**
 * month grid for the calendar (r10). dates are civil days; paging months creates nothing.
 */
import { addDays, type CivilDate, compareCivilDates, daysInMonth } from '@/features/templates/civil-time';

export type CalendarDay = { date: CivilDate; inMonth: boolean; isToday: boolean };

export type MonthCursor = { year: number; month: number };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** 0 is sunday. */
export function weekday({ year, month, day }: CivilDate): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCDay();
}

/** six full weeks starting on `weekStart` (0 sunday, 1 monday), so the grid never jumps in height. */
export function monthGrid(cursor: MonthCursor, today: CivilDate, weekStart: 0 | 1 = 1): CalendarDay[] {
  const first = { year: cursor.year, month: cursor.month, day: 1 };
  const lead = (weekday(first) - weekStart + 7) % 7;
  const start = addDays(first, -lead) ?? first;
  const days: CalendarDay[] = [];
  for (let offset = 0; offset < 42; offset++) {
    const date = addDays(start, offset);
    if (!date) break;
    days.push({ date, inMonth: date.month === cursor.month && date.year === cursor.year, isToday: compareCivilDates(date, today) === 0 });
  }
  return days;
}

export function shiftMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const index = cursor.year * 12 + (cursor.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthTitle({ year, month }: MonthCursor): string {
  return `${MONTHS[month - 1]} ${year}`;
}

export function weekdayHeaders(weekStart: 0 | 1 = 1): string[] {
  return Array.from({ length: 7 }, (_, index) => WEEKDAYS[(index + weekStart) % 7].slice(0, 3));
}

/** the spoken label for a day button. */
export function dayLabel(day: CalendarDay, hasNote: boolean): string {
  const { year, month, day: dayOfMonth } = day.date;
  const parts = [`${WEEKDAYS[weekday(day.date)]}, ${MONTHS[month - 1]} ${dayOfMonth}, ${year}`];
  if (day.isToday) parts.push('today');
  if (hasNote) parts.push('has a daily note');
  return parts.join(', ');
}

export function isValidCursor({ year, month }: MonthCursor): boolean {
  return Number.isInteger(year) && month >= 1 && month <= 12 && daysInMonth(year, month) > 0;
}
