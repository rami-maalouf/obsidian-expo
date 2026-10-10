/**
 * the right-hand panel on android: a month grid that opens or creates a day's note (r10, t09).
 * picking a day goes through the daily-note resolver, so paging months creates nothing. days
 * that already have a note carry a dot, which the ios graphical picker cannot show.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Accent, useAndroidColors } from '@/constants/theme';
import { dailyNoteTarget } from '@/features/daily-notes/settings';
import { compareCivilDates } from '@/features/templates/civil-time';
import { Button, IconButton } from '@/features/workspace/android-ui';
import { useWorkspace } from '@/features/workspace/workspace';

import { dayLabel, monthGrid, type MonthCursor, monthTitle, shiftMonth, weekdayHeaders } from './month';

export function CalendarInspector() {
  const workspace = useWorkspace();
  const router = useRouter();
  const palette = useAndroidColors();
  const insets = useSafeAreaInsets();
  const { civilToday, selectedDay, settings, knownPaths } = workspace;
  const shown = selectedDay ?? civilToday;
  // the paged month belongs to the shown day: a day picked elsewhere, such as today from the
  // app bar, brings its own month into view.
  const shownMonth = `${shown.year}-${shown.month}`;
  const [paging, setPaging] = useState<{ month: string; cursor: MonthCursor } | null>(null);
  const cursor = paging?.month === shownMonth ? paging.cursor : { year: shown.year, month: shown.month };
  const page = (delta: number) => setPaging({ month: shownMonth, cursor: shiftMonth(cursor, delta) });

  const { year: cursorYear, month: cursorMonth } = cursor;
  const days = useMemo(() => monthGrid({ year: cursorYear, month: cursorMonth }, civilToday), [cursorYear, cursorMonth, civilToday]);
  const headers = useMemo(() => weekdayHeaders(), []);
  const shownPath = dailyNoteTarget(shown, settings).path;
  const exists = knownPaths ? knownPaths.has(shownPath) : null;

  return (
    <View style={[styles.panel, { paddingTop: insets.top, backgroundColor: palette.surface }]}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>
          Calendar
        </Text>
        <IconButton icon="settings" label="Note settings" onPress={() => router.push('/settings')} />
        <IconButton icon="right_panel_close" label="Close calendar" onPress={() => workspace.setCalendarOpen(false)} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        <View style={styles.month}>
          <IconButton icon="chevron_left" label="Previous month" onPress={() => page(-1)} />
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.monthTitle, { color: palette.text }]}>
            {monthTitle(cursor)}
          </Text>
          <IconButton icon="chevron_right" label="Next month" onPress={() => page(1)} />
        </View>
        <View style={styles.week} importantForAccessibility="no-hide-descendants">
          {headers.map((name) => (
            <Text key={name} style={[styles.weekday, { color: palette.secondary }]}>
              {name.slice(0, 2)}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {days.map((day) => {
            const hasNote = knownPaths?.has(dailyNoteTarget(day.date, settings).path) ?? false;
            const selected = compareCivilDates(day.date, shown) === 0;
            const color = selected ? palette.onAccent : day.isToday ? Accent : day.inMonth ? palette.text : palette.secondary;
            return (
              <Pressable
                key={`${day.date.year}-${day.date.month}-${day.date.day}`}
                accessibilityRole="button"
                accessibilityLabel={dayLabel(day, hasNote)}
                accessibilityState={{ selected }}
                onPress={() => workspace.selectDay(day.date)}
                android_ripple={{ color: palette.accentSoft, borderless: true, radius: 22 }}
                style={styles.cell}>
                <View
                  style={[
                    styles.day,
                    selected && { backgroundColor: Accent },
                    !selected && day.isToday && { borderColor: Accent, borderWidth: 1.5 },
                  ]}>
                  <Text style={[styles.dayText, { color, opacity: day.inMonth || selected ? 1 : 0.5 }, (day.isToday || selected) && styles.bold]}>
                    {day.date.day}
                  </Text>
                </View>
                <View style={[styles.dot, { backgroundColor: hasNote ? (selected ? Accent : palette.secondary) : 'transparent' }]} />
              </Pressable>
            );
          })}
        </View>
        <Button icon="today" label="Today" onPress={workspace.openToday} style={styles.today} />
        <Text style={[styles.path, { color: palette.secondary }]}>{shownPath}</Text>
        <Text style={[styles.note, { color: palette.secondary }]}>
          {exists === null ? ' ' : exists ? 'This day has a note.' : 'This day has no note yet; opening it creates one from the template.'}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    minHeight: 56,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
  },
  month: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  monthTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
  },
  week: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 2,
  },
  day: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayText: {
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  bold: {
    fontWeight: '700',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 1,
  },
  today: {
    alignSelf: 'flex-start',
    marginTop: 8,
    marginLeft: 6,
  },
  path: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  note: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
});
