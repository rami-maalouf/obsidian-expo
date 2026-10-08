import { describe, expect, test } from 'bun:test';

import { createLaunchScreen, LAUNCH_SCREEN_LIMIT_MS } from '@/features/workspace/launch-screen';

function fakeSplash() {
  const calls: string[] = [];
  const timers: { task: () => void; ms: number }[] = [];
  const screen = createLaunchScreen(
    {
      preventAutoHideAsync: async () => {
        calls.push('prevent');
        return true;
      },
      hide: () => calls.push('hide'),
    },
    (task, ms) => timers.push({ task, ms }),
  );
  return { screen, calls, timers };
}

describe('launch screen', () => {
  test('stays up until the first screen is revealed, then hides once', () => {
    const { screen, calls } = fakeSplash();
    screen.hold();
    expect(calls).toEqual(['prevent']);
    screen.reveal();
    screen.reveal();
    expect(calls).toEqual(['prevent', 'hide']);
  });

  test('hides at the limit when nothing is revealed, and never twice', () => {
    const { screen, calls, timers } = fakeSplash();
    screen.hold();
    expect(timers.map((timer) => timer.ms)).toEqual([LAUNCH_SCREEN_LIMIT_MS]);
    timers[0].task();
    expect(calls).toEqual(['prevent', 'hide']);
    screen.reveal();
    expect(calls).toEqual(['prevent', 'hide']);
  });

  test('a reveal after the limit, or without a hold, does nothing', () => {
    const { screen, calls, timers } = fakeSplash();
    screen.reveal();
    expect(calls).toEqual([]);
    screen.hold();
    screen.hold();
    screen.reveal();
    timers.forEach((timer) => timer.task());
    expect(calls).toEqual(['prevent', 'hide']);
    expect(timers).toHaveLength(1);
  });
});
