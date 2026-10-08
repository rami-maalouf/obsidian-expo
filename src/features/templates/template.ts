/**
 * parser and renderer for the Templater-compatible subset in KTD6, including its extension for
 * date scripts (october 8, 2026). nothing in a template is ever run as code.
 *
 * supported:
 *   <% tp.file.title %>
 *   <% tp.date.now(format?, offset?, reference?, reference_format?) %>
 *   <%* let name = moment(...)...; %>   date definitions only; see `ScriptParser`
 *   <% name %>                          text defined by an earlier script
 *   <%- and -%>                         remove one line break before or after a tag
 *
 * formats are Moment patterns limited to `PATTERN_FIELDS`. text outside tags is copied
 * verbatim. every other tag form, statement, command, argument, or format is an error, reported
 * before any caller creates files or folders.
 */
import {
  addDays,
  type CivilDate,
  type CivilDateTime,
  type DatePattern,
  formatPattern,
  isDateReadingPattern,
  isReferenceFormat,
  parseCivilDate,
  parseDatePattern,
  parseWithPattern,
  REFERENCE_FORMATS,
  type ReferenceFormat,
} from './civil-time';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export type TemplateErrorCode =
  | 'unclosed-tag'
  | 'execution-tag'
  | 'dynamic-tag'
  | 'whitespace-control'
  | 'unsupported-command'
  | 'unsupported-argument'
  | 'unsupported-format'
  | 'invalid-reference'
  | 'date-out-of-range';

export type TemplateError = {
  code: TemplateErrorCode;
  message: string;
  /** 1-based position of the tag's `<%` in the template source. */
  line: number;
  column: number;
  /** utf-16 offsets of the offending tag in the source, for highlighting. */
  start: number;
  end: number;
  /** the offending tag, shortened for display. */
  tag: string;
};

type Reference = { kind: 'literal'; date: CivilDate } | { kind: 'title'; format: ReferenceFormat };

type TagNode = { start: number; tag: string };

/** where a script date comes from: the clock, the note's name, or an earlier date variable. */
type DateSource =
  | { kind: 'now' }
  | { kind: 'title'; pattern: DatePattern }
  | { kind: 'variable'; name: string };

/** one `let name = ...` definition: a date moved by whole days, then formatted as text or not. */
export type ScriptDefinition = { name: string; source: DateSource; offsetDays: number; format: DatePattern | null };

export type TemplateNode =
  | { kind: 'text'; text: string }
  | ({ kind: 'title' } & TagNode)
  | ({ kind: 'date'; format: DatePattern; offsetDays: number; reference: Reference | null } & TagNode)
  | ({ kind: 'script'; definitions: ScriptDefinition[] } & TagNode)
  | ({ kind: 'variable'; name: string } & TagNode);

export type ParsedTemplate = { source: string; nodes: TemplateNode[] };

export type ExpansionContext = {
  /** basename of the destination note without `.md`. */
  title: string;
  /** wall clock captured once for the whole expansion. */
  now: CivilDateTime;
};

const DEFAULT_DATE_FORMAT = parseDatePattern('YYYY-MM-DD') as DatePattern;
const MAX_TAG_DISPLAY = 80;
const SUPPORTED_SUMMARY =
  'Supported: <% tp.file.title %>, <% tp.date.now(...) %>, and dates defined in <%* let name = moment(...) %>.';
const FORMAT_HELP = 'Use YYYY, MM, DD, HH, mm, ss, and WW, with - : / . , _ spaces, T, or [text] between them.';
const SCRIPT_HELP =
  'Scripts may only define dates: let name = moment(tp.file.title, "YYYY-MM-DD"), moment(name), or moment(), followed by .add(days, "d"), .subtract(days, "d"), or .format("pattern").';
const REFERENCE_FORMAT_LIST = REFERENCE_FORMATS.map((format) => `"${format}"`).join(' or ');

function position(source: string, index: number) {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function shorten(tag: string) {
  return tag.length > MAX_TAG_DISPLAY ? `${tag.slice(0, MAX_TAG_DISPLAY - 1)}…` : tag;
}

class TagError extends Error {
  constructor(
    readonly code: TemplateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function templateError(source: string, start: number, tag: string, code: TemplateErrorCode, message: string) {
  const { line, column } = position(source, start);
  const end = start + tag.length;
  return {
    ok: false as const,
    error: { code, message: `Line ${line}: ${message}`, line, column, start, end, tag: shorten(tag) },
  };
}

type Token =
  | { kind: 'name'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'punct'; value: '(' | ')' | ',' };

const NAME = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/;
const NUMBER = /^[+-]?\d+(?:\.\d+)?/;

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let rest = expression;
  while (rest.length > 0) {
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      rest = rest.slice(whitespace[0].length);
      continue;
    }
    const first = rest[0];
    if (first === '(' || first === ')' || first === ',') {
      tokens.push({ kind: 'punct', value: first });
      rest = rest.slice(1);
      continue;
    }
    if (first === '"' || first === "'") {
      const end = rest.indexOf(first, 1);
      const value = end === -1 ? '' : rest.slice(1, end);
      if (end === -1 || /[\\\n\r]/.test(value)) {
        throw new TagError('unsupported-argument', 'Strings must be plain quoted text on one line.');
      }
      tokens.push({ kind: 'string', value });
      rest = rest.slice(end + 1);
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ kind: 'number', value: number[0] });
      rest = rest.slice(number[0].length);
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      tokens.push({ kind: 'name', value: name[0] });
      rest = rest.slice(name[0].length);
      continue;
    }
    throw new TagError(
      'unsupported-command',
      `"${rest.trim().slice(0, 20)}" is not supported. Expressions, variables, and code are not evaluated. ${SUPPORTED_SUMMARY}`,
    );
  }
  return tokens;
}

function display(token: Token | undefined) {
  if (!token) return 'nothing';
  return token.kind === 'string' ? `"${token.value}"` : token.value;
}

function parseOffset(token: Token): number {
  if (token.kind === 'string') {
    throw new TagError(
      'unsupported-argument',
      `Offset ${display(token)} is not supported. Use a whole number of days, such as -1 or 1.`,
    );
  }
  if (token.kind !== 'number' || token.value.includes('.')) {
    throw new TagError('unsupported-argument', `Offset ${display(token)} must be a whole number of days, such as -1 or 1.`);
  }
  const offset = Number(token.value);
  if (!Number.isSafeInteger(offset)) {
    throw new TagError('unsupported-argument', `Offset ${token.value} is too large.`);
  }
  return offset;
}

function quotedString(token: Token, what: string): string {
  if (token.kind !== 'string') {
    throw new TagError('unsupported-argument', `${what} ${display(token)} must be a quoted string.`);
  }
  return token.value;
}

function datePattern(value: string): DatePattern {
  const pattern = parseDatePattern(value);
  if (!pattern) {
    throw new TagError('unsupported-format', `Date format "${value}" is not supported. ${FORMAT_HELP}`);
  }
  return pattern;
}

function parseFormat(token: Token): DatePattern {
  return datePattern(quotedString(token, 'Date format'));
}

function parseReferenceFormat(token: Token): ReferenceFormat {
  const value = quotedString(token, 'Reference format');
  if (!isReferenceFormat(value)) {
    throw new TagError('unsupported-format', `Reference format "${value}" is not supported. Use ${REFERENCE_FORMAT_LIST}.`);
  }
  return value;
}

/** parses `tp.date.now(...)` arguments: each argument is exactly one token. */
function parseDateArguments(args: Token[][]) {
  if (args.length > 4) {
    throw new TagError('unsupported-argument', 'tp.date.now accepts at most 4 arguments.');
  }
  const single = args.map((arg, index) => {
    if (arg.length !== 1) {
      throw new TagError(
        'unsupported-argument',
        `Argument ${index + 1} of tp.date.now must be a single value, not ${arg.length === 0 ? 'empty' : 'an expression'}.`,
      );
    }
    return arg[0];
  });
  const [formatToken, offsetToken, referenceToken, referenceFormatToken] = single;
  const format = formatToken ? parseFormat(formatToken) : DEFAULT_DATE_FORMAT;
  const offsetDays = offsetToken ? parseOffset(offsetToken) : 0;
  if (!referenceToken) {
    return { format, offsetDays, reference: null };
  }
  if (!referenceFormatToken) {
    throw new TagError(
      'unsupported-argument',
      `A reference date needs an explicit fourth argument: ${REFERENCE_FORMAT_LIST}.`,
    );
  }
  const referenceFormat = parseReferenceFormat(referenceFormatToken);
  if (referenceToken.kind === 'name' && referenceToken.value === 'tp.file.title') {
    return { format, offsetDays, reference: { kind: 'title' as const, format: referenceFormat } };
  }
  if (referenceToken.kind !== 'string') {
    throw new TagError(
      'unsupported-argument',
      `Reference ${display(referenceToken)} is not supported. Use a quoted date or tp.file.title.`,
    );
  }
  const date = parseCivilDate(referenceToken.value, referenceFormat);
  if (!date) {
    throw new TagError(
      'invalid-reference',
      `Reference date "${referenceToken.value}" is not a valid ${referenceFormat} date.`,
    );
  }
  return { format, offsetDays, reference: { kind: 'literal' as const, date } };
}

function parseExpression(expression: string, start: number, tag: string, declared: Declared): TemplateNode {
  const tokens = tokenize(expression);
  const [head, next] = tokens;
  if (!head) {
    throw new TagError('unsupported-command', `Empty tag. ${SUPPORTED_SUMMARY}`);
  }
  if (head.kind === 'name' && declared.has(head.value)) {
    if (tokens.length > 1) {
      throw new TagError('unsupported-command', `Only ${head.value} by itself is supported, not ${head.value} followed by ${display(next)}.`);
    }
    if (declared.get(head.value) === 'date') {
      throw new TagError(
        'unsupported-command',
        `${head.value} is a date, not text. Format it in the script, for example let ${head.value}Text = ${head.value}.format("YYYY-MM-DD").`,
      );
    }
    return { kind: 'variable', name: head.value, start, tag };
  }
  if (head.kind !== 'name' || (head.value !== 'tp.file.title' && head.value !== 'tp.date.now')) {
    throw new TagError('unsupported-command', `${display(head)} is not supported. ${SUPPORTED_SUMMARY}`);
  }
  if (head.value === 'tp.file.title') {
    if (tokens.length > 1) {
      throw new TagError(
        'unsupported-command',
        `Only tp.file.title by itself is supported, not tp.file.title followed by ${display(next)}.`,
      );
    }
    return { kind: 'title', start, tag };
  }
  if (next?.kind !== 'punct' || next.value !== '(') {
    throw new TagError('unsupported-command', 'Call tp.date.now with parentheses, such as tp.date.now().');
  }
  const isClose = (token: Token) => token.kind === 'punct' && token.value === ')';
  if (!tokens.some(isClose)) {
    throw new TagError('unsupported-argument', 'tp.date.now( is missing its closing parenthesis.');
  }
  const last = tokens[tokens.length - 1];
  if (!isClose(last)) {
    throw new TagError(
      'unsupported-command',
      `Only one tp.date.now(...) call is allowed in a tag; found ${display(last)} after it.`,
    );
  }
  const inner = tokens.slice(2, -1);
  const args: Token[][] = inner.length === 0 ? [] : [[]];
  for (const token of inner) {
    if (token.kind === 'punct' && token.value === ',') {
      args.push([]);
    } else if (token.kind === 'punct') {
      throw new TagError('unsupported-argument', 'Nested calls and parentheses are not supported in arguments.');
    } else {
      args[args.length - 1].push(token);
    }
  }
  return { kind: 'date', ...parseDateArguments(args), start, tag };
}

/** variables defined so far, in source order, and whether each holds a date or text. */
type Declared = Map<string, 'date' | 'text'>;

/** `afterLineBreak` lets a line break end a definition, as JavaScript's automatic semicolons do. */
type ScriptToken = { kind: 'name' | 'string' | 'number' | 'punct'; value: string; afterLineBreak?: boolean };

const DECLARATIONS = new Set(['let', 'const', 'var']);
const RESERVED = new Set(['tp', 'moment', 'tR', 'app', 'await', 'function', 'return', 'new', 'this', ...DECLARATIONS]);
const DAY_UNITS: Record<string, number> = { d: 1, day: 1, days: 1, w: 7, week: 7, weeks: 7 };

function tokenizeScript(body: string): ScriptToken[] {
  const tokens: ScriptToken[] = [];
  let rest = body;
  let lineBreak = false;
  const push = (token: ScriptToken) => {
    tokens.push(lineBreak ? { ...token, afterLineBreak: true } : token);
    lineBreak = false;
  };
  while (rest.length > 0) {
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      lineBreak ||= /[\n\r]/.test(whitespace[0]);
      rest = rest.slice(whitespace[0].length);
      continue;
    }
    const first = rest[0];
    if ('(),;=.'.includes(first)) {
      push({ kind: 'punct', value: first });
      rest = rest.slice(1);
      continue;
    }
    if (first === '"' || first === "'") {
      const end = rest.indexOf(first, 1);
      const value = end === -1 ? '' : rest.slice(1, end);
      if (end === -1 || /[\\\n\r]/.test(value)) {
        throw new TagError('execution-tag', `Strings in scripts must be plain quoted text on one line. ${SCRIPT_HELP}`);
      }
      push({ kind: 'string', value });
      rest = rest.slice(end + 1);
      continue;
    }
    const number = /^[+-]?\d+/.exec(rest);
    if (number) {
      push({ kind: 'number', value: number[0] });
      rest = rest.slice(number[0].length);
      continue;
    }
    const name = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (name) {
      push({ kind: 'name', value: name[0] });
      rest = rest.slice(name[0].length);
      continue;
    }
    throw new TagError('execution-tag', `"${rest.trim().slice(0, 20)}" is not supported in a script. ${SCRIPT_HELP}`);
  }
  return tokens;
}

/**
 * reads the date definitions a `<%* ... %>` script may contain, and nothing else:
 *
 *   (let | const | var) name = moment(tp.file.title, "pattern") | moment(date) | moment() | date
 *                              { .add(n, unit) | .subtract(n, unit) } [ .format("pattern") ]
 *
 * units are days or weeks. `.add` and `.subtract` must follow `moment(...)`, because in
 * Templater they would change the variable they are called on. no part of the script is run.
 */
class ScriptParser {
  private index = 0;

  constructor(
    private readonly tokens: ScriptToken[],
    private readonly declared: Declared,
  ) {}

  parse(): ScriptDefinition[] {
    const definitions: ScriptDefinition[] = [];
    while (this.index < this.tokens.length) {
      if (this.accept('punct', ';')) {
        continue;
      }
      definitions.push(this.definition());
      const after = this.peek();
      const nextDefinition = after?.kind === 'name' && DECLARATIONS.has(after.value) && after.afterLineBreak;
      if (after && !(after.kind === 'punct' && after.value === ';') && !nextDefinition) {
        this.fail(`Found ${this.show(after)} after a definition.`);
      }
    }
    if (definitions.length === 0) {
      this.fail('This script defines nothing.');
    }
    return definitions;
  }

  private definition(): ScriptDefinition {
    const keyword = this.next();
    if (keyword?.kind !== 'name' || !DECLARATIONS.has(keyword.value)) {
      this.fail(`${this.show(keyword)} is not supported; only definitions such as let name = moment(...) are.`);
    }
    const name = this.next();
    if (name?.kind !== 'name' || RESERVED.has(name.value)) {
      this.fail(`${this.show(name)} cannot be a variable name.`);
    }
    if (this.declared.has(name.value)) {
      this.fail(`${name.value} is defined twice.`);
    }
    this.expect('punct', '=');
    const value = this.value();
    this.declared.set(name.value, value.format ? 'text' : 'date');
    return { name: name.value, ...value };
  }

  private value(): Omit<ScriptDefinition, 'name'> {
    const head = this.next();
    let source: DateSource;
    let copy = false;
    if (head?.kind === 'name' && head.value === 'moment') {
      this.expect('punct', '(');
      source = this.momentArgument();
      this.expect('punct', ')');
      copy = true;
    } else if (head?.kind === 'name' && this.declared.get(head.value) === 'date') {
      source = { kind: 'variable', name: head.value };
    } else if (head?.kind === 'name' && this.declared.get(head.value) === 'text') {
      this.fail(`${head.value} is text; only dates can be moved or formatted.`);
    } else {
      this.fail(`${this.show(head)} is not supported as a value.`);
    }
    let offsetDays = 0;
    let format: DatePattern | null = null;
    while (this.accept('punct', '.')) {
      const method = this.next();
      if (format) {
        this.fail('Nothing can follow .format(...).');
      }
      if (method?.kind === 'name' && (method.value === 'add' || method.value === 'subtract')) {
        if (!copy) {
          const name = source.kind === 'variable' ? source.name : 'it';
          this.fail(`${name}.${method.value}(...) would change ${name} itself. Use moment(${name}).${method.value}(...) instead.`);
        }
        this.expect('punct', '(');
        const amount = this.next();
        if (amount?.kind !== 'number') {
          this.fail(`.${method.value}(...) needs a whole number first, not ${this.show(amount)}.`);
        }
        this.expect('punct', ',');
        const unit = this.next();
        const days = unit?.kind === 'string' ? DAY_UNITS[unit.value] : undefined;
        if (!days) {
          this.fail(`Unit ${this.show(unit)} is not supported. Use "d" (days) or "w" (weeks).`);
        }
        this.expect('punct', ')');
        offsetDays += Number(amount.value) * days * (method.value === 'subtract' ? -1 : 1);
        if (!Number.isSafeInteger(offsetDays)) {
          this.fail('The day offset is too large.');
        }
      } else if (method?.kind === 'name' && method.value === 'format') {
        this.expect('punct', '(');
        const pattern = this.next();
        if (pattern?.kind !== 'string') {
          this.fail(`.format(...) needs a quoted pattern, not ${this.show(pattern)}.`);
        }
        format = datePattern(pattern.value);
        this.expect('punct', ')');
      } else {
        this.fail(`.${this.show(method)}(...) is not supported. Use .add, .subtract, or .format.`);
      }
    }
    return { source, offsetDays, format };
  }

  private momentArgument(): DateSource {
    if (this.peek()?.kind === 'punct' && this.peek()?.value === ')') {
      return { kind: 'now' };
    }
    const first = this.next();
    if (first?.kind === 'name' && first.value === 'tp') {
      this.expect('punct', '.');
      this.expect('name', 'file');
      this.expect('punct', '.');
      this.expect('name', 'title');
      if (!this.accept('punct', ',')) {
        return { kind: 'title', pattern: DEFAULT_DATE_FORMAT };
      }
      const format = this.next();
      if (format?.kind !== 'string') {
        this.fail(`moment(tp.file.title, ...) needs a quoted date pattern, not ${this.show(format)}.`);
      }
      const pattern = datePattern(format.value);
      if (!isDateReadingPattern(pattern)) {
        throw new TagError('unsupported-format', `"${format.value}" cannot read a date; use YYYY, MM, and DD once each.`);
      }
      return { kind: 'title', pattern };
    }
    if (first?.kind === 'name' && this.declared.get(first.value) === 'date') {
      return { kind: 'variable', name: first.value };
    }
    this.fail(`moment(${this.show(first)}) is not supported; use tp.file.title with a date pattern, a date variable, or nothing.`);
  }

  private peek(): ScriptToken | undefined {
    return this.tokens[this.index];
  }

  private next(): ScriptToken | undefined {
    return this.tokens[this.index++];
  }

  private accept(kind: ScriptToken['kind'], value: string): boolean {
    const token = this.peek();
    if (token?.kind === kind && token.value === value) {
      this.index++;
      return true;
    }
    return false;
  }

  private expect(kind: ScriptToken['kind'], value: string) {
    if (!this.accept(kind, value)) {
      this.fail(`Expected ${value} but found ${this.show(this.peek())}.`);
    }
  }

  private show(token: ScriptToken | undefined): string {
    if (!token) return 'the end of the script';
    return token.kind === 'string' ? `"${token.value}"` : token.value;
  }

  private fail(message: string): never {
    throw new TagError('execution-tag', `This script is not supported. ${message} ${SCRIPT_HELP}`);
  }
}

export function parseTemplate(source: string): Result<ParsedTemplate, TemplateError> {
  const nodes: TemplateNode[] = [];
  const declared: Declared = new Map();
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('<%', index);
    if (open === -1) {
      nodes.push({ kind: 'text', text: source.slice(index) });
      break;
    }
    if (open > index) {
      nodes.push({ kind: 'text', text: source.slice(index, open) });
    }
    const close = source.indexOf('%>', open + 2);
    if (close === -1) {
      const lineEnd = source.indexOf('\n', open);
      const tag = source.slice(open, lineEnd === -1 ? undefined : lineEnd);
      return templateError(source, open, tag, 'unclosed-tag', 'This tag has no closing %>.');
    }
    const tag = source.slice(open, close + 2);
    const fail = (code: TemplateErrorCode, message: string) => templateError(source, open, tag, code, message);
    // the opening may carry "*" (a script) and "-" (remove the line break before), in either order.
    let body = source.slice(open + 2, close);
    let script = false;
    let trimBefore = false;
    for (let marker = 0; marker < 2; marker++) {
      if (!script && body.startsWith('*')) {
        script = true;
        body = body.slice(1);
      } else if (!trimBefore && body.startsWith('-')) {
        trimBefore = true;
        body = body.slice(1);
      }
    }
    if (body.startsWith('+')) {
      return fail('dynamic-tag', `Dynamic tags (<%+ ... %>) are not supported. ${SUPPORTED_SUMMARY}`);
    }
    if (body.startsWith('_') || body.endsWith('_')) {
      return fail(
        'whitespace-control',
        'Whitespace-control tags with _ (<%_ and _%>) are not supported. Use <%- or -%> to remove one line break, or plain <% ... %>.',
      );
    }
    const trimAfter = body.endsWith('-');
    if (trimAfter) {
      body = body.slice(0, -1);
    }
    try {
      nodes.push(
        script
          ? { kind: 'script', definitions: new ScriptParser(tokenizeScript(body), declared).parse(), start: open, tag }
          : parseExpression(body, open, tag, declared),
      );
    } catch (error) {
      if (error instanceof TagError) {
        return fail(error.code, error.message);
      }
      throw error;
    }
    if (trimBefore) {
      const previous = nodes[nodes.length - 2];
      if (previous?.kind === 'text') {
        previous.text = previous.text.replace(/\r?\n$/, '');
      }
    }
    index = close + 2;
    if (trimAfter) {
      index += source.startsWith('\r\n', index) ? 2 : source.startsWith('\n', index) ? 1 : 0;
    }
  }
  return { ok: true, value: { source, nodes } };
}

function resolveBase(node: Extract<TemplateNode, { kind: 'date' }>, context: ExpansionContext): CivilDateTime | string {
  const { reference } = node;
  if (!reference) {
    return context.now;
  }
  if (reference.kind === 'literal') {
    return { ...reference.date, hour: 0, minute: 0, second: 0 };
  }
  const date = parseCivilDate(context.title, reference.format);
  if (!date) {
    return `The note title "${context.title}" is not a ${reference.format} date, so tp.date.now cannot use it as a reference.`;
  }
  return { ...date, hour: 0, minute: 0, second: 0 };
}

type ScriptValue = { kind: 'date'; value: CivilDateTime } | { kind: 'text'; value: string };

function runDefinition(definition: ScriptDefinition, context: ExpansionContext, variables: Map<string, ScriptValue>): ScriptValue | string {
  const { source } = definition;
  let base: CivilDateTime;
  if (source.kind === 'now') {
    base = context.now;
  } else if (source.kind === 'title') {
    const date = parseWithPattern(context.title, source.pattern);
    if (!date) {
      return `The note name "${context.title}" is not a ${source.pattern.source} date, which moment(tp.file.title, "${source.pattern.source}") needs.`;
    }
    base = { ...date, hour: 0, minute: 0, second: 0 };
  } else {
    const variable = variables.get(source.name);
    if (variable?.kind !== 'date') {
      return `${source.name} is not a date.`;
    }
    base = variable.value;
  }
  const shifted = addDays(base, definition.offsetDays);
  if (!shifted) {
    return `${definition.name} moves the date outside years 1-9999.`;
  }
  const value = { ...base, ...shifted };
  return definition.format ? { kind: 'text', value: formatPattern(value, definition.format) } : { kind: 'date', value };
}

/** renders every tag, or returns the first error. nothing is partially rendered on failure. */
export function renderTemplate(template: ParsedTemplate, context: ExpansionContext): Result<string, TemplateError> {
  const parts: string[] = [];
  const variables = new Map<string, ScriptValue>();
  for (const node of template.nodes) {
    if (node.kind === 'text') {
      parts.push(node.text);
    } else if (node.kind === 'title') {
      parts.push(context.title);
    } else if (node.kind === 'script') {
      for (const definition of node.definitions) {
        const result = runDefinition(definition, context, variables);
        if (typeof result === 'string') {
          return templateError(template.source, node.start, node.tag, 'invalid-reference', result);
        }
        variables.set(definition.name, result);
      }
    } else if (node.kind === 'variable') {
      const variable = variables.get(node.name);
      parts.push(variable?.kind === 'text' ? variable.value : '');
    } else {
      const base = resolveBase(node, context);
      if (typeof base === 'string') {
        return templateError(template.source, node.start, node.tag, 'invalid-reference', base);
      }
      const shifted = addDays(base, node.offsetDays);
      if (!shifted) {
        return templateError(
          template.source,
          node.start,
          node.tag,
          'date-out-of-range',
          `Offset ${node.offsetDays} moves the date outside years 1-9999.`,
        );
      }
      parts.push(formatPattern({ ...base, ...shifted }, node.format));
    }
  }
  return { ok: true, value: parts.join('') };
}

export function expandTemplate(source: string, context: ExpansionContext): Result<string, TemplateError> {
  const parsed = parseTemplate(source);
  return parsed.ok ? renderTemplate(parsed.value, context) : parsed;
}

/** KTD6 built-in template: a title heading, a creation timestamp, and space to write. */
export const BUILT_IN_TEMPLATE = '# <% tp.file.title %>\n\nCreated <% tp.date.now("YYYY-MM-DD HH:mm") %>\n\n';
