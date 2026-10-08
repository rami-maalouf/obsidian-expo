# obsidian-expo

An Expo SDK 58 starter for a future Markdown notes app. The current app contains Home and Explore screens, native tabs on iOS and Android, web navigation, and light and dark themes. Vault access and note editing are not implemented yet.

## Toolchain

- Expo `58.0.6` and Expo Router `58.0.16`
- React `19.3.0` and React Native `0.88.0-rc.3`
- TypeScript with strict checking
- Bun `1.3.14`, with dependency versions recorded in `bun.lock`
- Node.js 24.3 or newer on the 24 LTS line, or Node.js 26

SDK 58 is in beta as of October 8, 2026. See the [release notes](https://expo.dev/changelog/sdk-58-beta) and [SDK 58 documentation](https://docs.expo.dev/versions/v58.0.0/).

## Run locally

```sh
bun install --frozen-lockfile
bun run web
```

Build and open the iOS development app on a Mac with Xcode and CocoaPods installed:

```sh
bun run ios
```

Build and open Android with an Android SDK and emulator installed:

```sh
bun run android
```

After the first native build, `bun start` starts Metro for the installed development app. Rebuild after changing native dependencies or native app configuration. This project uses a development build; the initial SDK 58 Expo Go simulator attempt failed to load `ExpoAsset`.

To use a separate Metro port:

```sh
bun run ios --port 8098
bun run web --port 8099
```

The native application identifier is `com.ramimaalouf.obsidianexpo`. Native projects are generated from `app.json` and dependencies when needed; `ios/` and `android/` stay out of version control. Web uses static output because this starter has no server routes or server rendering requirement.

## Checks

```sh
bun run check
bunx expo install --check
bunx expo-doctor@latest
bun run export
```

`check` runs TypeScript and ESLint with zero warnings allowed. `export` produces production bundles for web, iOS, and Android; it does not compile a native binary. GitHub Actions runs installation, type checking, linting, dependency alignment, and production export on pushes and pull requests.

For a running iOS development app, Expo's CLI provides a runtime smoke check:

```sh
bunx @expo/agent-cli smoke --ios --no-start --port 8098 --window 10s --json
```

Inspect the screenshot and interact with the screens as well: a successful runtime probe alone does not prove that the UI rendered correctly.

## Layout

- `src/app/`: Expo Router routes
- `src/components/`: starter UI components
- `src/hooks/`: theme hooks
- `src/constants/theme.ts`: colors, spacing, and typography
- `assets/`: starter icons and images

## Starter compatibility fixes

The SDK 58 template's web tab ref type needed to match React Native 0.88's native element ref. The web theme hydration hook uses `useSyncExternalStore` to preserve the server fallback without a synchronous state update in an effect. ESLint is on version 9 because the installed Expo React lint plugin does not support ESLint 10's removed APIs. An explicit Expo types reference makes CSS imports type-check on a fresh checkout before Metro generates its local type files.
