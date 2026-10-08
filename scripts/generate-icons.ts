/**
 * app icons from one crystal drawing.
 *
 * the icon is a faceted glass shard, a nod to obsidian (volcanic glass). the release icon is
 * violet; the development icon is the same shard in molten amber, so the two installed apps
 * are easy to tell apart. this script writes:
 *
 * - Icon Composer bundles (`assets/icons/*.icon`) for `ios.icon`. each facet is its own flat
 *   layer, and iOS 26 adds the Liquid Glass lighting, translucency, and shadow at runtime.
 * - flattened 1024 px PNGs with a drawn glass look, for the top-level `icon` and older tools.
 * - the splash image, the web favicon, and the android adaptive icon layers.
 *
 *   bun scripts/generate-icons.ts
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type Point = readonly [number, number];

export type Palette = {
  /** Icon Composer bundle path; its folder name is also the iOS app icon name. */
  bundle: string;
  /** flattened PNG path, relative to the repository root. */
  png: string;
  background: { top: string; bottom: string; glow: string; accent: string; base: string };
  /** facet colors from the lit face to the face in shadow. */
  facets: readonly [string, string, string, string, string, string];
  shadow: string;
};

export const RELEASE: Palette = {
  bundle: 'assets/icons/app.icon',
  png: 'assets/images/icon.png',
  background: { top: '#3D2387', bottom: '#0D0722', glow: '#8E63FF', accent: '#3E6BFF', base: '#341D78' },
  facets: ['#F1E9FF', '#CDB6FF', '#AC88F8', '#8159E8', '#6A41D3', '#4A25A5'],
  shadow: '#05020E',
};

export const DEVELOPMENT: Palette = {
  bundle: 'assets/icons/app-dev.icon',
  png: 'assets/images/icon-dev.png',
  background: { top: '#7A2E0C', bottom: '#1A0803', glow: '#FF8E3C', accent: '#FF5A2E', base: '#6E270A' },
  facets: ['#FFF0D6', '#FFCB85', '#FFA552', '#F2802E', '#D9601E', '#A83C10'],
  shadow: '#0E0402',
};

const SIZE = 1024;

// the shard's outline, clockwise from its tip, and the apex where its facets meet. the drawing
// is then scaled and centered on the 1024-point icon canvas.
const DRAWN_OUTLINE: readonly Point[] = [
  [600, 146],
  [752, 404],
  [690, 724],
  [476, 884],
  [306, 690],
  [366, 330],
];
const DRAWN_APEX: Point = [512, 488];

const HEIGHT = 690;
const CENTER: Point = [512, 504];

function place(points: readonly Point[]): Point[] {
  const xs = DRAWN_OUTLINE.map(([x]) => x);
  const ys = DRAWN_OUTLINE.map(([, y]) => y);
  const scale = HEIGHT / (Math.max(...ys) - Math.min(...ys));
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
  return points.map(([x, y]) => [
    Math.round(CENTER[0] + (x - midX) * scale),
    Math.round(CENTER[1] + (y - midY) * scale),
  ]);
}

const OUTLINE = place(DRAWN_OUTLINE);
const [APEX] = place([DRAWN_APEX]);
const [T, R1, R2, B, L2, L1] = OUTLINE;
const TOP = Math.min(...OUTLINE.map(([, y]) => y));
const BOTTOM = Math.max(...OUTLINE.map(([, y]) => y));
const LEFT = Math.min(...OUTLINE.map(([x]) => x));
const RIGHT = Math.max(...OUTLINE.map(([x]) => x));

// one triangle per outline edge, ordered from the lit face (light from the top left) to the
// face in shadow, matching `Palette.facets`.
const FACETS: readonly (readonly Point[])[] = [
  [L1, T, APEX],
  [T, R1, APEX],
  [L2, L1, APEX],
  [B, L2, APEX],
  [R1, R2, APEX],
  [R2, B, APEX],
];

const RIDGES: readonly (readonly [Point, Point])[] = OUTLINE.map((point) => [APEX, point] as const);

const path = (points: readonly Point[]) => `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;

function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(from);
  const b = parse(to);
  return `#${a
    .map((value, i) => Math.round(value + (b[i] - value) * amount).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function extendedSrgb(hex: string): string {
  const channels = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5));
  return `extended-srgb:${channels.join(',')},1.00000`;
}

function backgroundDefs(p: Palette): string {
  return `
    <linearGradient id="bg" x1="0.2" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="${p.background.top}"/>
      <stop offset="1" stop-color="${p.background.bottom}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.44" r="0.48">
      <stop offset="0" stop-color="${p.background.glow}" stop-opacity="0.62"/>
      <stop offset="1" stop-color="${p.background.glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="accent" cx="0.86" cy="0.9" r="0.5">
      <stop offset="0" stop-color="${p.background.accent}" stop-opacity="0.42"/>
      <stop offset="1" stop-color="${p.background.accent}" stop-opacity="0"/>
    </radialGradient>`;
}

const backgroundLayers = `
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#accent)"/>`;

const midpoint = (a: Point, b: Point, t = 0.5): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/**
 * the shard with a drawn glass look: translucent facets, light refracted through the body, an
 * inner rim glow, a sheen, and edges lit from the top left and, more faintly, the bottom right.
 */
function crystal(p: Palette, { shadow }: { shadow: boolean }): { defs: string; body: string } {
  const facetDefs = FACETS.map((points, i) => {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return `
    <linearGradient id="facet${i}" gradientUnits="userSpaceOnUse" x1="${Math.min(...xs)}" y1="${Math.min(...ys)}" x2="${Math.max(...xs)}" y2="${Math.max(...ys)}">
      <stop offset="0" stop-color="${mix(p.facets[i], '#FFFFFF', 0.3)}"/>
      <stop offset="1" stop-color="${p.facets[i]}"/>
    </linearGradient>`;
  }).join('');
  const glint = midpoint(midpoint(L1, T, 0.55), APEX, 0.22);
  const glintAngle = (Math.atan2(T[1] - L1[1], T[0] - L1[0]) * 180) / Math.PI;
  const caustic = midpoint(midpoint(R2, B), APEX, 0.3);
  const defs = `${facetDefs}
    <clipPath id="crystal"><path d="${path(OUTLINE)}"/></clipPath>
    <linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="${LEFT}" y1="${TOP}" x2="${APEX[0]}" y2="${APEX[1] + 60}">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="0.7" stop-color="#FFFFFF" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="rim" gradientUnits="userSpaceOnUse" x1="${LEFT}" y1="${TOP}" x2="${RIGHT}" y2="${BOTTOM}">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0.3"/>
      <stop offset="0.8" stop-color="#FFFFFF" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.75"/>
    </linearGradient>
    <filter id="drop" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="30"/></filter>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="glint" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="bloom" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="40"/></filter>`;
  const body = `
  ${shadow ? `<ellipse cx="${B[0] + 20}" cy="${BOTTOM + 28}" rx="${(RIGHT - LEFT) * 0.48}" ry="30" fill="${p.shadow}" opacity="0.65" filter="url(#drop)"/>
  <path d="${path(OUTLINE)}" transform="translate(10 34)" fill="${p.shadow}" opacity="0.55" filter="url(#drop)"/>` : ''}
  <g opacity="0.84">
    ${FACETS.map((points, i) => `<path d="${path(points)}" fill="url(#facet${i})"/>`).join('\n    ')}
  </g>
  <g clip-path="url(#crystal)">
    <ellipse cx="${caustic[0]}" cy="${caustic[1]}" rx="90" ry="120" fill="${mix(p.facets[1], '#FFFFFF', 0.4)}" opacity="0.55" filter="url(#bloom)"/>
    <path d="${path(OUTLINE)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="44" stroke-linejoin="round" filter="url(#soft)"/>
    <path d="M${LEFT - 60} ${TOP - 60}L${RIGHT + 60} ${TOP - 60}L${LEFT - 60} ${BOTTOM - 80}Z" fill="url(#sheen)"/>
    <ellipse cx="${glint[0]}" cy="${glint[1]}" rx="110" ry="26" transform="rotate(${glintAngle.toFixed(1)} ${glint[0]} ${glint[1]})" fill="#FFFFFF" opacity="0.6" filter="url(#glint)"/>
  </g>
  <g fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round">
    ${RIDGES.map(([from, to]) => `<path d="M${from[0]} ${from[1]}L${to[0]} ${to[1]}"/>`).join('\n    ')}
  </g>
  <path d="${path(OUTLINE)}" fill="none" stroke="url(#rim)" stroke-width="7" stroke-linejoin="round"/>`;
  return { defs, body };
}

function svg(viewBox: string, width: number, defs: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="${viewBox}">
  <defs>${defs}
  </defs>${body}
</svg>
`;
}

/** the flattened icon: full-bleed and opaque, as app stores and Expo tooling expect. */
export function flatIcon(p: Palette): string {
  const shard = crystal(p, { shadow: true });
  return svg(`0 0 ${SIZE} ${SIZE}`, SIZE, backgroundDefs(p) + shard.defs, backgroundLayers + shard.body);
}

/** one Icon Composer layer: a flat facet on the full canvas, so it needs no offset. */
function facetLayer(points: readonly Point[], color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <path d="${path(points)}" fill="${color}"/>
</svg>
`;
}

export function iconComposerJson(p: Palette): string {
  const icon = {
    fill: { 'automatic-gradient': extendedSrgb(p.background.base) },
    groups: [
      {
        layers: FACETS.map((_, i) => ({ 'image-name': `facet-${i + 1}.svg`, name: `facet-${i + 1}` })),
        shadow: { kind: 'neutral', opacity: 0.5 },
        translucency: { enabled: true, value: 0.4 },
      },
    ],
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  };
  return `${JSON.stringify(icon, null, 2)}\n`;
}

function png(source: string, width: number): Buffer {
  return new Resvg(source, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' })
    .render()
    .asPng();
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
    FACETS.forEach((points, i) =>
      write(root, `${palette.bundle}/Assets/facet-${i + 1}.svg`, facetLayer(points, palette.facets[i])),
    );
    write(root, palette.png, png(flatIcon(palette), SIZE));
  }

  const shard = crystal(RELEASE, { shadow: false });
  // the splash shows the shard alone; the square view box keeps it centered.
  write(root, 'assets/images/splash-icon.png', png(svg('152 156 720 720', 1024, shard.defs, shard.body), 1024));

  // android keeps the foreground inside the adaptive icon's central safe zone.
  write(root, 'assets/images/android-icon-foreground.png', png(svg('-40 -36 1100 1100', 512, shard.defs, shard.body), 512));
  write(
    root,
    'assets/images/android-icon-background.png',
    png(svg(`0 0 ${SIZE} ${SIZE}`, 512, backgroundDefs(RELEASE), backgroundLayers), 512),
  );
  const monochrome = `
  <mask id="cut"><path d="${path(OUTLINE)}" fill="#FFFFFF"/>
    <g fill="none" stroke="#000000" stroke-width="14" stroke-linecap="round">
      ${RIDGES.map(([from, to]) => `<path d="M${from[0]} ${from[1]}L${to[0]} ${to[1]}"/>`).join('')}
    </g>
  </mask>`;
  write(
    root,
    'assets/images/android-icon-monochrome.png',
    png(svg('-40 -36 1100 1100', 432, monochrome, `<rect width="${SIZE}" height="${SIZE}" fill="#FFFFFF" mask="url(#cut)"/>`), 432),
  );

  const rounded = `<clipPath id="corner"><rect width="${SIZE}" height="${SIZE}" rx="230"/></clipPath>`;
  const flat = crystal(RELEASE, { shadow: true });
  write(
    root,
    'assets/images/favicon.png',
    png(
      svg(
        `0 0 ${SIZE} ${SIZE}`,
        48,
        backgroundDefs(RELEASE) + flat.defs + rounded,
        `<g clip-path="url(#corner)">${backgroundLayers}${flat.body}</g>`,
      ),
      48,
    ),
  );
}

if (import.meta.main) {
  generate(join(import.meta.dir, '..'));
}
