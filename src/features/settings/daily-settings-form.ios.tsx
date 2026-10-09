/**
 * daily-note settings with a preview before they take effect (r12, flow f1), as a native form.
 * the preview reads the template but never writes to the vault. with a vault listing, the form
 * shows where the vault's daily notes and template seem to be, and the folder and template
 * fields suggest the vault's folders and files while they have focus, like the [[ link popup.
 */
import {
  Button,
  Form,
  Host,
  HStack,
  Label,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  type TextFieldRef,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  buttonStyle,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  navigationTitle,
  pickerStyle,
  scrollDismissesKeyboard,
  submitLabel,
  tag,
  textInputAutocapitalization,
  textSelection,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Accent, SystemColors } from '@/constants/theme';
import { type DailyNoteDetection, detectDailyNotes, type ListedNote } from '@/features/daily-notes/detect';
import {
  type DailyNoteSettings,
  FILENAME_FORMATS,
  previewDailyNote,
  validateDailyNoteSettings,
} from '@/features/daily-notes/settings';
import { captureClock } from '@/features/templates/civil-time';

import { VaultNative } from '../../../modules/vault/src';
import { buildPathCatalog, type PathSuggestion, suggestFolders, suggestTemplates } from './path-suggestions';

type Props = {
  vaultId: string;
  initial: DailyNoteSettings;
  /** the vault's notes, for what was found and for suggestions; null while unknown. */
  notes: readonly ListedNote[] | null;
  /** first setup stands alone with its own title; otherwise the form sits in a sheet. */
  firstSetup: boolean;
  onSave: (settings: DailyNoteSettings) => void;
  onCancel?: () => void;
};

type TemplateSource = { path: string | null; text: string | null; error: string | null };

type Field = 'folder' | 'template';

/**
 * how long suggestions stay after their field loses focus: a tap on a row can end editing just
 * before the tap itself arrives.
 */
const FOCUS_GRACE_MS = 250;

const primary = foregroundStyle({ type: 'hierarchical', style: 'primary' });
const secondary = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const detail = font({ size: 13 });
const code = font({ design: 'monospaced', size: 13 });
const plainInput = [autocorrectionDisabled(), textInputAutocapitalization('never'), submitLabel('done')];

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
  const folderText = useNativeState(initial.folder);
  const templateText = useNativeState(initial.templatePath ?? '');
  const folderField = useRef<TextFieldRef>(null);
  const templateField = useRef<TextFieldRef>(null);
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

  // writing the native text also reports the change through onTextChange; the state is set here
  // as well, so the preview does not wait for that round trip.
  const chooseFolder = (path: string) => {
    folderText.set(path);
    setFolder(path);
    setFocused(null);
    folderField.current?.blur();
  };
  const chooseTemplate = (path: string) => {
    templateText.set(path);
    setTemplatePath(path);
    setFocused(null);
    templateField.current?.blur();
  };
  const applyFound = () => {
    if (!detection) return;
    if (detection.daily) {
      folderText.set(detection.daily.folder);
      setFolder(detection.daily.folder);
      setFilenameFormat(detection.daily.format);
    }
    if (detection.template) {
      templateText.set(detection.template);
      setTemplatePath(detection.template);
    }
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

  const form = (
    <Form modifiers={[scrollDismissesKeyboard('interactively'), ...(firstSetup ? [navigationTitle('Daily notes')] : [])]}>
      {firstSetup ? (
        <Section>
          <Text modifiers={[secondary]}>
            Tell the app where your daily notes live. Existing notes are opened as they are; the template is used only
            for days without a note.
          </Text>
        </Section>
      ) : null}
      {detection ? (
        <FoundSection
          detection={detection}
          onUse={usesFound(detection, validated.ok ? validated.value : null) ? null : applyFound}
        />
      ) : null}
      <Section title="Folder" footer={<Text>{errors.folder ?? 'Leave empty for the top of the vault.'}</Text>}>
        <TextField
          ref={folderField}
          text={folderText}
          placeholder="Daily"
          onTextChange={setFolder}
          onFocusChange={focusChange('folder')}
          modifiers={plainInput}
        />
        {folderSuggestions.map((suggestion) => (
          <SuggestionRow key={suggestion.path} kind="folder" suggestion={suggestion} onChoose={chooseFolder} />
        ))}
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
        <TextField
          ref={templateField}
          text={templateText}
          placeholder="Templates/Daily.md"
          onTextChange={setTemplatePath}
          onFocusChange={focusChange('template')}
          modifiers={plainInput}
        />
        {templateSuggestions.map((suggestion) => (
          <SuggestionRow key={suggestion.path} kind="file" suggestion={suggestion} onChoose={chooseTemplate} />
        ))}
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

/**
 * what the file names suggest: the daily-note folder with its count and newest note, and the
 * daily template. `onUse` is null when the settings already match.
 */
function FoundSection({ detection, onUse }: { detection: DailyNoteDetection; onUse: (() => void) | null }) {
  const { daily, template } = detection;
  if (!daily && !template) {
    return (
      <Section title="Found in this vault" footer={<Text>Choose a folder and template below, or keep the defaults.</Text>}>
        <Label title="No daily notes or templates found" systemImage="magnifyingglass" modifiers={[secondary]} />
      </Section>
    );
  }
  return (
    <Section title="Found in this vault" footer={<Text>Found from the names of files in this vault.</Text>}>
      {daily ? (
        <Label systemImage="calendar">
          <VStack alignment="leading" spacing={2}>
            <Text>{`${plural(daily.count, 'daily note')} in ${daily.folder || 'the top of the vault'}`}</Text>
            <Text modifiers={[secondary, detail]}>{`Newest: ${daily.latest} · ${daily.format}`}</Text>
          </VStack>
        </Label>
      ) : (
        <Label title="No daily notes found" systemImage="calendar" modifiers={[secondary]} />
      )}
      {template ? (
        <Label systemImage="doc.text">
          <VStack alignment="leading" spacing={2}>
            <Text>Daily template</Text>
            <Text modifiers={[secondary, detail, lineLimit(1)]}>{template}</Text>
          </VStack>
        </Label>
      ) : (
        <Label title="No daily template found" systemImage="doc.text" modifiers={[secondary]} />
      )}
      {onUse ? <Button label="Use Found Settings" systemImage="checkmark.circle" onPress={onUse} /> : null}
    </Section>
  );
}

/** one suggestion under a field: the name, its folder below it, and a folder's note count. */
function SuggestionRow({
  kind,
  suggestion,
  onChoose,
}: {
  kind: 'folder' | 'file';
  suggestion: PathSuggestion;
  onChoose: (path: string) => void;
}) {
  const where = suggestion.parent ? `, in ${suggestion.parent}` : '';
  const label =
    kind === 'folder'
      ? `${suggestion.name} folder${where}, ${plural(suggestion.count ?? 0, 'note')}`
      : `${suggestion.name}${where}`;
  return (
    <Button onPress={() => onChoose(suggestion.path)} modifiers={[accessibilityLabel(label)]}>
      <Label systemImage={kind === 'folder' ? 'folder' : 'doc.text'}>
        <HStack spacing={8}>
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[primary, lineLimit(1)]}>{suggestion.name}</Text>
            {suggestion.parent ? <Text modifiers={[secondary, detail, lineLimit(1)]}>{suggestion.parent}</Text> : null}
          </VStack>
          <Spacer />
          {suggestion.count !== undefined ? (
            <Text modifiers={[secondary, detail, monospacedDigit()]}>{String(suggestion.count)}</Text>
          ) : null}
        </HStack>
      </Label>
    </Button>
  );
}
