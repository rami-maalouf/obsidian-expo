import { describe, expect, test } from 'bun:test';

import { dayLabel, monthGrid, monthTitle, shiftMonth, weekday, weekdayHeaders } from '@/features/calendar/month';

const TODAY = { year: 2026, month: 10, day: 8 };

describe('month grid', () => {
  test('october 2026 starts on thursday and fills six weeks from monday', () => {
    expect(weekday({ year: 2026, month: 10, day: 1 })).toBe(4);
    const grid = monthGrid({ year: 2026, month: 10 }, TODAY);
    expect(grid).toHaveLength(42);
    expect(grid[0].date).toEqual({ year: 2026, month: 9, day: 28 });
    expect(grid.filter((day) => day.inMonth)).toHaveLength(31);
    expect(grid.filter((day) => day.isToday).map((day) => day.date)).toEqual([TODAY]);
    expect(grid[41].date).toEqual({ year: 2026, month: 11, day: 8 });
  });

  test('sunday-first weeks and leap february', () => {
    const grid = monthGrid({ year: 2028, month: 2 }, TODAY, 0);
    expect(weekdayHeaders(0)[0]).toBe('Sun');
    expect(grid[0].date).toEqual({ year: 2028, month: 1, day: 30 });
    expect(grid.filter((day) => day.inMonth).map((day) => day.date.day).at(-1)).toBe(29);
  });

  test('a month starting on the week start has no leading days', () => {
    const grid = monthGrid({ year: 2026, month: 6 }, TODAY);
    expect(weekday({ year: 2026, month: 6, day: 1 })).toBe(1);
    expect(grid[0].date).toEqual({ year: 2026, month: 6, day: 1 });
  });

  test('paging across year boundaries', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 10 }, -22)).toEqual({ year: 2024, month: 12 });
    expect(monthTitle({ year: 2026, month: 10 })).toBe('October 2026');
  });

  test('day labels for voiceover', () => {
    const today = monthGrid({ year: 2026, month: 10 }, TODAY).find((day) => day.isToday);
    expect(today && dayLabel(today, true)).toBe('Thursday, October 8, 2026, today, has a daily note');
    expect(weekdayHeaders()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});
