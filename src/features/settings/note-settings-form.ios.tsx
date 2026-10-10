/**
 * note settings with previews before they take effect (r5, r12, flow f1), as a native form: where
 * daily notes live and which template fills them, which note a launch opens, then where new notes
 * go and which template fills those. the previews read the templates but never write to the vault. with a vault
 * listing, the form shows where the daily notes and template seem to be, and every path field
 * suggests the vault's folders or files while it has focus, like the [[ link popup.
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
  disabled,
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
import { isLaunchNote, LAUNCH_NOTES } from '@/features/navigation/launch';
import { NEW_NOTE_LOCATIONS, newNoteContent, newNoteWhere, validateNewNoteSettings } from '@/features/new-notes/settings';
import { captureClock } from '@/features/templates/civil-time';

import { VaultNative } from '../../../modules/vault/src';
import { buildPathCatalog, type PathCatalog, type PathSuggestion, suggestFolders, suggestTemplates } from './path-suggestions';
import type { NoteSettings } from './use-note-settings';

type Props = {
  vaultId: string;
  initial: NoteSettings;
  /** the vault's notes, for what was found and for suggestions; null while unknown. */
  notes: readonly ListedNote[] | null;
  /** first setup stands alone with its own title; otherwise the form sits in a sheet. */
  firstSetup: boolean;
  onSave: (settings: NoteSettings) => void;
  onCancel?: () => void;
};

type Field = 'daily-folder' | 'daily-template' | 'new-folder' | 'new-template';

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

/**
 * a text field whose value both native ui and the form read. `choose` fills it from a
 * suggestion: writing the native text also reports the change through onTextChange, and the
 * state is set here as well, so the previews do not wait for that round trip.
 */
function usePathField(initial: string) {
  const text = useNativeState(initial);
  const [value, setValue] = useState(initial);
  const set = (next: string) => {
    text.set(next);
    setValue(next);
  };
  return { text, value, setValue, set };
}

type PathField = ReturnType<typeof usePathField>;

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
  const dailyFolder = usePathField(initial.daily.folder);
  const dailyTemplate = usePathField(initial.daily.templatePath ?? '');
  const [filenameFormat, setFilenameFormat] = useState<string>(initial.daily.filenameFormat);
  const [launchNote, setLaunchNote] = useState<string>(initial.launch.open);
  const [location, setLocation] = useState<string>(initial.newNote.location);
  const newFolder = usePathField(initial.newNote.folder);
  const newTemplate = usePathField(initial.newNote.templatePath ?? '');

  const daily = useMemo(
    () => validateDailyNoteSettings({ folder: dailyFolder.value, filenameFormat, templatePath: dailyTemplate.value }),
    [dailyFolder.value, filenameFormat, dailyTemplate.value],
  );
  const newNote = useMemo(
    () => validateNewNoteSettings({ location, folder: newFolder.value, templatePath: newTemplate.value }),
    [location, newFolder.value, newTemplate.value],
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
  // the native text fields, so choosing a suggestion can end editing.
  const inputs = useRef<Partial<Record<Field, TextFieldRef | null>>>({});
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
  const choose = (field: PathField, id: Field) => (path: string) => {
    field.set(path);
    setFocused(null);
    inputs.current[id]?.blur();
  };
  const applyFound = () => {
    if (!detection) return;
    if (detection.daily) {
      dailyFolder.set(detection.daily.folder);
      setFilenameFormat(detection.daily.format);
    }
    if (detection.template) {
      dailyTemplate.set(detection.template);
    }
  };

  const now = captureClock();
  const dailyPreview =
    daily.ok && dailyTemplateText.ready ? previewDailyNote(daily.value, now, now, dailyTemplateText.text) : null;
  const newPreview = newNote.ok && newTemplateText.ready ? newNoteContent(newTemplateText.text, 'Untitled', now) : null;
  const dailyErrors = daily.ok ? {} : daily.error;
  const newErrors = newNote.ok ? {} : newNote.error;
  const canSave = daily.ok && newNote.ok && dailyPreview?.content.ok === true && newPreview?.ok === true;

  const pathField = (field: PathField, id: Field, placeholder: string, kind: 'folder' | 'file') => (
    <PathInput
      field={field}
      inputRef={(input) => {
        inputs.current[id] = input;
      }}
      placeholder={placeholder}
      kind={kind}
      catalog={focused === id ? catalog : null}
      onFocusChange={focusChange(id)}
      onChoose={choose(field, id)}
    />
  );

  const form = (
    <Form modifiers={[scrollDismissesKeyboard('interactively'), ...(firstSetup ? [navigationTitle('Set Up Notes')] : [])]}>
      {firstSetup ? (
        <Section>
          <Text modifiers={[secondary]}>
            Tell the app where your daily notes live and where new notes go. Existing notes open as they are; templates
            are used only for notes the app creates.
          </Text>
        </Section>
      ) : null}
      {detection ? (
        <FoundSection detection={detection} onUse={usesFound(detection, daily.ok ? daily.value : null) ? null : applyFound} />
      ) : null}

      <Section title="Daily note folder" footer={<Text>{dailyErrors.folder ?? 'Leave empty for the top of the vault.'}</Text>}>
        {pathField(dailyFolder, 'daily-folder', 'Daily', 'folder')}
      </Section>
      <Section title="Daily note file name">
        <Picker
          label="File name"
          selection={filenameFormat}
          onSelectionChange={(value: string) => setFilenameFormat(value)}
          modifiers={[pickerStyle('segmented')]}>
          {FILENAME_FORMATS.map((format) => (
            <Text key={format} modifiers={[tag(format)]}>
              {format}
            </Text>
          ))}
        </Picker>
      </Section>
      <Section
        title="Daily note template"
        footer={<Text>{dailyErrors.templatePath ?? dailyTemplateText.error ?? 'Leave empty for the built-in template.'}</Text>}>
        {pathField(dailyTemplate, 'daily-template', 'Templates/Daily.md', 'file')}
      </Section>
      <Section title="Preview for today">
        {dailyPreview ? (
          <>
            <Text modifiers={[code, secondary]}>{dailyPreview.path}</Text>
            {dailyPreview.content.ok ? (
              <Text modifiers={[code, textSelection(true)]}>{dailyPreview.content.value}</Text>
            ) : (
              <Text modifiers={[code]}>{dailyPreview.content.error.message}</Text>
            )}
          </>
        ) : (
          <Text modifiers={[secondary]}>
            {daily.ok ? (dailyTemplateText.error ?? 'Reading the template…') : 'Fix the daily note settings to see a preview.'}
          </Text>
        )}
      </Section>

      <Section title="On launch" footer={<Text>{"Unsaved edits are always shown first. A note that is gone opens today's note."}</Text>}>
        <Picker label="Open" selection={launchNote} onSelectionChange={(value: string) => setLaunchNote(value)} modifiers={[pickerStyle('menu')]}>
          {LAUNCH_NOTES.map((option) => (
            <Text key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </Text>
          ))}
        </Picker>
      </Section>

      <Section
        title="New notes"
        footer={<Text>{newErrors.folder ?? newErrors.location ?? 'Where New Note puts a note. Tap a note\'s title to rename it.'}</Text>}>
        <Picker label="Location" selection={location} onSelectionChange={(value: string) => setLocation(value)} modifiers={[pickerStyle('menu')]}>
          {NEW_NOTE_LOCATIONS.map((option) => (
            <Text key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </Text>
          ))}
        </Picker>
        {location === 'folder' ? pathField(newFolder, 'new-folder', 'Inbox', 'folder') : null}
      </Section>
      <Section
        title="New note template"
        footer={<Text>{newErrors.templatePath ?? newTemplateText.error ?? 'Leave empty for an empty note.'}</Text>}>
        {pathField(newTemplate, 'new-template', 'Templates/Note.md', 'file')}
      </Section>
      <Section title="Preview of a new note">
        {newNote.ok && newPreview ? (
          <>
            <Text modifiers={[code, secondary]}>{newNoteWhere(newNote.value)}</Text>
            {!newPreview.ok ? (
              <Text modifiers={[code]}>{newPreview.error.message}</Text>
            ) : newPreview.value === '' ? (
              <Text modifiers={[secondary]}>An empty note</Text>
            ) : (
              <Text modifiers={[code, textSelection(true)]}>{newPreview.value}</Text>
            )}
          </>
        ) : (
          <Text modifiers={[secondary]}>
            {newNote.ok ? (newTemplateText.error ?? 'Reading the template…') : 'Fix the new note settings to see a preview.'}
          </Text>
        )}
      </Section>

      <Section>
        <Button
          label={firstSetup ? 'Use These Settings' : 'Save'}
          onPress={() =>
            canSave &&
            daily.ok &&
            newNote.ok &&
            onSave({ daily: daily.value, newNote: newNote.value, launch: { open: isLaunchNote(launchNote) ? launchNote : initial.launch.open } })
          }
          modifiers={[buttonStyle('borderedProminent'), disabled(!canSave)]}
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
 * a path text field and, while it has focus, the vault's matching folders or files below it.
 * `catalog` is null when the field does not have focus.
 */
function PathInput({
  field,
  inputRef,
  placeholder,
  kind,
  catalog,
  onFocusChange,
  onChoose,
}: {
  field: PathField;
  inputRef: (input: TextFieldRef | null) => void;
  placeholder: string;
  kind: 'folder' | 'file';
  catalog: PathCatalog | null;
  onFocusChange: (focused: boolean) => void;
  onChoose: (path: string) => void;
}) {
  const suggestions = useMemo(
    () => (catalog ? (kind === 'folder' ? suggestFolders(catalog, field.value) : suggestTemplates(catalog, field.value)) : []),
    [catalog, field.value, kind],
  );
  return (
    <>
      <TextField
        ref={inputRef}
        text={field.text}
        placeholder={placeholder}
        onTextChange={field.setValue}
        onFocusChange={onFocusChange}
        modifiers={plainInput}
      />
      {suggestions.map((suggestion) => (
        <SuggestionRow key={suggestion.path} kind={kind} suggestion={suggestion} onChoose={onChoose} />
      ))}
    </>
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
