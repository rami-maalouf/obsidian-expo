/**
 * daily-note settings with a preview before they take effect (r12, flow f1), as a native form.
 * the preview reads the template but never writes to the vault.
 */
import { Button, Form, Host, NavigationStack, Picker, Section, Text, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  buttonStyle,
  font,
  foregroundStyle,
  navigationTitle,
  pickerStyle,
  tag,
  textInputAutocapitalization,
  textSelection,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useMemo, useState } from 'react';

import { Accent, SystemColors } from '@/constants/theme';
import {
  type DailyNoteSettings,
  FILENAME_FORMATS,
  previewDailyNote,
  validateDailyNoteSettings,
} from '@/features/daily-notes/settings';
import { captureClock } from '@/features/templates/civil-time';

import { VaultNative } from '../../../modules/vault/src';

type Props = {
  vaultId: string;
  initial: DailyNoteSettings;
  /** first setup stands alone with its own title; otherwise the form sits in a sheet. */
  firstSetup: boolean;
  onSave: (settings: DailyNoteSettings) => void;
  onCancel?: () => void;
};

type TemplateSource = { path: string | null; text: string | null; error: string | null };

const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const code = font({ design: 'monospaced', size: 13 });
const plainInput = [autocorrectionDisabled(), textInputAutocapitalization('never')];

export function DailySettingsForm({ vaultId, initial, firstSetup, onSave, onCancel }: Props) {
  const folderText = useNativeState(initial.folder);
  const templateText = useNativeState(initial.templatePath ?? '');
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
  const errors = validated.ok ? {} : validated.error;

  const form = (
    <Form modifiers={firstSetup ? [navigationTitle('Daily notes')] : []}>
      {firstSetup ? (
        <Section>
          <Text modifiers={[secondary]}>
            Tell the app where your daily notes live. Existing notes are opened as they are; the template is used only
            for days without a note.
          </Text>
        </Section>
      ) : null}
      <Section title="Folder" footer={errors.folder ? <Text>{errors.folder}</Text> : undefined}>
        <TextField text={folderText} placeholder="Daily" onTextChange={setFolder} modifiers={plainInput} />
      </Section>
      <Section title="File name">
        <Picker label="File name" selection={filenameFormat} onSelectionChange={(value: string) => setFilenameFormat(value)} modifiers={[pickerStyle('segmented')]}>
          {FILENAME_FORMATS.map((format) => (
            <Text key={format} modifiers={[tag(format)]}>
              {format}
            </Text>
          ))}
        </Picker>
      </Section>
      <Section
        title="Template"
        footer={
          <Text>
            {errors.templatePath ??
              (wantedTemplate && template.path === wantedTemplate && template.error) ??
              'Leave empty for the built-in template.'}
          </Text>
        }>
        <TextField text={templateText} placeholder="Templates/Daily.md" onTextChange={setTemplatePath} modifiers={plainInput} />
      </Section>
      <Section title="Preview for today">
        {preview ? (
          <>
            <Text modifiers={[code, secondary]}>{preview.path}</Text>
            {preview.content.ok ? (
              <Text modifiers={[code, textSelection(true)]}>{preview.content.value}</Text>
            ) : (
              <Text modifiers={[code]}>{preview.content.error.message}</Text>
            )}
          </>
        ) : (
          <Text modifiers={[secondary]}>{validated.ok ? 'Reading the template…' : 'Fix the settings above to see a preview.'}</Text>
        )}
      </Section>
      <Section>
        <Button
          label={firstSetup ? 'Use These Settings' : 'Save'}
          onPress={() => validated.ok && preview?.content.ok && onSave(validated.value)}
          modifiers={[buttonStyle('borderedProminent')]}
        />
        {onCancel ? <Button label="Cancel" onPress={onCancel} /> : null}
      </Section>
    </Form>
  );

  return (
    <Host style={{ flex: 1, backgroundColor: SystemColors.background }} modifiers={[tint(Accent)]}>
      {firstSetup ? <NavigationStack>{form}</NavigationStack> : form}
    </Host>
  );
}

