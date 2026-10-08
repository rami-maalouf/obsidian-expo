/**
 * the current civil day. it moves forward at midnight and when the app returns to the
 * foreground; the open note is never replaced because the day changed (r11).
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { captureClock, type CivilDate, sameCivilDate } from '@/features/templates/civil-time';

import { msUntilNextDay } from './day-boundary';

function currentDay(): CivilDate {
  const { year, month, day } = captureClock();
  return { year, month, day };
}

export function useCivilToday(): CivilDate {
  const [today, setToday] = useState(currentDay);

  useEffect(() => {
    const refresh = () => setToday((previous) => (sameCivilDate(previous, currentDay()) ? previous : currentDay()));
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextDay(new Date()));
    };
    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return today;
}
