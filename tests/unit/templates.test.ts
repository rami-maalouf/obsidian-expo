import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  addDays,
  captureClock,
  type CivilDateTime,
  parseCivilDate,
} from '@/features/templates/civil-time';
import {
  BUILT_IN_TEMPLATE,
  expandTemplate,
  parseTemplate,
  type TemplateErrorCode,
} from '@/features/templates/template';

const TEMPLATES = join(import.meta.dir, '../fixtures/vault-basic/Templates');
const NOW: CivilDateTime = { year: 2026, month: 10, day: 8, hour: 0, minute: 15, second: 42 };

function expand(source: string, title = '2026-10-07', now = NOW) {
  const result = expandTemplate(source, { title, now });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function errorCode(source: string, title = '2026-10-07') {
  const result = expandTemplate(source, { title, now: NOW });
  return result.ok ? null : result.error.code;
}

describe('supported syntax', () => {
  test('built-in template uses the title and the captured clock', () => {
    expect(expand(BUILT_IN_TEMPLATE)).toBe('# 2026-10-07\n\nCreated 2026-10-08 00:15\n\n');
  });

  test('every allowed date format', () => {
    const formats: [string, string][] = [
      ['YYYY-MM-DD', '2026-10-08'],
      ['YYYYMMDD', '20261008'],
      ['YYYY-MM', '2026-10'],
      ['YYYY-MM-DD HH:mm', '2026-10-08 00:15'],
      ['HH:mm', '00:15'],
      ['HH:mm:ss', '00:15:42'],
    ];
    for (const [format, expected] of formats) {
      expect(expand(`<% tp.date.now("${format}") %>`)).toBe(expected);
    }
  });

  test('omitted format and offset, quotes, and spacing', () => {
    expect(expand('<% tp.date.now() %>')).toBe('2026-10-08');
    expect(expand("<%tp.date.now('YYYYMMDD')%>")).toBe('20261008');
    expect(expand('<%  tp.date.now( "YYYY-MM-DD" ,  -1 )  %>')).toBe('2026-10-07');
    expect(expand('<% tp.date.now("YYYY-MM-DD", +1) %>')).toBe('2026-10-09');
    expect(expand('<%tp.file.title%>', 'Any title')).toBe('Any title');
  });

  test('tp.file.title and literal references use midnight of the reference day', () => {
    const tag = '<% tp.date.now("YYYY-MM-DD HH:mm", 1, tp.file.title, "YYYY-MM-DD") %>';
    expect(expand(tag)).toBe('2026-10-08 00:00');
    expect(expand('<% tp.date.now("YYYY-MM-DD", -1, tp.file.title, "YYYYMMDD") %>', '20261001')).toBe('2026-09-30');
    expect(expand('<% tp.date.now("YYYYMMDD", 0, "2026-01-31", "YYYY-MM-DD") %>')).toBe('20260131');
    expect(expand("<% tp.date.now('HH:mm:ss', 0, '20260131', 'YYYYMMDD') %>")).toBe('00:00:00');
  });

  test('calendar arithmetic across leap days, months, and years', () => {
    const at = (date: string, offset: number) =>
      expand(`<% tp.date.now("YYYY-MM-DD", ${offset}, "${date}", "YYYY-MM-DD") %>`);
    expect(at('2028-02-28', 1)).toBe('2028-02-29');
    expect(at('2027-02-28', 1)).toBe('2027-03-01');
    expect(at('2000-02-28', 1)).toBe('2000-02-29');
    expect(at('2100-02-28', 1)).toBe('2100-03-01');
    expect(at('2026-12-31', 1)).toBe('2027-01-01');
    expect(at('2027-01-01', -1)).toBe('2026-12-31');
    expect(at('2026-03-31', -31)).toBe('2026-02-28');
    expect(at('2026-01-01', 365)).toBe('2027-01-01');
    expect(at('0001-01-01', 0)).toBe('0001-01-01');
  });

  test('offsets keep the wall-clock time across DST changes', () => {
    // US clocks skip 02:00-03:00 on 2026-03-08 and repeat 01:00-02:00 on 2026-11-01.
    const evening: CivilDateTime = { year: 2026, month: 3, day: 7, hour: 22, minute: 30, second: 0 };
    expect(expand('<% tp.date.now("YYYY-MM-DD HH:mm", 1) %>', 'x', evening)).toBe('2026-03-08 22:30');
    const autumn: CivilDateTime = { year: 2026, month: 10, day: 31, hour: 1, minute: 30, second: 0 };
    expect(expand('<% tp.date.now("YYYY-MM-DD HH:mm", 1) %>', 'x', autumn)).toBe('2026-11-01 01:30');
  });

  test('text outside tags is copied verbatim', () => {
    const text = 'café\r\n100% %> done\n 👩‍💻 [[link]] {{date}}\r\n';
    expect(expand(text)).toBe(text);
    expect(expand(`${text}<% tp.file.title %>${text}`)).toBe(`${text}2026-10-07${text}`);
    expect(expand('')).toBe('');
  });

  test('supported fixture template renders exactly', () => {
    const source = readFileSync(join(TEMPLATES, 'Daily.md'), 'utf8');
    expect(expand(source)).toBe(`---
created: 2026-10-08 00:15
---

# 2026-10-07

<< [[2026-10-06]] | [[2026-10-08]] >>

Month: 2026-10
Compact: 20261008
Time: 00:15 / 00:15:42
Fixed reference: 2026-03-04
Default: 2026-10-08

Text with a stray %> and 100% kept verbatim.

## Notes

`);
  });
});

describe('rejected syntax', () => {
  test('each unsupported fixture template fails with a specific code', () => {
    const expected: Record<string, TemplateErrorCode> = {
      'Date format.md': 'unsupported-format',
      'Duration offset.md': 'unsupported-argument',
      'Dynamic tag.md': 'dynamic-tag',
      'Execution tag.md': 'execution-tag',
      'Reference without format.md': 'unsupported-argument',
      'Unclosed tag.md': 'unclosed-tag',
      'Unknown command.md': 'unsupported-command',
      'Variable expression.md': 'unsupported-command',
      'Whitespace control.md': 'whitespace-control',
    };
    const files = readdirSync(join(TEMPLATES, 'Unsupported')).sort();
    expect(files).toEqual(Object.keys(expected).sort());
    for (const file of files) {
      const source = readFileSync(join(TEMPLATES, 'Unsupported', file), 'utf8');
      const parsed = parseTemplate(source);
      expect({ file, code: parsed.ok ? null : parsed.error.code }).toEqual({ file, code: expected[file] });
    }
  });

  test('unsupported tags, commands, and arguments', () => {
    const cases: [string, TemplateErrorCode][] = [
      ['<%* tR += "x" %>', 'execution-tag'],
      ['<%+ tp.file.title %>', 'dynamic-tag'],
      ['<%- tp.file.title %>', 'whitespace-control'],
      ['<% tp.file.title -%>', 'whitespace-control'],
      ['<%_ tp.file.title %>', 'whitespace-control'],
      ['<% tp.file.title', 'unclosed-tag'],
      ['<% %>', 'unsupported-command'],
      ['<% tp.file.title() %>', 'unsupported-command'],
      ['<% tp.file.title.toUpperCase() %>', 'unsupported-command'],
      ['<% tp.file.title + "x" %>', 'unsupported-command'],
      ['<% tp.file.creation_date() %>', 'unsupported-command'],
      ['<% tp.date.tomorrow() %>', 'unsupported-command'],
      ['<% tp.date.now %>', 'unsupported-command'],
      ['<% tp.date.now() + 1 %>', 'unsupported-command'],
      ['<% tp.date.now(); tp.date.now() %>', 'unsupported-command'],
      ['<% title %>', 'unsupported-command'],
      ['<% await tp.system.prompt("x") %>', 'unsupported-command'],
      ['<% `x` %>', 'unsupported-command'],
      ['<% tp.date.now("dddd") %>', 'unsupported-format'],
      ['<% tp.date.now("YYYY-MM-DD ") %>', 'unsupported-format'],
      ['<% tp.date.now("yyyy-MM-dd") %>', 'unsupported-format'],
      ['<% tp.date.now(YYYY) %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", "P1D") %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", 1.5) %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", - 1) %>', 'unsupported-command'],
      ['<% tp.date.now("YYYY-MM-DD", 1 + 1) %>', 'unsupported-command'],
      ['<% tp.date.now("YYYY-MM-DD", 1 +1) %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD" %>', 'unsupported-argument'],
      ['<% tp.date.now() tp.date.now() %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD") x %>', 'unsupported-command'],
      ['<% tp.date.now("YYYY-MM-DD",) %>', 'unsupported-argument'],
      ['<% tp.date.now(, 1) %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", 1, tp.file.title) %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", 1, tp.file.title, "MM-DD-YYYY") %>', 'unsupported-format'],
      ['<% tp.date.now("YYYY-MM-DD", 1, tp.file.path, "YYYY-MM-DD") %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", 1, 20261008, "YYYYMMDD") %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", 1, "2026-02-30", "YYYY-MM-DD") %>', 'invalid-reference'],
      ['<% tp.date.now("YYYY-MM-DD", 1, "2026-2-3", "YYYY-MM-DD") %>', 'invalid-reference'],
      ['<% tp.date.now("YYYY-MM-DD", 1, "2026-10-08", "YYYYMMDD") %>', 'invalid-reference'],
      ['<% tp.date.now("YYYY-MM-DD", 0, "x", "YYYY-MM-DD", 1) %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", tp.date.now()) %>', 'unsupported-argument'],
      ['<% tp.date.now("a\\"b") %>', 'unsupported-argument'],
      ['<% tp.date.now("YYYY-MM-DD", 99999999) %>', 'date-out-of-range'],
      ['<% tp.date.now("YYYY-MM-DD", -1, "0001-01-01", "YYYY-MM-DD") %>', 'date-out-of-range'],
    ];
    for (const [source, code] of cases) {
      expect({ source, code: errorCode(source) }).toEqual({ source, code });
    }
  });

  test('a title that is not a date fails only when used as a reference', () => {
    expect(errorCode('<% tp.date.now("YYYY-MM-DD", 0, tp.file.title, "YYYY-MM-DD") %>', 'Meeting')).toBe(
      'invalid-reference',
    );
    expect(expand('<% tp.file.title %>', 'Meeting')).toBe('Meeting');
  });

  test('errors report the tag position and stop the whole template', () => {
    const source = '# Title\nline two <% tp.file.title %>\n  <% tp.date.now("dddd") %>\n';
    const result = expandTemplate(source, { title: 't', now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ line: 3, column: 3, tag: '<% tp.date.now("dddd") %>' });
      expect(source.slice(result.error.start, result.error.end)).toBe('<% tp.date.now("dddd") %>');
      expect(result.error.message).toStartWith('Line 3: Date format "dddd" is not supported.');
    }
  });

  test('long tags are shortened in errors', () => {
    const result = parseTemplate(`<% ${'x'.repeat(200)} %>`);
    expect(result.ok ? 0 : result.error.tag.length).toBe(80);
  });
});

describe('civil time', () => {
  test('strict date parsing', () => {
    expect(parseCivilDate('2028-02-29', 'YYYY-MM-DD')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseCivilDate('2027-02-29', 'YYYY-MM-DD')).toBeNull();
    expect(parseCivilDate('20261008', 'YYYYMMDD')).toEqual({ year: 2026, month: 10, day: 8 });
    expect(parseCivilDate('2026-10-08 ', 'YYYY-MM-DD')).toBeNull();
    expect(parseCivilDate('0000-01-01', 'YYYY-MM-DD')).toBeNull();
    expect(parseCivilDate('2026-13-01', 'YYYY-MM-DD')).toBeNull();
  });

  test('addDays stays within years 1-9999', () => {
    expect(addDays({ year: 9999, month: 12, day: 31 }, 1)).toBeNull();
    expect(addDays({ year: 1, month: 1, day: 1 }, -1)).toBeNull();
    expect(addDays({ year: 99, month: 12, day: 31 }, 1)).toEqual({ year: 100, month: 1, day: 1 });
  });

  test('captureClock reads local wall time once', () => {
    const local = new Date(2026, 2, 8, 3, 30, 15);
    expect(captureClock(local)).toEqual({ year: 2026, month: 3, day: 8, hour: 3, minute: 30, second: 15 });
  });

  test('captureClock follows the device time zone across DST and date lines', () => {
    const instants = ['2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', '2026-10-08T03:30:00Z'];
    const script = `import { captureClock } from '@/features/templates/civil-time';
      console.log(JSON.stringify(${JSON.stringify(instants)}.map((iso) => captureClock(new Date(iso)))));`;
    const capture = (timeZone: string) => {
      const run = Bun.spawnSync([process.execPath, '-e', script], {
        cwd: join(import.meta.dir, '../..'),
        env: { ...process.env, TZ: timeZone },
      });
      return JSON.parse(run.stdout.toString()) as CivilDateTime[];
    };
    const short = (value: CivilDateTime) =>
      `${value.month}-${value.day} ${value.hour}:${String(value.minute).padStart(2, '0')}`;
    // new york leaves standard time at 07:00Z on 2026-03-08.
    expect(capture('America/New_York').map(short)).toEqual(['3-8 1:30', '3-8 3:30', '10-7 23:30']);
    expect(capture('Asia/Tokyo').map(short)).toEqual(['3-8 15:30', '3-8 16:30', '10-8 12:30']);
  });
});

describe('sanitized references', () => {
  const REFERENCES = join(import.meta.dir, '../../docs/references/obsidian/vault/Templates');

  test('the supported basic template renders the documented heading and creation line', () => {
    const source = readFileSync(join(REFERENCES, 'Daily Basic.md'), 'utf8');
    const now: CivilDateTime = { year: 2000, month: 1, day: 4, hour: 9, minute: 30, second: 0 };
    const rendered = expand(source, '2000-01-03', now);
    expect(rendered.split('\n')).toContain('# 2000-01-03');
    expect(rendered.split('\n')).toContain('Created: 2000-01-04 09:30');
    expect(rendered).toBe(
      source.replace('<% tp.file.title %>', '2000-01-03').replace('<% tp.date.now("YYYY-MM-DD HH:mm") %>', '2000-01-04 09:30'),
    );
  });

  test('the sanitized daily template is rejected at its execution tag', () => {
    const parsed = parseTemplate(readFileSync(join(REFERENCES, 'Daily Template.md'), 'utf8'));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toMatchObject({ code: 'execution-tag', line: 1, column: 1 });
    }
  });

  test('every unsupported construct in the sanitized template is caught, not only the first', () => {
    let source = readFileSync(join(REFERENCES, 'Daily Template.md'), 'utf8');
    const found: string[] = [];
    for (let parsed = parseTemplate(source); !parsed.ok; parsed = parseTemplate(source)) {
      found.push(`${parsed.error.code} ${parsed.error.tag}`);
      source = source.slice(0, parsed.error.start) + source.slice(parsed.error.end);
    }
    expect(found.map((entry) => entry.slice(0, entry.indexOf(' ')))).toEqual([
      'execution-tag',
      'unsupported-format',
      'unsupported-command',
      'unsupported-command',
      'unsupported-command',
    ]);
    expect(found.slice(1)).toEqual([
      'unsupported-format <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>',
      'unsupported-command <% weekLink %>',
      'unsupported-command <% weekLink %>',
      'unsupported-command <% prevDay %>',
    ]);
  });
});
