import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app variants on top of `app.json`.
 *
 * eas.json sets APP_VARIANT for the development and preview build profiles; without it, the
 * config describes the release app. each variant has its own name, bundle identifier, and URL
 * scheme, so all three can be installed on one iPhone side by side. the development variant
 * also has its own icon. `app.json` stays the static base, so `eas init` can still write the
 * project ID there.
 */
type Variant = 'development' | 'preview' | 'production';

const VARIANTS: Record<Variant, { label?: string; suffix: string; icon?: string; iosIcon?: string }> = {
  development: {
    label: 'Dev',
    suffix: 'dev',
    icon: './assets/images/icon-dev.png',
    iosIcon: './assets/icons/app-dev.icon',
  },
  preview: { label: 'Preview', suffix: 'preview' },
  production: { suffix: '' },
};

function appVariant(): Variant {
  const value = process.env.APP_VARIANT || 'production';
  if (value in VARIANTS) {
    return value as Variant;
  }
  throw new Error(`unknown APP_VARIANT "${value}"; use development, preview, or production`);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = VARIANTS[appVariant()];
  const { name, slug, scheme, ios, android } = config;
  if (!name || !slug || typeof scheme !== 'string' || !ios?.bundleIdentifier || !android?.package) {
    throw new Error('app.json must set name, slug, scheme, ios.bundleIdentifier, and android.package');
  }
  const withSuffix = (id: string, separator: string) => (variant.suffix ? `${id}${separator}${variant.suffix}` : id);
  // EAS Update serves this project's updates from its project ID, which `eas init` adds to app.json.
  const projectId: unknown = config.extra?.eas?.projectId;

  return {
    ...config,
    name: variant.label ? `${name} ${variant.label}` : name,
    slug,
    scheme: withSuffix(scheme, '-'),
    icon: variant.icon ?? config.icon,
    ios: {
      ...ios,
      bundleIdentifier: withSuffix(ios.bundleIdentifier, '.'),
      icon: variant.iosIcon ?? ios.icon,
    },
    android: { ...android, package: withSuffix(android.package, '.') },
    updates: typeof projectId === 'string' ? { ...config.updates, url: `https://u.expo.dev/${projectId}` } : config.updates,
    plugins: [
      ...(config.plugins ?? []),
      // the preview app does not register the dev client's scheme, so QR codes from
      // `expo start` open the development build rather than the preview app.
      ['expo-dev-client', { addGeneratedScheme: variant !== VARIANTS.preview }],
    ],
  };
};
