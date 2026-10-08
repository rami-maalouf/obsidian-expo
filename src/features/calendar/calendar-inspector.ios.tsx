/**
 * the right-hand inspector: a native graphical calendar that opens or creates a day's note
 * (r10, t09). picking a day goes through the daily-note resolver, so paging months creates
 * nothing.
 */
import { Button, DatePicker, Form, Host, NavigationStack, Section, Text, Toolbar, ToolbarItem } from '@expo/ui/swift-ui';
import { datePickerStyle, foregroundStyle, navigationTitle, tint } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';

import { Accent } from '@/constants/theme';
import { dailyNoteTarget } from '@/features/daily-notes/settings';
import type { CivilDate } from '@/features/templates/civil-time';
import { useWorkspace } from '@/features/workspace/workspace';

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
          <Form modifiers={[navigationTitle('Calendar')]}>
            <Section>
              <DatePicker
                title="Daily note"
                selection={toDate(shown)}
                displayedComponents={['date']}
                onDateChange={(date) => workspace.selectDay(toCivil(date))}
                modifiers={[datePickerStyle('graphical')]}
              />
            </Section>
            <Section footer={<Text>{exists === null ? ' ' : exists ? 'This day has a note.' : 'This day has no note yet; opening it creates one from the template.'}</Text>}>
              <Button label="Today" systemImage="sun.max" onPress={() => workspace.selectDay(civilToday)} />
              <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>{shownPath}</Text>
            </Section>
          </Form>
          <Toolbar.Content>
            <ToolbarItem placement="topBarTrailing">
              <Button label="Daily Note Settings" systemImage="gearshape" onPress={() => router.push('/settings')} />
            </ToolbarItem>
            {workspace.collapsed ? (
              <ToolbarItem placement="topBarLeading">
                <Button label="Close" systemImage="xmark" onPress={() => workspace.setCalendarVisible(false)} />
              </ToolbarItem>
            ) : null}
          </Toolbar.Content>
        </Toolbar>
      </NavigationStack>
    </Host>
  );
}
