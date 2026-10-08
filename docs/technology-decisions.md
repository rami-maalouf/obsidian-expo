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

## T05. Markdown source editor

**Decided provisionally:** October 8, 2026, for U3. Device input trials remain open.

**Choice:** a local `UITextView` created with `UITextView(usingTextLayoutManager: true)` (TextKit 2), exposed as an Expo native view (`VaultEditorView`). UIKit supplies selection, composition, dictation, hardware-keyboard input, and undo. Native code owns the text and hands it to the document session after edits settle for 200 ms; JavaScript receives only status and load events. Smart quotes, smart dashes, and smart insert/delete are off so typing does not rewrite Markdown source. New line breaks follow the file's first line break (`\n`, `\r\n`, or `\r`), and existing bytes are never re-encoded. The code does not touch `layoutManager`, which would force a TextKit 1 fallback.

**Alternatives** (from the dated options research; none was installed, so registry versions were not rechecked):

| Option | Why not chosen now |
| --- | --- |
| `@expensify/react-native-live-markdown@0.1.343` | Its compatibility notes cover React Native 0.86, not 0.88, and its Worklets requirement needs reconciling with this SDK. Its parser runs on the UI thread and stops styling above 4,000 characters by default. |
| Enriched Markdown 1.1.1 | Rich-text editing with Markdown output; lossless source editing is not established. |
| CodeMirror 6 through Expo DOM | A separate web runtime with an asynchronous bridge; native input and native draft ownership would need proof. |

**Source styling:** display-only. A `NSTextContentStorageDelegate` (`modules/vault/ios/Editor/MarkdownStyler.swift`) gives TextKit 2 a styled copy of each paragraph it displays; the text storage keeps plain text. So styling cannot change the saved bytes, the selection, keyboard composition (marked text), or the undo stack, which are the usual ways syntax styling breaks input. The styling is restrained: headings are bold and slightly larger; heading hashes, quote markers, list bullets, task boxes, code fences, and front matter use the secondary label color; inline code and fenced blocks use the monospaced system font; wikilinks and embeds use the link color. Fonts derive from the stored body font, so Dynamic Type still applies. Front matter and fenced code are found by one linear scan per edit (`modules/vault/ios/Core/MarkdownStyle.swift`). When an edit opens, closes, or removes a block, the paragraphs after it are rebuilt with an attribute-only edit after the keystroke finishes, and never during composition. Inline styling stops on paragraphs longer than 10,000 UTF-16 units. If UIKit already uses the content storage's delegate, styling turns itself off and logs that.

**Validation:** the document session's persistence rules are covered by `swift test` (see T04), and so are the styling rules (headings, markers, inline code, links, blocks, and block changes after edits). The Simulator flow types a heading and a code fence and checks the exact lines on disk. Simulator compile and smoke evidence is recorded in [validation](validation.md).

**Limits:** no release-build input trials with 4 KiB, 100 KiB, and 1 MiB notes on a device; IME, dictation, hardware-keyboard, and undo behavior with styling on are unverified on a device; the styling has not been inspected visually, because Simulator screenshots are not reachable from the cloud environment.

## T06. SQLite index and metadata

**Decided provisionally:** October 8, 2026, for U4. Device indexing and memory measurements remain open.

**Choice:** `expo-sqlite@~58.0.10`, the version SDK 58's `bundledNativeModules.json` lists (58.0.10 was the newest 58.x release on the registry on October 8). Each vault has a disposable index database in the app's Caches folder, outside the vault and backups, opened in WAL mode. The schema version is stored in `PRAGMA user_version`; a mismatch drops and rebuilds the index from the notes. All writes go through one queue, because the options research notes that async transactions on one connection do not isolate unrelated queries. Only an iOS-specific file imports `expo-sqlite`, so the web export does not need SQLite's WebAssembly setup.

**Query semantics:** filenames use a case-insensitive substring match on the note name and rank first. Content uses FTS5 with the `unicode61` tokenizer and `remove_diacritics 2`; each typed term is a quoted token prefix, and all terms must match. Typed quotes and operators are literal text. Scripts written without spaces (for example Japanese) form long tokens, so content search finds them only from the start of a run; filename search still finds any substring. The trigram tokenizer would fix that but needs at least three characters per query; it is a later option.

**Alternatives:** `@op-engineering/op-sqlite@18.2.5`, which needs explicit FTS5 build configuration. Not adopted while the SDK package meets the needs; no comparative speed claim is made.

**Validation:** `tests/integration/search.test.ts` runs the index over `bun:sqlite` 3.53.0 (FTS5): discovery before reads, bounded batches, edits, deletes and renames, cloud placeholders, unreadable folders, a change during indexing, refresh after save, non-UTF-8 notes, Unicode, stale query generations, and the fixture plus a 2,000-note generated vault. The ios workflow's smoke test checks that the app's own SQLite build creates the FTS5 table and indexes the fixture vault. `scripts/benchmark-search.ts` gives a preliminary host measurement only; see [validation](validation.md).

**Limits:** no device measurement of indexing time, memory, or query latency; no lock-recovery or interrupted-rebuild test on iOS yet.

## T07. Explorer and result virtualization

**Decided provisionally:** October 8, 2026, for U4 search results; U5 revisits it for the explorer.

**Choice:** option A, the core `FlatList`, with no extra dependency. Result rows hold no local state, so recycling concerns do not apply.

**Alternatives:** `@shopify/flash-list` (SDK 58 lists 2.3.2). It will be compared on the explorer in U5, where rapid scrolling and expansion matter more.

**Limits:** scrolling, Dynamic Type, and VoiceOver checks on a device are open.

## T08. Navigation shell

**Decided provisionally:** October 8, 2026, for U5 and U7. iPad resizing and VoiceOver checks remain open.

**Choice:** one Expo Router Stack screen that lays out its own panes with React Native views and `useWindowDimensions`. At 768 points and wider the file sidebar stays beside the editor; below that it opens as a full-screen drawer from a Files button. At 1,180 points and wider the calendar is a trailing panel; below that it opens over the editor. Search and settings open over the editor. Only one overlay is visible at a time (A2). No dependency was added.

**Alternatives:** the Expo Router drawer, which needs `@react-navigation/drawer` and adds a gesture drawer; Router SplitView, which its documentation calls alpha and not for production; and `@expo/ui` `NavigationSplitView`, a preview in SDK 58. The current layout keeps the required behavior without a preview API; the gesture drawer can be added later if device testing shows the button-opened drawer is not enough.

**App configuration:** `ios.supportsTablet` is `true` and `orientation` is `default` in `app.json`. Without `supportsTablet`, an iPad runs the app in iPhone compatibility mode, so the wide layout never appears. All four orientations are needed for rotation (R17) and for iPad multitasking, which iPadOS gives only to apps that support every orientation and do not require full screen. The iOS workflow checks both settings after `expo prebuild`.

**Limits:** no swipe gesture for the drawer; split-screen and Slide Over widths on iPad, state restoration, and keyboard focus after closing overlays are untested.

## T09. Calendar

**Decided provisionally:** October 8, 2026, for U7.

**Choice:** a small month grid built with React Native views (`src/features/calendar/`). It uses the same civil-date code as the template renderer, gives every day an explicit press handler (so re-tapping the selected day opens it again), labels each day for VoiceOver with the weekday, date, "today", and "has a daily note", and shows a dot for days whose note exists. Weeks start on Monday. No dependency was added.

**Alternatives:** the `@expo/ui` SwiftUI DatePicker, whose events describe selection changes (so re-selecting the same day needs a workaround) and which cannot mark days; `react-native-calendars@1.1314.0`, which supports day presses and markings but is a further dependency whose accessibility the app would still own.

**Validation:** `tests/unit/calendar.test.ts` covers the grid, leap February, Sunday- and Monday-first weeks, paging across years, and VoiceOver labels.

**Limits:** the week start does not follow the device locale yet; month and weekday names are English; VoiceOver and Dynamic Type checks on a device are open.

## T11. UI state and styling

**Decided:** October 8, 2026, for the U1-U3 shell.

**Choice:** option A for both layers. UI state uses React state and effects, with asynchronous results keyed to the request that produced them so a stale result is never shown. Editor text stays native. Styling uses React Native `StyleSheet` with the existing theme tokens in `src/constants/theme.ts` and the system light and dark appearance. No dependency was added.

**Alternatives:** `zustand@5.0.15` for shared state; `uniwind@1.12.2` or `react-native-unistyles@3.5.1` for styling. Neither is needed while the shell has one screen; this will be revisited with the sidebar and calendar (U5, U7) if shared state grows.

**Validation:** type check, lint, and production export. Rerender measurements during typing and indexing need a profiler on a device and remain open.

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
| T05 final editor qualification | U3 | Release-build input trials on device |
| T06, T07 device qualification | U4, U5 | Indexing, memory, and query latency on a device; scrolling and accessibility checks; FlashList comparison for the explorer |
| T08, T09 device qualification | U5, U7 | iPhone and iPad layout, multitasking widths, keyboard focus, and VoiceOver checks |
| T12 end-to-end and UI test tools | U1-U3 | Xcode scheme inspection and Simulator runs; native unit tests already use Swift Testing through `swift test` |
| T13 native generation and builds | U1 | Clean prebuild and reproducible Simulator builds |
