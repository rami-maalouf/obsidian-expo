/**
 * parser and renderer for the Templater-compatible subset in KTD6. nothing is evaluated.
 *
 * supported, inside ordinary `<% ... %>` interpolation tags only:
 *   tp.file.title
 *   tp.date.now(format?, offset?, reference?, reference_format?)
 *
 * text outside tags is copied verbatim. every other tag form, command, argument, or date
 * format is an error, reported before any caller creates files or folders.
 */
import {
  addDays,
  type CivilDate,
  type CivilDateTime,
  DATE_FORMATS,
  type DateFormat,
  formatCivil,
  isDateFormat,
  isReferenceFormat,
  parseCivilDate,
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

export type TemplateNode =
  | { kind: 'text'; text: string }
  | ({ kind: 'title' } & TagNode)
  | ({ kind: 'date'; format: DateFormat; offsetDays: number; reference: Reference | null } & TagNode);

export type ParsedTemplate = { source: string; nodes: TemplateNode[] };

export type ExpansionContext = {
  /** basename of the destination note without `.md`. */
  title: string;
  /** wall clock captured once for the whole expansion. */
  now: CivilDateTime;
};

export const DEFAULT_DATE_FORMAT: DateFormat = 'YYYY-MM-DD';
const MAX_TAG_DISPLAY = 80;
const SUPPORTED_SUMMARY = 'Supported: <% tp.file.title %> and <% tp.date.now(...) %>.';
const FORMAT_LIST = DATE_FORMATS.map((format) => `"${format}"`).join(', ');
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

function parseFormat(token: Token): DateFormat {
  const value = quotedString(token, 'Date format');
  if (!isDateFormat(value)) {
    throw new TagError('unsupported-format', `Date format "${value}" is not supported. Use one of ${FORMAT_LIST}.`);
  }
  return value;
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

function parseExpression(expression: string, start: number, tag: string): TemplateNode {
  const tokens = tokenize(expression);
  const [head, next] = tokens;
  if (!head) {
    throw new TagError('unsupported-command', `Empty tag. ${SUPPORTED_SUMMARY}`);
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

export function parseTemplate(source: string): Result<ParsedTemplate, TemplateError> {
  const nodes: TemplateNode[] = [];
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
    const inner = source.slice(open + 2, close);
    const fail = (code: TemplateErrorCode, message: string) => templateError(source, open, tag, code, message);
    if (inner.startsWith('*')) {
      return fail('execution-tag', `JavaScript execution tags (<%* ... %>) are not supported. ${SUPPORTED_SUMMARY}`);
    }
    if (inner.startsWith('+')) {
      return fail('dynamic-tag', `Dynamic tags (<%+ ... %>) are not supported. ${SUPPORTED_SUMMARY}`);
    }
    if (/^[-_]|[-_]$/.test(inner)) {
      return fail(
        'whitespace-control',
        'Whitespace-control tags (<%_, _%>, <%-, -%>) are not supported. Use plain <% ... %>.',
      );
    }
    try {
      nodes.push(parseExpression(inner, open, tag));
    } catch (error) {
      if (error instanceof TagError) {
        return fail(error.code, error.message);
      }
      throw error;
    }
    index = close + 2;
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

/** renders every tag, or returns the first error. nothing is partially rendered on failure. */
export function renderTemplate(template: ParsedTemplate, context: ExpansionContext): Result<string, TemplateError> {
  const parts: string[] = [];
  for (const node of template.nodes) {
    if (node.kind === 'text') {
      parts.push(node.text);
    } else if (node.kind === 'title') {
      parts.push(context.title);
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
      parts.push(formatCivil({ ...base, ...shifted }, node.format));
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
