/**
 * the right-hand panel: a native graphical calendar that opens or creates a day's note
 * (r10, t09). picking a day goes through the daily-note resolver, so paging months creates
 * nothing.
 */
import { Button, DatePicker, Host, NavigationStack, ScrollView, Text, Toolbar, ToolbarItem, VStack } from '@expo/ui/swift-ui';
import { datePickerStyle, font, foregroundStyle, navigationBarTitleDisplayMode, navigationTitle, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';

import { Accent } from '@/constants/theme';
import { dailyNoteTarget } from '@/features/daily-notes/settings';
import type { CivilDate } from '@/features/templates/civil-time';
import { useWorkspace } from '@/features/workspace/workspace';

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/** noon local time, so a time zone offset can never move the picked day. */
function toDate({ year, month, day }: CivilDate): Date {
  return new Date(year, month - 1, day, 12);
}

function toCivil(date: Date): CivilDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function CalendarInspector() {
  const workspace = useWorkspace();
  const router = useRouter();
  const { civilToday, selectedDay, settings, knownPaths } = workspace;
  const shown = selectedDay ?? civilToday;
  const shownPath = dailyNoteTarget(shown, settings).path;
  const exists = knownPaths ? knownPaths.has(shownPath) : null;

  return (
    <Host style={{ flex: 1 }} modifiers={[tint(Accent)]}>
      <NavigationStack>
        <Toolbar>
          {/* no form around the picker: its insets would push the graphical month past a phone panel's edges. */}
          <ScrollView modifiers={[navigationTitle('Calendar'), navigationBarTitleDisplayMode('inline')]}>
            <VStack alignment="leading" spacing={10} modifiers={[padding({ horizontal: 12, top: 4, bottom: 16 })]}>
              <DatePicker
                title="Daily note"
                selection={toDate(shown)}
                displayedComponents={['date']}
                onDateChange={(date) => workspace.selectDay(toCivil(date))}
                modifiers={[datePickerStyle('graphical')]}
              />
              <Text modifiers={[secondary, font({ textStyle: 'subheadline' }), padding({ horizontal: 4 })]}>{shownPath}</Text>
              <Text modifiers={[secondary, font({ textStyle: 'footnote' }), padding({ horizontal: 4 })]}>
                {exists === null ? ' ' : exists ? 'This day has a note.' : 'This day has no note yet; opening it creates one from the template.'}
              </Text>
            </VStack>
          </ScrollView>
          <Toolbar.Content>
            <ToolbarItem placement="topBarTrailing">
              <Button label="Daily Note Settings" systemImage="gearshape" onPress={() => router.push('/settings')} />
            </ToolbarItem>
            <ToolbarItem placement="topBarLeading">
              <Button label="Close Calendar" systemImage="sidebar.right" onPress={() => workspace.setCalendarOpen(false)} />
            </ToolbarItem>
          </Toolbar.Content>
        </Toolbar>
      </NavigationStack>
    </Host>
  );
}
