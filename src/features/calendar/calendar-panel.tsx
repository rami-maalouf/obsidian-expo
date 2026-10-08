/**
 * month calendar (r10, t09). paging months only changes the view; tapping a day, including the
 * day already selected, opens or creates that day's note.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { dailyNoteTarget, type DailyNoteSettings } from '@/features/daily-notes/settings';
import { type CivilDate, compareCivilDates } from '@/features/templates/civil-time';
import { useTheme } from '@/hooks/use-theme';

import { dayLabel, monthGrid, monthTitle, shiftMonth, weekdayHeaders } from './month';

type Props = {
  today: CivilDate;
  settings: DailyNoteSettings;
  /** vault paths known to exist, for the "has a note" dot; null while loading. */
  knownPaths: ReadonlySet<string> | null;
  selected: CivilDate | null;
  onSelect: (date: CivilDate) => void;
  onEditSettings: () => void;
  onClose?: () => void;
};

export function CalendarPanel({ today, settings, knownPaths, selected, onSelect, onEditSettings, onClose }: Props) {
  const theme = useTheme();
  const [cursor, setCursor] = useState({ year: today.year, month: today.month });
  const days = monthGrid(cursor, today);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.header}>
        <Button kind="plain" title="‹" accessibilityLabel="Previous month" onPress={() => setCursor((value) => shiftMonth(value, -1))} />
        <ThemedText type="smallBold" style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
          {monthTitle(cursor)}
        </ThemedText>
        <Button kind="plain" title="›" accessibilityLabel="Next month" onPress={() => setCursor((value) => shiftMonth(value, 1))} />
      </View>
      <View style={styles.week}>
        {weekdayHeaders().map((name) => (
          <ThemedText key={name} type="small" themeColor="textSecondary" style={styles.cell} importantForAccessibility="no">
            {name}
          </ThemedText>
        ))}
      </View>
      <View style={styles.grid}>
        {days.map((day) => {
          const hasNote = knownPaths?.has(dailyNoteTarget(day.date, settings).path) ?? false;
          const isSelected = selected !== null && compareCivilDates(selected, day.date) === 0;
          return (
            <Pressable
              key={`${day.date.year}-${day.date.month}-${day.date.day}`}
              accessibilityRole="button"
              accessibilityLabel={dayLabel(day, hasNote)}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(day.date)}
              style={({ pressed }) => [
                styles.cell,
                styles.day,
                isSelected && { backgroundColor: theme.backgroundSelected },
                day.isToday && { borderColor: theme.text, borderWidth: 1 },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="small" themeColor={day.inMonth ? 'text' : 'textSecondary'}>
                {day.date.day}
              </ThemedText>
              <View style={[styles.dot, hasNote && { backgroundColor: theme.textSecondary }]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.footer}>
        <Button
          title="Today"
          onPress={() => {
            setCursor({ year: today.year, month: today.month });
            onSelect(today);
          }}
        />
        <Button kind="plain" title="Settings" onPress={onEditSettings} />
        {onClose && <Button kind="plain" title="Close" onPress={onClose} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  week: {
    flexDirection: 'row',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
    textAlign: 'center',
  },
  day: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two,
    borderColor: 'transparent',
    borderWidth: 1,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
