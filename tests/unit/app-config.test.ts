import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import appConfig from '../../app.config';
import { DEVELOPMENT, generate, RELEASE } from '../../scripts/generate-icons';

const root = join(import.meta.dir, '../..');
const base = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const scratch = mkdtempSync(join(tmpdir(), 'obsidian-expo-icons-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const original = process.env.APP_VARIANT;
afterEach(() => {
  process.env.APP_VARIANT = original;
});

function configFor(variant: string | undefined, extra?: Record<string, unknown>) {
  if (variant === undefined) {
    delete process.env.APP_VARIANT;
  } else {
    process.env.APP_VARIANT = variant;
  }
  return appConfig({ config: { ...base, extra }, projectRoot: root, staticConfigPath: null, packageJsonPath: null });
}

const devClientScheme = (config: ReturnType<typeof configFor>) =>
  config.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-dev-client')?.[1];

describe('app variants', () => {
  test('without APP_VARIANT the config is the release app from app.json', () => {
    const config = configFor(undefined);
    expect(config.name).toBe(base.name);
    expect(config.scheme).toBe(base.scheme);
    expect(config.ios?.bundleIdentifier).toBe(base.ios.bundleIdentifier);
    expect(config.ios?.icon).toBe('./assets/icons/app.icon');
    expect(config.icon).toBe('./assets/images/icon.png');
    expect(devClientScheme(config)).toEqual({ addGeneratedScheme: true });
  });

  test('the development build has its own identifier, name, scheme, and icon', () => {
    const config = configFor('development');
    expect(config.name).toBe(`${base.name} Dev`);
    expect(config.scheme).toBe(`${base.scheme}-dev`);
    expect(config.ios?.bundleIdentifier).toBe(`${base.ios.bundleIdentifier}.dev`);
    expect(config.android?.package).toBe(`${base.android.package}.dev`);
    expect(config.ios?.icon).toBe('./assets/icons/app-dev.icon');
    expect(config.icon).toBe('./assets/images/icon-dev.png');
    expect(devClientScheme(config)).toEqual({ addGeneratedScheme: true });
  });

  test('the preview build keeps the release icon and leaves the dev client scheme to the development build', () => {
    const config = configFor('preview');
    expect(config.name).toBe(`${base.name} Preview`);
    expect(config.ios?.bundleIdentifier).toBe(`${base.ios.bundleIdentifier}.preview`);
    expect(config.ios?.icon).toBe('./assets/icons/app.icon');
    expect(devClientScheme(config)).toEqual({ addGeneratedScheme: false });
  });

  test('every variant uses the fingerprint runtime and gets the update URL once a project ID exists', () => {
    for (const variant of ['development', 'preview', 'production']) {
      expect(configFor(variant).runtimeVersion).toEqual({ policy: 'fingerprint' });
      expect(configFor(variant).updates?.url).toBeUndefined();
      const linked = configFor(variant, { eas: { projectId: '00000000-0000-4000-8000-000000000000' } });
      expect(linked.updates?.url).toBe('https://u.expo.dev/00000000-0000-4000-8000-000000000000');
    }
  });

  test('an unknown variant fails instead of building the release app by mistake', () => {
    expect(() => configFor('staging')).toThrow('unknown APP_VARIANT "staging"');
  });

  test('every icon path in every variant exists', () => {
    for (const variant of ['development', 'preview', 'production']) {
      const config = configFor(variant);
      for (const path of [config.icon, config.ios?.icon]) {
        expect(typeof path === 'string' && existsSync(join(root, path))).toBe(true);
      }
    }
  });
});

describe('generated icons', () => {
  generate(scratch);

  test('the committed Icon Composer bundles match the generator', () => {
    for (const { bundle } of [RELEASE, DEVELOPMENT]) {
      const files = ['icon.json', ...readdirSync(join(scratch, bundle, 'Assets')).map((name) => `Assets/${name}`)];
      expect(readdirSync(join(root, bundle, 'Assets')).sort()).toEqual(readdirSync(join(scratch, bundle, 'Assets')).sort());
      for (const file of files) {
        expect(readFileSync(join(root, bundle, file), 'utf8')).toBe(readFileSync(join(scratch, bundle, file), 'utf8'));
      }
    }
  });

  test('every layer named in icon.json exists', () => {
    for (const { bundle } of [RELEASE, DEVELOPMENT]) {
      const icon = JSON.parse(readFileSync(join(root, bundle, 'icon.json'), 'utf8'));
      const layers = icon.groups.flatMap((group: { layers: { 'image-name': string }[] }) => group.layers);
      expect(layers.length).toBeGreaterThan(0);
      for (const layer of layers) {
        expect(existsSync(join(root, bundle, 'Assets', layer['image-name']))).toBe(true);
      }
    }
  });

  test('the flattened icons are square 1024 px PNGs', () => {
    for (const { png } of [RELEASE, DEVELOPMENT]) {
      const bytes = readFileSync(join(root, png));
      expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(bytes.readUInt32BE(16)).toBe(1024);
      expect(bytes.readUInt32BE(20)).toBe(1024);
    }
  });
});
