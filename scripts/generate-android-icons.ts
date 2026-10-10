/**
 * writes the android toolbar icons as vector drawables (assets/icons/android/*.xml).
 *
 * expo router's android toolbar draws icons with compose, from xml vector drawables; sf symbols
 * exist only on ios. the icons are google's material symbols (apache license 2.0), read from the
 * font that expo-symbols already installs (@expo-google-fonts/material-symbols, weight 400), so
 * no icon file is drawn by hand and every one can be regenerated:
 *
 *   bun scripts/generate-android-icons.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dir, '..');
const FONT = join(root, 'node_modules/@expo-google-fonts/material-symbols/400Regular/MaterialSymbols_400Regular.ttf');
const CODEPOINTS = join(root, 'node_modules/expo-symbols/build/android/symbols.json');
export const OUTPUT = join(root, 'assets/icons/android');

/** file name → material symbol name. */
export const ICONS: Record<string, string> = {
  arrow_forward: 'arrow_forward',
  bookmark_add: 'bookmark_add',
  bookmark_remove: 'bookmark_remove',
  calendar_month: 'calendar_month',
  drive_file_rename_outline: 'drive_file_rename_outline',
  edit_square: 'edit_square',
  folder_open: 'folder_open',
  left_panel_open: 'left_panel_open',
  more_vert: 'more_vert',
  search: 'search',
  settings: 'settings',
  today: 'today',
};

type Point = { x: number; y: number; onCurve: boolean };

/** the few truetype tables needed to read one glyph's outline. */
class Font {
  private readonly view: DataView;
  private readonly tables = new Map<string, number>();
  readonly unitsPerEm: number;
  private readonly longOffsets: boolean;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = this.view.getUint16(4);
    for (let index = 0; index < count; index++) {
      const record = 12 + index * 16;
      const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
      this.tables.set(tag, this.view.getUint32(record + 8));
    }
    const head = this.table('head');
    this.unitsPerEm = this.view.getUint16(head + 18);
    this.longOffsets = this.view.getInt16(head + 50) === 1;
  }

  private table(tag: string): number {
    const offset = this.tables.get(tag);
    if (offset === undefined) throw new Error(`the font has no ${tag} table`);
    return offset;
  }

  /** the glyph for a code point, from a format 4 or 12 unicode cmap subtable. */
  glyphFor(codePoint: number): number {
    const cmap = this.table('cmap');
    const count = this.view.getUint16(cmap + 2);
    for (let index = 0; index < count; index++) {
      const platform = this.view.getUint16(cmap + 4 + index * 8);
      const subtable = cmap + this.view.getUint32(cmap + 4 + index * 8 + 4);
      if (platform !== 0 && platform !== 3) continue;
      const format = this.view.getUint16(subtable);
      const glyph = format === 12 ? this.format12(subtable, codePoint) : format === 4 ? this.format4(subtable, codePoint) : 0;
      if (glyph) return glyph;
    }
    throw new Error(`no glyph for U+${codePoint.toString(16)}`);
  }

  private format4(subtable: number, codePoint: number): number {
    if (codePoint > 0xffff) return 0;
    const segments = this.view.getUint16(subtable + 6) / 2;
    const ends = subtable + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let segment = 0; segment < segments; segment++) {
      if (codePoint > this.view.getUint16(ends + segment * 2)) continue;
      const start = this.view.getUint16(starts + segment * 2);
      if (codePoint < start) return 0;
      const delta = this.view.getInt16(deltas + segment * 2);
      const rangeOffset = this.view.getUint16(rangeOffsets + segment * 2);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const glyph = this.view.getUint16(rangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  }

  private format12(subtable: number, codePoint: number): number {
    const groups = this.view.getUint32(subtable + 12);
    for (let group = 0; group < groups; group++) {
      const record = subtable + 16 + group * 12;
      const start = this.view.getUint32(record);
      const end = this.view.getUint32(record + 4);
      if (codePoint >= start && codePoint <= end) return this.view.getUint32(record + 8) + codePoint - start;
    }
    return 0;
  }

  private glyphOffset(glyph: number): { start: number; end: number } {
    const loca = this.table('loca');
    const glyf = this.table('glyf');
    const at = (index: number) =>
      this.longOffsets ? this.view.getUint32(loca + index * 4) : this.view.getUint16(loca + index * 2) * 2;
    return { start: glyf + at(glyph), end: glyf + at(glyph + 1) };
  }

  /** the glyph's contours in font units (y up). composite glyphs are offset, never scaled. */
  contours(glyph: number): Point[][] {
    const { start, end } = this.glyphOffset(glyph);
    if (start === end) return [];
    const contourCount = this.view.getInt16(start);
    if (contourCount < 0) return this.composite(start);
    let at = start + 10;
    const ends: number[] = [];
    for (let index = 0; index < contourCount; index++, at += 2) ends.push(this.view.getUint16(at));
    at += 2 + this.view.getUint16(at);
    const pointCount = (ends.at(-1) ?? -1) + 1;
    const flags: number[] = [];
    while (flags.length < pointCount) {
      const flag = this.bytes[at++];
      flags.push(flag);
      if (flag & 8) {
        for (let repeat = this.bytes[at++]; repeat > 0; repeat--) flags.push(flag);
      }
    }
    const read = (short: number, same: number) => {
      const values: number[] = [];
      let value = 0;
      for (const flag of flags) {
        if (flag & short) {
          const delta = this.bytes[at++];
          value += flag & same ? delta : -delta;
        } else if (!(flag & same)) {
          value += this.view.getInt16(at);
          at += 2;
        }
        values.push(value);
      }
      return values;
    };
    const xs = read(2, 16);
    const ys = read(4, 32);
    const contours: Point[][] = [];
    let first = 0;
    for (const last of ends) {
      const contour: Point[] = [];
      for (let index = first; index <= last; index++) contour.push({ x: xs[index], y: ys[index], onCurve: (flags[index] & 1) === 1 });
      contours.push(contour);
      first = last + 1;
    }
    return contours;
  }

  private composite(start: number): Point[][] {
    const contours: Point[][] = [];
    let at = start + 10;
    for (;;) {
      const flags = this.view.getUint16(at);
      const glyph = this.view.getUint16(at + 2);
      at += 4;
      const words = (flags & 1) !== 0;
      const dx = words ? this.view.getInt16(at) : this.view.getInt8(at);
      const dy = words ? this.view.getInt16(at + 2) : this.view.getInt8(at + 1);
      at += words ? 4 : 2;
      if (!(flags & 2)) throw new Error('composite glyphs with point matching are not supported');
      if (flags & (8 | 0x40 | 0x80)) throw new Error('scaled composite glyphs are not supported');
      for (const contour of this.contours(glyph)) contours.push(contour.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })));
      if (!(flags & 0x20)) return contours;
    }
  }
}

function number(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** truetype quadratic contours as svg path data, flipped so y grows downward in the em box. */
function pathData(contours: Point[][], size: number): string {
  const commands: string[] = [];
  const at = (point: { x: number; y: number }) => `${number(point.x)},${number(size - point.y)}`;
  const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, onCurve: true });
  for (const contour of contours) {
    if (contour.length === 0) continue;
    // start on an on-curve point, or between two off-curve points.
    const startIndex = contour.findIndex((point) => point.onCurve);
    const ordered = startIndex >= 0 ? [...contour.slice(startIndex), ...contour.slice(0, startIndex)] : contour;
    const start = startIndex >= 0 ? ordered[0] : middle(contour[0], contour[1]);
    commands.push(`M${at(start)}`);
    let control: Point | null = null;
    const rest = startIndex >= 0 ? ordered.slice(1) : ordered;
    for (const point of [...rest, start]) {
      if (point.onCurve) {
        commands.push(control ? `Q${at(control)} ${at(point)}` : `L${at(point)}`);
        control = null;
      } else if (control) {
        const implied = middle(control, point);
        commands.push(`Q${at(control)} ${at(implied)}`);
        control = point;
      } else {
        control = point;
      }
    }
    commands.push('Z');
  }
  return commands.join('');
}

/** the vector drawable for one symbol, in the format of expo router's own toolbar icons. */
export function iconXml(font: Font, codePoint: number): string {
  const size = font.unitsPerEm;
  const path = pathData(font.contours(font.glyphFor(codePoint)), size);
  return [
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="24dp"',
    '    android:height="24dp"',
    `    android:viewportWidth="${size}"`,
    `    android:viewportHeight="${size}">`,
    '  <path',
    '      android:fillColor="#000000"',
    `      android:pathData="${path}"/>`,
    '</vector>',
    '',
  ].join('\n');
}

/** writes every icon into `folder`; returns the written paths. */
export function generate(folder: string = OUTPUT): string[] {
  const font = new Font(new Uint8Array(readFileSync(FONT)));
  const codePoints = JSON.parse(readFileSync(CODEPOINTS, 'utf8')) as Record<string, number>;
  mkdirSync(folder, { recursive: true });
  return Object.entries(ICONS).map(([file, symbol]) => {
    const codePoint = codePoints[symbol];
    if (codePoint === undefined) throw new Error(`unknown material symbol ${symbol}`);
    const target = join(folder, `${file}.xml`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, iconXml(font, codePoint));
    return target;
  });
}

if (import.meta.main) {
  for (const written of generate()) console.log(written.slice(root.length + 1));
}
