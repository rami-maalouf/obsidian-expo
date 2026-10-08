# Technology decisions

This file records technology choices required by KTD8, following the [technology options](technology-options-2026-10.md). Each entry gives the option ID, the choice, alternatives, sources, compatibility findings, validation evidence, and open limits. Choices that need macOS, Xcode, or devices are listed as pending.

## Native verification environment

The cloud workers that implement this plan run Linux and cannot run Xcode. Native code is compiled and tested by the [ios workflow](../.github/workflows/ios.yml) on GitHub-hosted macOS runners, which are free for this public repository. Observed on October 8, 2026: image `macos-26-arm64` version 20260907.0351, macOS 26.6.2, Xcode 26.6 (17F113), Swift 6.3.3. The starter was originally verified with Xcode 27.0; the runner image did not offer a stable Xcode 27 at this date. Simulator builds and tests on this runner do not qualify physical-device input, performance, or iCloud behavior.

## T03. Native module authoring

**Decided:** October 8, 2026, for U1-U2.

**Choice:** option A, the established Expo Modules API (`Module`, `ModuleDefinition`, `AsyncFunction`) from `expo-modules-core@58.0.14`, in a local module at `modules/vault`. Autolinking finds it through the default `./modules` search path; no `package.json` is needed.

**Structure:** all file rules live in a Foundation-only core (`modules/vault/ios/Core`). The Expo binding (`VaultModule.swift`) only converts arguments and results. `modules/vault/Package.swift` builds the core alone, so `swift test` runs it on a Mac without a Simulator. The podspec compiles the same core sources into the app.

**Alternatives:** option B, the Expo Modules 2.0 Swift macros (`@JS`, `@ExpoModule`), which `expo-modules-core@58.0.14` ships. The options research describes them as a preview that does not cover native views. Because the binding is thin, moving the service functions to macros later changes only `VaultModule.swift`.

**Validation:** the ios workflow confirms that `VaultModule` appears in the generated `ExpoModulesProvider.swift` after `expo prebuild`. Core tests pass with `swift test`. Simulator compile evidence is recorded in [validation](validation.md).

**Limits:** no runtime call from JavaScript has been observed in a running app yet. The editor view (T05) is not part of this decision.

## T04. Original-vault and iCloud document access

**Decided provisionally:** October 8, 2026, for U2. iCloud qualification remains open (U8).

**Choice:** an explicit `NSFileCoordinator` service rather than per-note `UIDocument`. Every read, exclusive create, and conditional save runs inside one coordinated access. A save rereads the file inside the coordinated write and replaces it only when the bytes still match the base revision. New files are staged in the system's item-replacement directory and moved into place with `renamex_np(RENAME_EXCL)`, so a create never replaces an existing file. Folder access uses a security-scoped bookmark from the system folder picker, stored with a stable vault ID in app-private storage. A session keeps access until running operations finish.

**Alternatives:** per-note `UIDocument`, or a composition of a directory service with per-note documents. `UIDocument` supplies autosave and conflict-version handling, but its save path writes without exposing a compare-then-replace step inside the same coordinated write. The Persistence Protocol needs that step. A composition remains possible for the editor's document lifecycle in U3.

**Validation:** `swift test` on the macOS runner covers path containment (including dangling and relative symlinks), file states (readable, legacy cloud stub, absent, unlistable folder), exact-byte reads, exclusive create with 16 concurrent writers, conditional save conflicts, deleted and renamed targets, failed writes, the draft journal, enumeration, the bookmark registry, and session release ordering.

**Limits and open work:**

- Not tested with real iCloud Drive. Modern iCloud placeholders are detected through `ubiquitousItemDownloadingStatus`, which cannot be produced on the CI runner; only the legacy `.name.icloud` stub is tested.
- File presenters and foreground reconciliation for open documents are not implemented yet; they belong with the editor sessions in U3.
- The folder picker and bookmark persistence on iOS need a manual or UI-test run in the Simulator.

## T12 (part). Test runner for pure TypeScript logic

**Decided:** October 8, 2026, for U1 and U6.

**Choice:** Bun's built-in test runner (`bun test`), with `@types/bun@1.3.14` as a development dependency. `bun run test` is the common entry point, and `bun run check` runs it.

**Version:** Bun 1.3.14, the version pinned by `packageManager` in `package.json` and used by CI. `@types/bun` is pinned to the same version so the declared APIs match the runtime.

**Alternatives:** the Expo Jest setup (`jest-expo`, Jest, React Native Testing Library). It remains the planned choice for component and Router tests when those tests exist. It is not needed for pure logic, and adding it now would add a transform and mock layer with no tests to use it.

**Compatibility findings:**

- TypeScript 6.0.3 in this repository did not include `@types/bun` automatically. Test and script files failed to type-check until the types were listed explicitly.
- Listing Bun types in the app's `tsconfig.json` would expose Bun and Node globals, such as `Buffer`, to React Native code where they do not exist. Tests and scripts therefore use a separate `tsconfig.tools.json` project with `"types": ["bun"]`. The app project stays without them; a probe import of `node:fs` from `src/` fails its type check, as intended.
- Bun resolves the `@/*` path alias from `tsconfig.json`, so tests import app modules the same way the app does.

**Validation:** 62 tests across 5 files pass on Bun 1.3.14 and 1.4.2 in a Linux container. Deliberate type errors in `tests/` and in `src/` are both reported by `bun run typecheck`.

**Limits:** Bun runs the tests on JavaScriptCore, not Hermes. Logic that depends on engine behavior (dates, `Intl`, regular expressions) must also be checked in the iOS app; see T10.

## T10. Dates for the Templater subset

**Decided:** October 8, 2026, for U6.

**Choice:** no date library. `src/features/templates/civil-time.ts` implements the KTD6 needs directly:

- `captureClock` reads the device's local wall clock once, using only `Date`'s local getters.
- Calendar-day offsets use proleptic Gregorian day numbers computed through UTC, so DST cannot move a day.
- Output uses a fixed formatter for exactly the six KTD6 formats. Reference dates use a strict parser for `YYYY-MM-DD` and `YYYYMMDD`.

**Alternatives considered** (from the dated options research; no package was installed, so their registry versions were not rechecked):

| Option | Why not chosen |
| --- | --- |
| `date-fns@4.4.0` with a format adapter | An adapter mapping the six allowed formats is still required, because date-fns uses Unicode tokens. Once that adapter exists, the library adds only day arithmetic, which is a few lines. |
| Temporal with `@js-temporal/polyfill@0.5.1` | `PlainDate` fits the model, but Hermes support and the polyfill's `Intl` behavior on iOS are unverified. It is a larger dependency for the same six formats. |
| `moment@2.31.0` adapter | It matches Templater's tokens, but it is a mutable legacy library. A token-compatible library also makes it easy to pass unvetted formats through, which KTD6 forbids. |

**Compatibility findings:** the implementation uses only `Date` construction, local getters, UTC setters, and string padding. It does not use `Intl`, `Temporal`, or locale formatting, so it does not depend on Hermes `Intl` support.

**Behavior to note:** Templater (Moment) adds day offsets in local time. If the result falls in a skipped DST hour, Moment moves the time forward. This implementation keeps the captured wall-clock time unchanged on the target day. It affects only `HH:mm` output combined with a nonzero offset on a DST transition day.

**Validation:** `tests/unit/templates.test.ts` covers the six formats, strict reference parsing, leap days (including 1900-style and 2000-style century rules), month and year boundaries, years 1-9999, wall-clock preservation across US DST changes, and `captureClock` in `America/New_York` (before and after the 2026-03-08 change) and `Asia/Tokyo` subprocesses.

**Limits:** the time-zone test runs on Bun (JavaScriptCore). Running the same capture check in the iOS app on Hermes remains open for U7, which owns Today and time-zone changes.

## Pending decisions

These need macOS with Xcode, the iOS Simulator, or physical devices. They are not decided.

| Option | Unit | Blocking need |
| --- | --- | --- |
| T01-T02 framework group and toolchain | U1 | A native service call in a running app and an editor view mount |
| T04 iCloud qualification | U2, U8 | Disposable iCloud vaults on devices |
| T05 source editor | U3 | Release-build input trials on device |
| T06 SQLite library, T07 list virtualization | U4, U5 | FTS5 in the iOS binary; scrolling and accessibility checks on device |
| T08 navigation shell, T11 state and styling | U5 | iPhone and iPad layout, keyboard, and VoiceOver checks |
| T09 calendar | U7 | Day selection, reselection, and accessibility on iOS |
| T12 end-to-end and UI test tools | U1-U3 | Xcode scheme inspection and Simulator runs; native unit tests already use Swift Testing through `swift test` |
| T13 native generation and builds | U1 | Clean prebuild and reproducible Simulator builds |
