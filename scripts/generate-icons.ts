/**
 * evereld's emerald-cut notebook mark, shared by every app icon and the launch screen.
 * regenerate with `bun run icons`; icon composer layers remain editable vectors.
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

type Palette = {
  bundle: string;
  png: string;
  background: string;
  top: string;
  bottom: string;
  edge: string;
  paper: string;
};

export const RELEASE: Palette = {
  bundle: 'assets/icons/app.icon',
  png: 'assets/images/icon.png',
  background: '#092E29',
  top: '#52D9AF',
  bottom: '#147F68',
  edge: '#A3F2CD',
  paper: '#F1FFE9',
};

export const DEVELOPMENT: Palette = {
  bundle: 'assets/icons/app-dev.icon',
  png: 'assets/images/icon-dev.png',
  background: '#38250E',
  top: '#F2CF76',
  bottom: '#B67525',
  edge: '#FFEBB7',
  paper: '#FFF8E7',
};

const SIZE = 1024;
// a broad, symmetrical step-cut stone with a notebook spine and three page lines.
const STONE = 'M352 196H672L812 336V688L672 828H352L212 688V336Z';
const FACE = 'M380 270H644L738 364V660L644 754H380L286 660V364Z';
const SPINE = 'M384 358H442V666H384Z';
const LINES = 'M466 358H644V414H466ZM466 484H610V540H466ZM466 610H644V666H466Z';

function svg(body: string, width = SIZE, defs = '', viewBox = '0 0 1024 1024'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="${viewBox}"><defs>${defs}</defs>${body}</svg>\n`;
}

function layers(p: Palette): { name: string; body: string }[] {
  return [
    { name: 'emerald-cut', body: `<path d="${STONE}" fill="${p.top}"/>` },
    { name: 'lower-bevel', body: `<path d="M212 688L286 660H738L812 688L672 828H352Z" fill="${p.bottom}"/>` },
    { name: 'upper-bevel', body: `<path d="M352 196H672L644 270H380L286 364L212 336Z" fill="${p.edge}"/>` },
    { name: 'writing-face', body: `<path d="${FACE}" fill="${p.bottom}"/>` },
    { name: 'notebook', body: `<path d="${SPINE}${LINES}" fill="${p.paper}"/>` },
  ];
}

function mark(p: Palette): string {
  return layers(p).map(({ body }) => body).join('');
}

export function flatIcon(p: Palette): string {
  return svg(
    `<rect width="1024" height="1024" fill="url(#background)"/><path d="${STONE}" transform="translate(0 18)" fill="#000000" opacity="0.22"/>${mark(p)}`,
    SIZE,
    `<linearGradient id="background" x2="0.8" y2="1"><stop stop-color="${p.background}"/><stop offset="1" stop-color="#061D1B"/></linearGradient>`,
  );
}

function extendedSrgb(hex: string): string {
  const channels = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5));
  return `extended-srgb:${channels.join(',')},1.00000`;
}

export function iconComposerJson(p: Palette): string {
  return `${JSON.stringify({
    fill: { 'automatic-gradient': extendedSrgb(p.background) },
    groups: [{
      // icon composer lists the foreground first; svg paints it last.
      layers: layers(p).reverse().map(({ name }) => ({ 'image-name': `${name}.svg`, name })),
      shadow: { kind: 'neutral', opacity: 0.35 },
      translucency: { enabled: false, value: 0 },
    }],
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  }, null, 2)}\n`;
}

function png(source: string, width: number, opaque = false): Buffer {
  const bytes = new Resvg(source, { fitTo: { mode: 'width', value: width } }).render().asPng();
  return opaque ? PNG.sync.write(PNG.sync.read(bytes), { colorType: 2 }) : bytes;
}

function write(root: string, file: string, data: string | Buffer) {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

export function generate(root: string) {
  for (const palette of [RELEASE, DEVELOPMENT]) {
    rmSync(join(root, palette.bundle), { recursive: true, force: true });
    write(root, `${palette.bundle}/icon.json`, iconComposerJson(palette));
    for (const layer of layers(palette)) {
      write(root, `${palette.bundle}/Assets/${layer.name}.svg`, svg(layer.body));
    }
    write(root, palette.png, png(flatIcon(palette), SIZE, true));
  }

  write(root, 'assets/images/splash-icon.png', png(svg(mark(RELEASE)), SIZE));
  // the expanded view box keeps the android foreground within the adaptive safe zone.
  write(root, 'assets/images/android-icon-foreground.png', png(svg(mark(RELEASE), 512, '', '-80 -80 1184 1184'), 512));
  write(root, 'assets/images/android-icon-background.png', png(svg(`<rect width="1024" height="1024" fill="${RELEASE.background}"/>`), 512));
  const mono = `<path d="${STONE}${SPINE}${LINES}" fill="#FFFFFF" fill-rule="evenodd"/>`;
  write(root, 'assets/images/android-icon-monochrome.png', png(svg(mono, 432, '', '-80 -80 1184 1184'), 432));
  write(root, 'assets/images/favicon.png', png(flatIcon(RELEASE), 48));
}

if (import.meta.main) generate(join(import.meta.dir, '..'));
