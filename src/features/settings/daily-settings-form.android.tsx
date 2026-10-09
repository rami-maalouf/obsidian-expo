/**
 * daily-note settings with a preview before they take effect (r12, flow f1), on android. the
 * preview reads the template but never writes to the vault. with a vault listing, the form
 * shows where the vault's daily notes and template seem to be, and the folder and template
 * fields suggest the vault's folders and files while they have focus.
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
import { captureClock } from '@/features/templates/civil-time';
import { Button, Row, SectionTitle } from '@/features/workspace/android-ui';

import { VaultNative } from '../../../modules/vault/src';
import { buildPathCatalog, type PathSuggestion, suggestFolders, suggestTemplates } from './path-suggestions';

type Props = {
  vaultId: string;
  initial: DailyNoteSettings;
  /** the vault's notes, for what was found and for suggestions; null while unknown. */
  notes: readonly ListedNote[] | null;
  /** first setup stands alone with its own title; otherwise the form is a screen in the stack. */
  firstSetup: boolean;
  onSave: (settings: DailyNoteSettings) => void;
  onCancel?: () => void;
};

type TemplateSource = { path: string | null; text: string | null; error: string | null };

type Field = 'folder' | 'template';

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

export function DailySettingsForm({ vaultId, initial, notes, firstSetup, onSave, onCancel }: Props) {
  const palette = useAndroidColors();
  const insets = useSafeAreaInsets();
  const folderField = useRef<ComponentRef<typeof TextInput>>(null);
  const templateField = useRef<ComponentRef<typeof TextInput>>(null);
  const [folder, setFolder] = useState(initial.folder);
  const [filenameFormat, setFilenameFormat] = useState<string>(initial.filenameFormat);
  const [templatePath, setTemplatePath] = useState(initial.templatePath ?? '');
  const [template, setTemplate] = useState<TemplateSource>({ path: null, text: null, error: null });
  const validated = useMemo(
    () => validateDailyNoteSettings({ folder, filenameFormat, templatePath }),
    [folder, filenameFormat, templatePath],
  );
  const wantedTemplate = validated.ok ? validated.value.templatePath : null;

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
  const folderSuggestions = useMemo(
    () => (catalog && focused === 'folder' ? suggestFolders(catalog, folder) : []),
    [catalog, focused, folder],
  );
  const templateSuggestions = useMemo(
    () => (catalog && focused === 'template' ? suggestTemplates(catalog, templatePath) : []),
    [catalog, focused, templatePath],
  );

  const focus = (field: Field) => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = null;
    setFocused(field);
    setCatalogWanted(true);
  };
  const blur = (field: Field) => () => {
    blurTimer.current = setTimeout(() => setFocused((current) => (current === field ? null : current)), FOCUS_GRACE_MS);
  };

  const chooseFolder = (path: string) => {
    setFolder(path);
    setFocused(null);
    folderField.current?.blur();
  };
  const chooseTemplate = (path: string) => {
    setTemplatePath(path);
    setFocused(null);
    templateField.current?.blur();
  };
  const applyFound = () => {
    if (!detection) return;
    if (detection.daily) {
      setFolder(detection.daily.folder);
      setFilenameFormat(detection.daily.format);
    }
    if (detection.template) setTemplatePath(detection.template);
  };

  useEffect(() => {
    if (!wantedTemplate || !VaultNative) return;
    let cancelled = false;
    VaultNative.readText(vaultId, wantedTemplate).then(
      (result) => {
        if (cancelled) return;
        if (result.kind === 'text') setTemplate({ path: wantedTemplate, text: result.text, error: null });
        else if (result.kind === 'read-only') setTemplate({ path: wantedTemplate, text: null, error: 'The template is not UTF-8 text.' });
        else setTemplate({ path: wantedTemplate, text: null, error: `The template is ${result.state.kind === 'absent' ? 'missing' : 'not available'}.` });
      },
      (reason: unknown) => !cancelled && setTemplate({ path: wantedTemplate, text: null, error: String(reason) }),
    );
    return () => {
      cancelled = true;
    };
  }, [vaultId, wantedTemplate]);

  const now = captureClock();
  const templateReady = !wantedTemplate || (template.path === wantedTemplate && template.text !== null);
  const preview =
    validated.ok && templateReady ? previewDailyNote(validated.value, now, now, wantedTemplate ? template.text : null) : null;
  const errors = validated.ok ? {} : validated.error;
  const canSave = validated.ok && preview !== null && preview.content.ok;

  const input = [styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }];
  const footer = [styles.footer, { color: palette.secondary }];

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: firstSetup ? insets.top + 16 : 8, paddingBottom: insets.bottom + 24 }}>
        {firstSetup ? (
          <View style={styles.intro}>
            <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>
              Daily notes
            </Text>
            <Text style={[styles.body, { color: palette.secondary }]}>
              Tell the app where your daily notes live. Existing notes are opened as they are; the template is used only for
              days without a note.
            </Text>
          </View>
        ) : null}
        {detection ? (
          <FoundSection palette={palette} detection={detection} onUse={usesFound(detection, validated.ok ? validated.value : null) ? null : applyFound} />
        ) : null}

        <SectionTitle>Folder</SectionTitle>
        <TextInput
          ref={folderField}
          value={folder}
          onChangeText={setFolder}
          onFocus={focus('folder')}
          onBlur={blur('folder')}
          placeholder="Daily"
          placeholderTextColor={palette.secondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="Folder"
          selectionColor={Accent}
          style={input}
        />
        {folderSuggestions.map((suggestion) => (
          <SuggestionRow key={suggestion.path} kind="folder" suggestion={suggestion} onChoose={chooseFolder} />
        ))}
        <Text style={footer}>{errors.folder ?? 'Leave empty for the top of the vault.'}</Text>

        <SectionTitle>File name</SectionTitle>
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

        <SectionTitle>Template</SectionTitle>
        <TextInput
          ref={templateField}
          value={templatePath}
          onChangeText={setTemplatePath}
          onFocus={focus('template')}
          onBlur={blur('template')}
          placeholder="Templates/Daily.md"
          placeholderTextColor={palette.secondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          accessibilityLabel="Template"
          selectionColor={Accent}
          style={input}
        />
        {templateSuggestions.map((suggestion) => (
          <SuggestionRow key={suggestion.path} kind="file" suggestion={suggestion} onChoose={chooseTemplate} />
        ))}
        <Text style={footer}>
          {errors.templatePath ?? (wantedTemplate && template.path === wantedTemplate && template.error) ?? 'Leave empty for the built-in template.'}
        </Text>

        <SectionTitle>Preview for today</SectionTitle>
        <View style={[styles.preview, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {preview ? (
            <>
              <Text style={[styles.code, { color: palette.secondary }]}>{preview.path}</Text>
              <Text selectable style={[styles.code, { color: palette.text }]}>
                {preview.content.ok ? preview.content.value : preview.content.error.message}
              </Text>
            </>
          ) : (
            <Text style={[styles.body, { color: palette.secondary }]}>
              {validated.ok ? 'Reading the template…' : 'Fix the settings above to see a preview.'}
            </Text>
          )}
        </View>

        <View style={styles.actions}>
          {onCancel ? <Button label="Cancel" onPress={onCancel} /> : null}
          <Button
            kind="filled"
            label={firstSetup ? 'Use These Settings' : 'Save'}
            onPress={() => {
              if (validated.ok && canSave) onSave(validated.value);
            }}
            style={!canSave && styles.disabled}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
