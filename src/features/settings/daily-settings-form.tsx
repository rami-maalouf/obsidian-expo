/**
 * daily-note settings with a preview before they take effect (r12, flow f1). the preview reads
 * the template but never writes to the vault.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  type DailyNoteSettings,
  FILENAME_FORMATS,
  previewDailyNote,
  validateDailyNoteSettings,
} from '@/features/daily-notes/settings';
import { captureClock } from '@/features/templates/civil-time';
import { useTheme } from '@/hooks/use-theme';

import { VaultNative } from '../../../modules/vault/src';

type Props = {
  vaultId: string;
  initial: DailyNoteSettings;
  firstSetup: boolean;
  onSave: (settings: DailyNoteSettings) => void;
  onCancel?: () => void;
};

type TemplateSource = { path: string | null; text: string | null; error: string | null };

export function DailySettingsForm({ vaultId, initial, firstSetup, onSave, onCancel }: Props) {
  const theme = useTheme();
  const [folder, setFolder] = useState(initial.folder);
  const [filenameFormat, setFilenameFormat] = useState<string>(initial.filenameFormat);
  const [templatePath, setTemplatePath] = useState(initial.templatePath ?? '');
  const [template, setTemplate] = useState<TemplateSource>({ path: null, text: null, error: null });
  const validated = useMemo(
    () => validateDailyNoteSettings({ folder, filenameFormat, templatePath }),
    [folder, filenameFormat, templatePath],
  );
  const wantedTemplate = validated.ok ? validated.value.templatePath : null;

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
  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];
  const errors = validated.ok ? {} : validated.error;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <ThemedText type="subtitle" accessibilityRole="header">
        Daily notes
      </ThemedText>
      {firstSetup && (
        <ThemedText themeColor="textSecondary">
          Tell the app where your daily notes live. Existing notes are opened as they are; the template is used only
          for days without a note.
        </ThemedText>
      )}
      <ThemedText type="smallBold">Folder</ThemedText>
      <TextInput value={folder} onChangeText={setFolder} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Daily notes folder" style={inputStyle} />
      {errors.folder && <ThemedText type="small">{errors.folder}</ThemedText>}
      <ThemedText type="smallBold">File name</ThemedText>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {FILENAME_FORMATS.map((format) => (
          <Pressable
            key={format}
            accessibilityRole="radio"
            accessibilityState={{ checked: filenameFormat === format }}
            onPress={() => setFilenameFormat(format)}
            style={[styles.choice, { backgroundColor: filenameFormat === format ? theme.backgroundSelected : theme.backgroundElement }]}>
            <ThemedText type="small">{format}</ThemedText>
          </Pressable>
        ))}
      </View>
      <ThemedText type="smallBold">Template (empty for the built-in template)</ThemedText>
      <TextInput
        value={templatePath}
        onChangeText={setTemplatePath}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Templates/Daily.md"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Daily note template path"
        style={inputStyle}
      />
      {errors.templatePath && <ThemedText type="small">{errors.templatePath}</ThemedText>}
      {wantedTemplate && template.path === wantedTemplate && template.error && <ThemedText type="small">{template.error}</ThemedText>}

      <ThemedText type="smallBold">Preview for today</ThemedText>
      {preview ? (
        <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="code">{preview.path}</ThemedText>
          {preview.content.ok ? (
            <ThemedText type="code" selectable>
              {preview.content.value}
            </ThemedText>
          ) : (
            <ThemedText type="small">{preview.content.error.message}</ThemedText>
          )}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {validated.ok ? 'Reading the template…' : 'Fix the settings above to see a preview.'}
        </ThemedText>
      )}
      <View style={styles.choices}>
        <Button
          title={firstSetup ? 'Use These Settings' : 'Save'}
          disabled={!validated.ok || !preview || !preview.content.ok}
          onPress={() => validated.ok && onSave(validated.value)}
        />
        {onCancel && <Button kind="plain" title="Cancel" onPress={onCancel} />}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  input: {
    minHeight: 44,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 17,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  choice: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    justifyContent: 'center',
  },
  preview: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
});
