# Cloud development

## Start from a checkout

Run commands from the repository root with Git, Bun 1.3.14, and Node.js 24.3 or later on the 24 LTS line. CI uses Node.js 24 and Ubuntu 24.04. Dependency installation and public documentation need network access.

```sh
bun install --frozen-lockfile
bun run check
bunx expo install --check
bun run export
```

No environment file, app secret, Expo login, personal vault, or sibling checkout is required for these baseline commands. The [CI workflow](../.github/workflows/check.yml) runs them in a fresh hosted checkout.

`bun run check` includes the repository reference check, TypeScript, and ESLint. The [reference checker](../scripts/check-references.mjs) verifies local Markdown links, repository containment, and common machine-specific paths in tracked documentation and source files. Type checking and bundling resolve the app's code and asset imports. It does not validate arbitrary future code paths written in backticks, remote websites, or generated native build results.

## What a worker can verify

| Worker capability | Available checks |
| --- | --- |
| Linux with Node and Bun | Reference checks, TypeScript, lint, production JS exports for all three platforms, and future platform-independent tests |
| Linux with Java 17 or newer | The Kotlin vault core's tests (`modules/vault/android/core-tests/gradlew -p modules/vault/android/core-tests test`); no Android SDK needed |
| Worker with a browser | Web UI and navigation, in addition to the command-line checks |
| macOS with Xcode and CocoaPods | iOS native build and Simulator interaction |
| Worker with Android SDK, Java, and an emulator | Android native build and emulator interaction; the [android workflow](../.github/workflows/android.yml) does both on GitHub's Linux runners |
| Suitable physical Apple devices and disposable iCloud vaults | Input behavior, release performance, cloud downloads, external edits, and multi-device conflict qualification |

Linux cannot run Xcode or the iOS Simulator. A Linux container whose network policy blocks Google's Android SDK downloads cannot compile the Android app; push the branch and read the android workflow's results instead. Missing native or device infrastructure must remain an explicit verification gap; do not replace those checks with a claim that JS export proves native behavior.

## Native builds

On an appropriately equipped worker:

```sh
bun run ios
bun run android
```

These commands generate native projects from committed app configuration and dependencies. The ignored `ios/` and `android/` directories are outputs, not missing reference material. A fresh Mac must build its own development app; it cannot reuse the original computer's installed simulator app or derived-data cache.

The initial SDK 58 Expo Go attempt failed to load ExpoAsset, so use the project's development build. After building, start Metro with `bun start`. See the [root README](../README.md) for port options and runtime checking. Any host name or port there refers to the worker running Metro, not to a required server on the original computer.

## Reference material and generated data

Read the [reference inventory](references/README.md). Use committed examples as immutable inputs and copy them into disposable test directories before writing to them. The small examples provide the necessary Markdown and template shapes without access to a real vault.

The 10,000-note generator is in [scripts/generate-vault.ts](../scripts/generate-vault.ts); see the [root README](../README.md#test-fixtures) for its commands. Native module tests and feature E2E suites are future implementation tasks in U1-U8. They are not prerequisites stored elsewhere. Implement and commit their source when reaching those units; keep generated large data and build outputs ignored. [Technology decisions](technology-decisions.md) and [validation](validation.md) record the choices made and the evidence collected so far.

## Plan and workflow entry points

- [Agent instructions](../AGENTS.md)
- [Project context and user request summary](PROJECT_CONTEXT.md)
- [Specification and implementation plan](plans/2026-10-08-0149-feat-native-vault-notes-plan.md)
- [Starter verification](../VERIFICATION.md)

The Compound Engineering plugin is optional for reading and executing the committed plan. The unit dependencies, requirements, invariants, tests, and done criteria are included in the document. Do not look for local skill files or previous conversation transcripts as required inputs.
