/**
 * note settings with previews before they take effect (r5, r12, flow f1), on android: where daily
 * notes live and which template fills them, which note a launch opens, then where new notes go
 * and which template fills those. the previews read the templates but never write to the vault. with a vault listing, the
 * form shows where the daily notes and template seem to be, and every path field suggests the
 * vault's folders or files while it has focus.
 */
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Accent, type AndroidPalette, useAndroidColors } from '@/constants/theme';
import { type DailyNoteDetection, detectDailyNotes, type ListedNote } from '@/features/daily-notes/detect';
import {
  type DailyNoteSettings,
  FILENAME_FORMATS,
  previewDailyNote,
  validateDailyNoteSettings,
} from '@/features/daily-notes/settings';
import { LAUNCH_NOTES, type LaunchNote } from '@/features/navigation/launch';
import { NEW_NOTE_LOCATIONS, newNoteContent, newNoteWhere, validateNewNoteSettings } from '@/features/new-notes/settings';
import { captureClock } from '@/features/templates/civil-time';
import { Button, Row, SectionTitle } from '@/features/workspace/android-ui';

import { VaultNative } from '../../../modules/vault/src';
import { buildPathCatalog, type PathCatalog, type PathSuggestion, suggestFolders, suggestTemplates } from './path-suggestions';
import type { NoteSettings } from './use-note-settings';

type Props = {
  vaultId: string;
  initial: NoteSettings;
  /** the vault's notes, for what was found and for suggestions; null while unknown. */
  notes: readonly ListedNote[] | null;
  /** first setup stands alone with its own title; otherwise the form is a screen in the stack. */
  firstSetup: boolean;
  onSave: (settings: NoteSettings) => void;
  onCancel?: () => void;
};

type Field = 'daily-folder' | 'daily-template' | 'new-folder' | 'new-template';

/** how long suggestions stay after their field loses focus, so a tap on a row still counts. */
const FOCUS_GRACE_MS = 250;

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** true when the settings already use everything that was found. */
function usesFound(detection: DailyNoteDetection, settings: DailyNoteSettings | null) {
  if (!settings) return false;
  const { daily, template } = detection;
  const folderMatches = !daily || (settings.folder === daily.folder && settings.filenameFormat === daily.format);
  return folderMatches && (!template || settings.templatePath === template);
}

type TemplateText = { path: string | null; text: string | null; error: string | null };

/** reads a template for a preview; never writes. `path` null means no template. */
function useTemplateText(vaultId: string, path: string | null): TemplateText {
  const [template, setTemplate] = useState<TemplateText>({ path: null, text: null, error: null });
  useEffect(() => {
    if (!path || !VaultNative) return;
    let cancelled = false;
    VaultNative.readText(vaultId, path).then(
      (result) => {
        if (cancelled) return;
        if (result.kind === 'text') setTemplate({ path, text: result.text, error: null });
        else if (result.kind === 'read-only') setTemplate({ path, text: null, error: 'The template is not UTF-8 text.' });
        else setTemplate({ path, text: null, error: `The template is ${result.state.kind === 'absent' ? 'missing' : 'not available'}.` });
      },
      (reason: unknown) => !cancelled && setTemplate({ path, text: null, error: String(reason) }),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, path]);
  return template;
}

/** the text a preview can use: ready when there is no template or it has been read. */
function templateFor(path: string | null, template: TemplateText): { ready: boolean; text: string | null; error: string | null } {
  if (!path) return { ready: true, text: null, error: null };
  if (template.path !== path) return { ready: false, text: null, error: null };
  return { ready: template.text !== null, text: template.text, error: template.error };
}

export function NoteSettingsForm({ vaultId, initial, notes, firstSetup, onSave, onCancel }: Props) {
  const palette = useAndroidColors();
  const insets = useSafeAreaInsets();
  const [dailyFolder, setDailyFolder] = useState(initial.daily.folder);
  const [filenameFormat, setFilenameFormat] = useState<string>(initial.daily.filenameFormat);
  const [dailyTemplate, setDailyTemplate] = useState(initial.daily.templatePath ?? '');
  const [launchNote, setLaunchNote] = useState<LaunchNote>(initial.launch.open);
  const [location, setLocation] = useState<string>(initial.newNote.location);
  const [newFolder, setNewFolder] = useState(initial.newNote.folder);
  const [newTemplate, setNewTemplate] = useState(initial.newNote.templatePath ?? '');

  const daily = useMemo(
    () => validateDailyNoteSettings({ folder: dailyFolder, filenameFormat, templatePath: dailyTemplate }),
    [dailyFolder, filenameFormat, dailyTemplate],
  );
  const newNote = useMemo(
    () => validateNewNoteSettings({ location, folder: newFolder, templatePath: newTemplate }),
    [location, newFolder, newTemplate],
  );
  const dailyTemplatePath = daily.ok ? daily.value.templatePath : null;
  const newTemplatePath = newNote.ok ? newNote.value.templatePath : null;
  const dailyTemplateText = templateFor(dailyTemplatePath, useTemplateText(vaultId, dailyTemplatePath));
  const newTemplateText = templateFor(newTemplatePath, useTemplateText(vaultId, newTemplatePath));

  // the field whose suggestions are shown. the catalog is built on the first focus, so opening
  // the form never waits for it.
  const [focused, setFocused] = useState<Field | null>(null);
  const [catalogWanted, setCatalogWanted] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );
  const detection = useMemo(() => (notes ? detectDailyNotes(notes) : null), [notes]);
  const catalog = useMemo(() => (catalogWanted && notes ? buildPathCatalog(notes) : null), [catalogWanted, notes]);

  const focusChange = (field: Field) => (isFocused: boolean) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
    if (isFocused) {
      setFocused(field);
      setCatalogWanted(true);
    } else {
      blurTimer.current = setTimeout(() => setFocused((current) => (current === field ? null : current)), FOCUS_GRACE_MS);
    }
  };
  const applyFound = () => {
    if (!detection) return;
    if (detection.daily) {
      setDailyFolder(detection.daily.folder);
      setFilenameFormat(detection.daily.format);
    }
    if (detection.template) setDailyTemplate(detection.template);
  };

  const now = captureClock();
  const dailyPreview =
    daily.ok && dailyTemplateText.ready ? previewDailyNote(daily.value, now, now, dailyTemplateText.text) : null;
  const newPreview = newNote.ok && newTemplateText.ready ? newNoteContent(newTemplateText.text, 'Untitled', now) : null;
  const dailyErrors = daily.ok ? {} : daily.error;
  const newErrors = newNote.ok ? {} : newNote.error;
  const canSave = daily.ok && newNote.ok && dailyPreview?.content.ok === true && newPreview?.ok === true;

  const pathField = (id: Field, label: string, value: string, setValue: (value: string) => void, placeholder: string, kind: 'folder' | 'file') => (
    <PathInput
      label={label}
      value={value}
      onChange={setValue}
      placeholder={placeholder}
      kind={kind}
      catalog={focused === id ? catalog : null}
      onFocusChange={focusChange(id)}
      onChoose={() => setFocused(null)}
    />
  );
  const footer = [styles.footer, { color: palette.secondary }];

  return (
    // first setup has no app bar: the status bar's height is kept clear, so scrolled text never
    // runs under the clock.
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { backgroundColor: palette.background, paddingTop: firstSetup ? insets.top : 0 }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: firstSetup ? 16 : 8, paddingBottom: insets.bottom + 24 }}>
        {firstSetup ? (
          <View style={styles.intro}>
            <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
              Set Up Notes
            </Text>
            <Text style={[styles.body, { color: palette.secondary }]}>
              Tell the app where your daily notes live and where new notes go. Existing notes open as they are; templates are
              used only for notes the app creates.
            </Text>
          </View>
        ) : null}
        {detection ? (
          <FoundSection palette={palette} detection={detection} onUse={usesFound(detection, daily.ok ? daily.value : null) ? null : applyFound} />
        ) : null}

        <SectionTitle>Daily note folder</SectionTitle>
        {pathField('daily-folder', 'Daily note folder', dailyFolder, setDailyFolder, 'Daily', 'folder')}
        <Text style={footer}>{dailyErrors.folder ?? 'Leave empty for the top of the vault.'}</Text>

        <SectionTitle>Daily note file name</SectionTitle>
        <View accessibilityRole="radiogroup" style={[styles.segments, { borderColor: palette.border }]}>
          {FILENAME_FORMATS.map((format) => {
            const selected = filenameFormat === format;
            return (
              <Pressable
                key={format}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setFilenameFormat(format)}
                android_ripple={{ color: palette.accentSoft }}
                style={[styles.segment, selected && { backgroundColor: palette.accentSoft }]}>
                <Text style={[styles.segmentText, { color: selected ? Accent : palette.text }]}>{format}</Text>
              </Pressable>
            );
          })}
        </View>

        <SectionTitle>Daily note template</SectionTitle>
        {pathField('daily-template', 'Daily note template', dailyTemplate, setDailyTemplate, 'Templates/Daily.md', 'file')}
        <Text style={footer}>{dailyErrors.templatePath ?? dailyTemplateText.error ?? 'Leave empty for the built-in template.'}</Text>

        <SectionTitle>Preview for today</SectionTitle>
        <View style={[styles.preview, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {dailyPreview ? (
            <>
              <Text style={[styles.code, { color: palette.secondary }]}>{dailyPreview.path}</Text>
              <Text selectable style={[styles.code, { color: palette.text }]}>
                {dailyPreview.content.ok ? dailyPreview.content.value : dailyPreview.content.error.message}
              </Text>
            </>
          ) : (
            <Text style={[styles.body, { color: palette.secondary }]}>
              {daily.ok ? (dailyTemplateText.error ?? 'Reading the template…') : 'Fix the daily note settings to see a preview.'}
            </Text>
          )}
        </View>

        <SectionTitle>On launch</SectionTitle>
        <View accessibilityRole="radiogroup">
          {LAUNCH_NOTES.map((option) => {
            const selected = launchNote === option.value;
            return (
              <Row
                key={option.value}
                icon={selected ? 'radio_button_checked' : 'radio_button_unchecked'}
                iconColor={selected ? Accent : undefined}
                title={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setLaunchNote(option.value)}
              />
            );
          })}
        </View>
        <Text style={footer}>{"Unsaved edits are always shown first. A note that is gone opens today's note."}</Text>

        <SectionTitle>New notes</SectionTitle>
        <View accessibilityRole="radiogroup">
          {NEW_NOTE_LOCATIONS.map((option) => {
            const selected = location === option.value;
            return (
              <Row
                key={option.value}
                icon={selected ? 'radio_button_checked' : 'radio_button_unchecked'}
                iconColor={selected ? Accent : undefined}
                title={option.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setLocation(option.value)}
              />
            );
          })}
        </View>
        {location === 'folder' ? pathField('new-folder', 'New note folder', newFolder, setNewFolder, 'Inbox', 'folder') : null}
        <Text style={footer}>{newErrors.folder ?? newErrors.location ?? 'Where New note puts a note. Tap a note\'s title to rename it.'}</Text>

        <SectionTitle>New note template</SectionTitle>
        {pathField('new-template', 'New note template', newTemplate, setNewTemplate, 'Templates/Note.md', 'file')}
        <Text style={footer}>{newErrors.templatePath ?? newTemplateText.error ?? 'Leave empty for an empty note.'}</Text>

        <SectionTitle>Preview of a new note</SectionTitle>
        <View style={[styles.preview, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {newNote.ok && newPreview ? (
            <>
              <Text style={[styles.code, { color: palette.secondary }]}>{newNoteWhere(newNote.value)}</Text>
              {!newPreview.ok ? (
                <Text style={[styles.code, { color: palette.text }]}>{newPreview.error.message}</Text>
              ) : newPreview.value === '' ? (
                <Text style={[styles.body, { color: palette.secondary }]}>An empty note</Text>
              ) : (
                <Text selectable style={[styles.code, { color: palette.text }]}>
                  {newPreview.value}
                </Text>
              )}
            </>
          ) : (
            <Text style={[styles.body, { color: palette.secondary }]}>
              {newNote.ok ? (newTemplateText.error ?? 'Reading the template…') : 'Fix the new note settings to see a preview.'}
            </Text>
          )}
        </View>

        <View style={styles.actions}>
          {onCancel ? <Button label="Cancel" onPress={onCancel} /> : null}
          <Button
            kind="filled"
            label={firstSetup ? 'Use These Settings' : 'Save'}
            onPress={() => {
              if (canSave && daily.ok && newNote.ok) onSave({ daily: daily.value, newNote: newNote.value, launch: { open: launchNote } });
            }}
            style={!canSave && styles.disabled}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * a path text field and, while it has focus, the vault's matching folders or files below it.
 * `catalog` is null when the field does not have focus.
 */
function PathInput({
  label,
  value,
  onChange,
  placeholder,
  kind,
  catalog,
  onFocusChange,
  onChoose,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  kind: 'folder' | 'file';
  catalog: PathCatalog | null;
  onFocusChange: (focused: boolean) => void;
  /** called after a suggestion filled the field. */
  onChoose: () => void;
}) {
  const palette = useAndroidColors();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const suggestions = useMemo(
    () => (catalog ? (kind === 'folder' ? suggestFolders(catalog, value) : suggestTemplates(catalog, value)) : []),
    [catalog, value, kind],
  );
  const choose = (path: string) => {
    onChange(path);
    onChoose();
    input.current?.blur();
  };
  return (
    <>
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChange}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        placeholder={placeholder}
        placeholderTextColor={palette.secondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        accessibilityLabel={label}
        selectionColor={Accent}
        style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]}
      />
      {suggestions.map((suggestion) => (
        <SuggestionRow key={suggestion.path} kind={kind} suggestion={suggestion} onChoose={choose} />
      ))}
    </>
  );
}

/**
 * what the file names suggest: the daily-note folder with its count and newest note, and the
 * daily template. `onUse` is null when the settings already match.
 */
function FoundSection({ palette, detection, onUse }: { palette: AndroidPalette; detection: DailyNoteDetection; onUse: (() => void) | null }) {
  const { daily, template } = detection;
  return (
    <>
      <SectionTitle>Found in this vault</SectionTitle>
      <Row
        icon="calendar_today"
        title={daily ? `${plural(daily.count, 'daily note')} in ${daily.folder || 'the top of the vault'}` : 'No daily notes found'}
        subtitle={daily ? `Newest: ${daily.latest} · ${daily.format}` : undefined}
      />
      <Row icon="description" title={template ? 'Daily template' : 'No daily template found'} subtitle={template ?? undefined} />
      {onUse ? <Button icon="check_circle" label="Use Found Settings" onPress={onUse} style={styles.found} /> : null}
      <Text style={[styles.footer, { color: palette.secondary }]}>
        {daily || template ? 'Found from the names of files in this vault.' : 'Choose a folder and template below, or keep the defaults.'}
      </Text>
    </>
  );
}

/** one suggestion under a field: the name, its folder below it, and a folder's note count. */
function SuggestionRow({ kind, suggestion, onChoose }: { kind: 'folder' | 'file'; suggestion: PathSuggestion; onChoose: (path: string) => void }) {
  const palette = useAndroidColors();
  const where = suggestion.parent ? `, in ${suggestion.parent}` : '';
  const label = kind === 'folder' ? `${suggestion.name} folder${where}, ${plural(suggestion.count ?? 0, 'note')}` : `${suggestion.name}${where}`;
  return (
    <Row
      icon={kind === 'folder' ? 'folder' : 'description'}
      title={suggestion.name}
      subtitle={suggestion.parent || undefined}
      accessibilityLabel={label}
      onPress={() => onChoose(suggestion.path)}
      trailing={
        suggestion.count !== undefined ? <Text style={[styles.count, { color: palette.secondary }]}>{String(suggestion.count)}</Text> : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  intro: {
    paddingHorizontal: 16,
    gap: 8,
  },
  heading: {
    fontSize: 28,
    fontWeight: '600',
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
  },
  input: {
    marginHorizontal: 16,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  footer: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  segments: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 15,
    fontWeight: '600',
  },
  preview: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  disabled: {
    opacity: 0.4,
  },
  found: {
    alignSelf: 'flex-start',
    marginLeft: 6,
  },
  count: {
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
});
