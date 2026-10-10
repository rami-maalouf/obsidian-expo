# obsidian-expo

An Expo SDK 58 app, in progress, for writing in an existing Markdown vault on iPhone, iPad, and Android. The iOS code opens a vault folder in place, shows unsaved drafts first, opens or creates today's daily note, edits Markdown source in a native text view with restrained styling and journaled, conditional saves, and searches the vault. The interface follows the phone's light or dark appearance and works like Obsidian's: the note sits between two side panels, files and bookmarks on the left and a calendar on the right, which slide over the note on a phone and can stay beside it on an iPad. Panel contents, toolbars, menus, search, and settings are native iOS views, with Liquid Glass panels on iOS 26. The Android app shares the JavaScript and has a Kotlin version of the native vault module: the vault is a folder picked with Android's folder picker, and the editor shows Markdown source with light styling. Its screens are React Native views in Obsidian's light and dark colors; [compatibility](docs/compatibility.md#android) lists how it differs. A Simulator test covers today's note, typing, saving, and search on iOS, and an emulator test in CI covers the same flow on Android, starting from the system folder picker. No feature is qualified on a device or with iCloud yet. [Validation](docs/validation.md) lists what is verified and how. The web build shows only the app shell.

## Specification and implementation plan

The [combined specification and plan](docs/plans/2026-10-08-0149-feat-native-vault-notes-plan.md) covers vault access, native editing, search, bookmarks, calendar daily notes, templates, and verification gates. It is aligned with this SDK 58 starter and distinguishes completed setup from the feature work still to do. The [reference inventory](docs/references/README.md) links committed sanitized notes, templates, their linked notes, and an example configuration; private originals are not included.

[Technology decisions](docs/technology-decisions.md) records library choices made so far, and [validation](docs/validation.md) records evidence and open gaps for each implementation unit.

For cloud work, start with [agent instructions](AGENTS.md), [project context](docs/PROJECT_CONTEXT.md), and the [cloud development guide](docs/CLOUD_DEVELOPMENT.md). They include the user request summary, Compound Engineering plan provenance, setup commands, reference inventory, and platform limits. No local folder or previous conversation is required.

## Toolchain

The [technology-options research](docs/technology-options-2026-10.md) and its version snapshot are included alongside the plan. The [transfer inventory](docs/PLANNING_TRANSFER.md) accounts for all material brought over from the planning project. Feature implementation targets iOS (iPhone/iPad) and, since October 9, 2026, Android; web starter checks do not expand that scope.

- Expo `58.0.7` and Expo Router `58.0.17`
- React `19.3.0` and React Native `0.88.0-rc.4`
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

On first launch, choose the vault folder in the system folder picker; it starts in the shared Documents folder.

After the first native build, `bun start` starts Metro for the installed development app. Rebuild after changing native dependencies or native app configuration. This project uses a development build; the initial SDK 58 Expo Go simulator attempt failed to load `ExpoAsset`.

To use a separate Metro port:

```sh
bun run ios --port 8098
bun run web --port 8099
```

The native application identifier is `com.ramimaalouf.obsidianexpo`. Native projects are generated from `app.json` and dependencies when needed; `ios/` and `android/` stay out of version control. Web uses static output because this starter has no server routes or server rendering requirement.

## Run on an iPhone

`eas.json` defines two builds for a physical iPhone. Both use internal distribution: you install them from a link, without the App Store. Each has its own bundle identifier, so both can be on the phone at the same time.

| Build | Command | Bundle identifier | Icon | JavaScript |
| --- | --- | --- | --- | --- |
| Development | `bun run build:dev` | `com.ramimaalouf.obsidianexpo.dev` | Amber shard | From Metro (`bun run dev`), or an EAS update chosen in the dev client's Extensions tab |
| Preview | `bun run build:preview` | `com.ramimaalouf.obsidianexpo.preview` | Violet shard | The embedded bundle, then updates from the `preview` channel |

Do these steps one time, on a computer with access to the Expo account and an Apple Developer account:

```sh
bun add --global eas-cli   # or prefix each eas command with bunx eas-cli@latest
eas login
eas init                   # links @ramimaalouf/obsidian-expo and writes extra.eas.projectId to app.json
eas device:create          # registers the iPhone for ad hoc builds
```

Commit the project ID that `eas init` writes to `app.json`. The update URL comes from it; until it exists, builds have updates turned off.

Then start the builds. The first build asks for Apple credentials and creates the provisioning profiles. Open the build link on the iPhone to install the app. iOS requires Developer Mode (Settings > Privacy & Security) for these builds.

To develop, run `bun run dev` and open the server from the development build.

To send JavaScript and asset changes to the preview build without a new build, run `bun run update:preview`. The preview app downloads the update in the background when it opens and uses it at the next launch. An update reaches only builds with the same runtime fingerprint, so native or app config changes need a new build. The script sets `APP_VARIANT=preview` because the variant is part of the fingerprint.

`app.config.ts` applies the variants on top of `app.json`; without `APP_VARIANT`, the config describes the release app, as in CI. `bun run icons` regenerates every icon from `scripts/generate-icons.ts`. [Technology decisions](docs/technology-decisions.md) (T14 and T15) records these choices.

## Run on Android

The same EAS profiles build Android APKs, which install from a link without Google Play:

```sh
bun run build:dev:android
bun run build:preview:android
```

The development and preview builds have their own application IDs (`com.ramimaalouf.obsidianexpo.dev` and `.preview`), so both can be installed beside each other. Enable installing from unknown sources for the browser that opens the link. `bun run update:preview` sends JavaScript updates to preview builds of both platforms that have the same runtime fingerprint.

Without an Expo account, run the [android workflow](.github/workflows/android.yml) from the Actions tab, or push a tag that starts with `android-v`. After the emulator test passes, it publishes the tested Release APK as a GitHub prerelease, which downloads without a GitHub sign-in. The APK has native code for phones (arm64-v8a) and emulators (x86_64). It is signed with the generated project's debug key, so it installs from the file but not through Google Play.

### Try a copy of your vault on an emulator

Start an Android emulator, install the app with `bun run android`, and copy a vault folder to the emulator's Documents folder:

```sh
scripts/emulator-vault.sh push "<vault folder>" [name]
```

The script only reads the vault folder; it never writes to it, moves it, or deletes from it. It refuses to replace an earlier copy on the emulator, refuses a folder with iCloud files that are not downloaded, and checks the copy byte for byte. In the app, choose "Choose Folder", then Documents and the copy's name. Afterwards, `scripts/emulator-vault.sh check <name>` lists the files the app added, changed, or removed in the copy, by path only. Its working files are in the ignored `.fixtures/emulator/` folder; keep a real vault's notes out of the repository.

## Checks

```sh
bun run check
bunx expo install --check
bunx expo-doctor@latest
bun run export
```

`check` validates repository references, runs TypeScript and ESLint with zero warnings allowed, and runs `bun test`. TypeScript checks two projects: `tsconfig.json` for app code, which cannot use Bun or Node APIs, and `tsconfig.tools.json` for tests and scripts. `export` produces production bundles for web, iOS, and Android; it does not compile a native binary. GitHub Actions runs installation, reference checking, type checking, linting, tests, dependency alignment, and production export on pushes and pull requests.

For a running iOS development app, Expo's CLI provides a runtime smoke check:

```sh
bunx @expo/agent-cli smoke --ios --no-start --port 8098 --window 10s --json
```

Inspect the screenshot and interact with the screens as well: a successful runtime probe alone does not prove that the UI rendered correctly.

## Native tests and builds

On a Mac with Xcode, run the vault core's Swift tests without a Simulator:

```sh
swift test --package-path modules/vault
```

The [ios workflow](.github/workflows/ios.yml) runs these tests on GitHub's macOS runners.

The Android vault core is plain Kotlin, so its tests run on any computer with Java 17 or newer, without the Android SDK:

```sh
modules/vault/android/core-tests/gradlew -p modules/vault/android/core-tests test
```

The [android workflow](.github/workflows/android.yml) runs these tests, builds the Release app for arm64-v8a and x86_64, and runs `scripts/ci/emulator-smoke.sh` on an Android 15 emulator. The script copies `tests/fixtures/vault-basic` to the emulator's Documents folder, and the Maestro flows in `tests/e2e/android` pick it with the system folder picker, accept the settings that first setup found, write in today's note, edit a list line with the editing toolbar and undo, relaunch, and search. The script checks today's note on disk and that every other fixture file is byte-identical. The app itself needs Xcode 27, which those runners do not offer, so build the Release app for the Simulator and run the smoke test on a Mac with Xcode 27 and CocoaPods:

```sh
bun install --frozen-lockfile
bunx expo prebuild --platform ios
workspace=$(ls -d ios/*.xcworkspace | head -1)
xcodebuild -workspace "$workspace" -scheme "$(basename "$workspace" .xcworkspace)" -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO -quiet build
app=$(ls -d build/Build/Products/Release-iphonesimulator/*.app | head -1)
scripts/ci/simulator-smoke.sh "iPhone" "$app" smoke/iphone \
  tests/e2e/editor/today-write.yaml tests/e2e/navigation/history.yaml tests/e2e/editor/background.yaml @external-edit \
  tests/e2e/editor/foreground.yaml @lock-daily tests/e2e/recovery/unsaved-draft.yaml @unlock-daily \
  tests/e2e/recovery/open-draft.yaml tests/e2e/daily-notes/relaunch-today.yaml tests/e2e/editor/new-rename.yaml
scripts/ci/simulator-smoke.sh "iPad Pro 13" "$app" smoke/ipad \
  tests/e2e/editor/today-write.yaml tests/e2e/navigation/history.yaml tests/e2e/navigation/ipad-layout.yaml \
  tests/e2e/daily-notes/relaunch-today.yaml tests/e2e/editor/new-rename.yaml
```

The smoke test copies `tests/fixtures/vault-basic` into the app's Documents folder, launches the app with a Simulator-only `-VaultTestFolder vault` argument, and checks that today's note was created from the built-in template, that every other fixture file is byte-identical, and that the search index found the notes. After `new-rename.yaml`, it checks that the renamed note holds the text typed before and right after the rename.

A preliminary search benchmark over the generated 10,000-note vault runs on any machine with Bun; it does not qualify device performance:

```sh
bun scripts/benchmark-search.ts
```

## Test fixtures

`tests/fixtures/vault-basic/` is a small authored vault. It covers frontmatter, wikilinks, embeds, plugin syntax, Unicode (NFC and NFD), CRLF and mixed newlines, a UTF-8 BOM, Latin-1 and UTF-16 files, repeated basenames, daily notes, and supported and unsupported templates. `.gitattributes` stops Git from converting its bytes. `vault-basic.manifest.json` records each file's size and SHA-256, and `bun test` fails if any byte changes:

```sh
bun scripts/vault-manifest.ts tests/fixtures/vault-basic          # check
bun scripts/vault-manifest.ts tests/fixtures/vault-basic --write  # only after an intended fixture change
```

Generate the large synthetic vault in a disposable directory. Inside this repository, only the ignored `.fixtures/` directory is allowed:

```sh
bun scripts/generate-vault.ts --out /tmp/vault-10k
bun scripts/generate-vault.ts --out /tmp/vault-10k-stress --stress
```

The default run (seed 1, generator version 1) writes 10,000 UTF-8 notes of 2-8 KiB: 730 daily notes and 9,270 notes in nested folders, with repeated basenames. Its manifest has 44,317,263 bytes in total and digest `f9d3c347c7910e5a561272cd7a2fbf30bde630e7d12e3df6fe20618732dd80e0`. `--stress` also writes `Stress/Long 100 KiB.md` and `Stress/Long 1 MiB.md`. The manifest is written next to the vault as `<out>.manifest.json`.

## Layout

- `src/app/`: Expo Router routes
- `src/features/`: daily notes, templates, editor status, recovery, search, and vault hooks
- `src/components/`: shared UI components
- `src/hooks/`: theme hooks
- `src/constants/theme.ts`: colors, spacing, and typography
- `modules/vault/`: local Expo module. `ios/Core/` is Foundation-only file and document logic, built by `Package.swift` for `swift test`; `ios/Editor/` is the native editor view; `android/` is the Kotlin module, with plain Kotlin logic in `android/src/main/java/expo/modules/vault/core/` that `android/core-tests` builds for `gradle test`; `src/` is the typed JavaScript API shared by both
- `assets/`: app icons and images. `assets/icons/` holds the Icon Composer bundles for iOS; `scripts/generate-icons.ts` writes them and the PNG icons. `assets/icons/android/` holds the Android app bar icons, which `scripts/generate-android-icons.ts` (`bun run icons:android`) draws from the Material Symbols font
- `scripts/`: fixture generation, manifests, icon generation, and the search benchmark
- `tests/`: `bun test` suites and fixtures

## Starter compatibility fixes

The SDK 58 template's web tab ref type needed to match React Native 0.88's native element ref. The web theme hydration hook uses `useSyncExternalStore` to preserve the server fallback without a synchronous state update in an effect. ESLint is on version 9 because the installed Expo React lint plugin does not support ESLint 10's removed APIs. An explicit Expo types reference makes CSS imports type-check on a fresh checkout before Metro generates its local type files.
