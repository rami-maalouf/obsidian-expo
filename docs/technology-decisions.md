# Technology decisions

This file records technology choices required by KTD8, following the [technology options](technology-options-2026-10.md). Each entry gives the option ID, the choice, alternatives, sources, compatibility findings, validation evidence, and open limits. Choices that need macOS, Xcode, or devices are listed as pending.

## Native verification environment

The cloud workers that implement this plan run Linux and cannot run Xcode. Native code is compiled and tested by the [ios workflow](../.github/workflows/ios.yml) on GitHub-hosted macOS runners, which are free for this public repository. Observed on October 8, 2026: image `macos-26-arm64` version 20260907.0351, macOS 26.6.2, Xcode 26.6 (17F113), Swift 6.3.3. The starter was originally verified with Xcode 27.0; the runner image did not offer a stable Xcode 27 at this date. Simulator builds and tests on this runner do not qualify physical-device input, performance, or iCloud behavior.

## T01. Expo, React Native, and their runtime dependencies

**Decided:** October 8, 2026, for U1-U8, within KTD1.

**Choice:** the SDK 58 group from the default template, as resolved in `bun.lock`: `expo@58.0.6`, `react-native@0.88.0-rc.3`, `react@19.3.0`, `expo-router@58.0.16`, `expo-modules-core@58.0.14`, and Hermes (`hermes-compiler@260318099.0.4`). Packages use SDK-compatible ranges; `bunx expo install --check` passes in the `check` workflow. The only runtime dependency added for features is `expo-sqlite@58.0.10` (T06).

**Alternatives:** the stable SDK 57 group (`expo@57.0.27`, `react-native@0.86.3`, `react@19.2.3`); not chosen, because the user asked for SDK 58 (KTD1). Newer standalone React Native, Reanimated, Worklets, or Gesture Handler releases were not substituted.

**Validation:** Release Simulator builds of the full app on M1. On iPhone and iPad Simulators, the JavaScript app called the native vault module (open a vault, list, read, and create notes, read and write app data), mounted the native editor view, received its status events, and ran SQLite FTS5 through `expo-sqlite`; see [validation](validation.md). The Live Markdown Worklets constraint does not apply, because T05 uses a native `UITextView`.

**Limits:** React Native is a release candidate in this SDK, so the group must be rechecked when SDK 58 is final. Device builds are not made (no signing in CI).

## T02. Host tools, Swift, and TypeScript

**Decided:** October 8, 2026, for U1.

**Choice:**

| Tool | Version | Where |
| --- | --- | --- |
| Bun | 1.3.14 (`packageManager` in `package.json`) | L1 and both workflows |
| Node | 24 (`actions/setup-node`) | CI; L1 has 22.22.0 |
| TypeScript | 6.0.3 (`~6.0.3`) | Type check of the app, tests, and scripts |
| Xcode and Swift | Xcode 26.6 (17F113), Swift 6.3.3; iOS 26.4 Simulator runtime | M1, the newest stable Xcode on the runner |
| Vault module Swift settings | Swift tools 6.0, Swift 5 language mode (`Package.swift`); `swift_version` 5.9 (podspec) | `swift test` and the app build |

**Alternatives:** Bun 1.4.2 (the tests also pass on it; not adopted, to keep the lockfile's Bun); TypeScript 7.0.2 (its programmatic compiler API is not provided in 7.0, and Expo tooling was not verified with it); Xcode 27.0, which verified the starter but was not available as a stable Xcode on the runner image.

**Limits:** requalify with Xcode 27 when the runner offers it. Swift 6 language mode was not adopted for the vault module.

## T03. Native module authoring

**Decided:** October 8, 2026, for U1-U2.

**Choice:** option A, the established Expo Modules API (`Module`, `ModuleDefinition`, `AsyncFunction`) from `expo-modules-core@58.0.14`, in a local module at `modules/vault`. Autolinking finds it through the default `./modules` search path; no `package.json` is needed.

**Structure:** all file rules live in a Foundation-only core (`modules/vault/ios/Core`). The Expo binding (`VaultModule.swift`) only converts arguments and results. `modules/vault/Package.swift` builds the core alone, so `swift test` runs it on a Mac without a Simulator. The podspec compiles the same core sources into the app.

**Alternatives:** option B, the Expo Modules 2.0 Swift macros (`@JS`, `@ExpoModule`), which `expo-modules-core@58.0.14` ships. The options research describes them as a preview that does not cover native views. Because the binding is thin, moving the service functions to macros later changes only `VaultModule.swift`.

**Validation:** the ios workflow confirms that `VaultModule` appears in the generated `ExpoModulesProvider.swift` after `expo prebuild`. Core tests pass with `swift test`. Simulator compile evidence is recorded in [validation](validation.md).

**Limits:** the folder picker has not run in CI; the Simulator tests register the fixture vault through a simulator-only launch argument. The editor view (T05) is not part of this decision.

Runtime evidence: on iPhone and iPad Simulators, JavaScript called the module's asynchronous functions and received the editor view's events in the Release app (see [validation](validation.md)).

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

**Validation:** the document session's persistence rules are covered by `swift test` (see T04), and so are the styling rules (headings, markers, inline code, links, blocks, and block changes after edits). The Simulator flow types a heading and a code fence and checks the exact lines on disk; on iPhone and iPad Simulators (`becf682`) the lines were exact and the editor log confirmed that TextKit 2 called the styler. Simulator compile and smoke evidence is recorded in [validation](validation.md).

**Limits:** no release-build input trials with 4 KiB, 100 KiB, and 1 MiB notes on a device; IME, dictation, hardware-keyboard, and undo behavior with styling on are unverified on a device; the styling has not been inspected visually, because Simulator screenshots are not reachable from the cloud environment.

## T06. SQLite index and metadata

**Decided provisionally:** October 8, 2026, for U4. Device indexing and memory measurements remain open.

**Choice:** `expo-sqlite@~58.0.10`, the version SDK 58's `bundledNativeModules.json` lists (58.0.10 was the newest 58.x release on the registry on October 8). Each vault has a disposable index database in the app's Caches folder, outside the vault and backups, opened in WAL mode. The schema version is stored in `PRAGMA user_version`; a mismatch drops and rebuilds the index from the notes. All writes go through one queue, because the options research notes that async transactions on one connection do not isolate unrelated queries. Only an iOS-specific file imports `expo-sqlite`, so the web export does not need SQLite's WebAssembly setup.

**Query semantics:** filenames use a case-insensitive substring match on the note name and rank first. Content uses FTS5 with the `unicode61` tokenizer and `remove_diacritics 2`; each typed term is a quoted token prefix, and all terms must match. Typed quotes and operators are literal text. Scripts written without spaces (for example Japanese) form long tokens, so content search finds them only from the start of a run; filename search still finds any substring. The trigram tokenizer would fix that but needs at least three characters per query; it is a later option.

**Alternatives:** `@op-engineering/op-sqlite@18.2.5`, which needs explicit FTS5 build configuration. Not adopted while the SDK package meets the needs; no comparative speed claim is made.

**Validation:** `tests/integration/search.test.ts` runs the index over `bun:sqlite` 3.53.0 (FTS5): discovery before reads, bounded batches, edits, deletes and renames, cloud placeholders, unreadable folders, a change during indexing, refresh after save, non-UTF-8 notes, Unicode, stale query generations, and the fixture plus a 2,000-note generated vault. The ios workflow's smoke test checks that the app's own SQLite build creates the FTS5 table and indexes the fixture vault. `scripts/benchmark-search.ts` gives a preliminary host measurement only; see [validation](validation.md).

**Limits:** no device measurement of indexing time, memory, or query latency; no lock-recovery or interrupted-rebuild test on iOS yet.

## T07. Explorer and result virtualization

**Decided:** October 8, 2026; revised for the native shell (T08).

**Choice:** the explorer and search results are SwiftUI lists from `@expo/ui`: `List.ForEach` with `data` and `keyExtractor`, which renders only the rows near the visible range and reuses them while scrolling. The folder tree is still flattened in TypeScript (`src/features/explorer/tree.ts`), so only expanded folders produce rows.

**Alternatives:** the core `FlatList` (the earlier choice, not native list cells) and `@shopify/flash-list` (SDK 58 lists 2.3.2), which has the same limit.

**Limits:** scrolling a 10,000-note tree, Dynamic Type, and VoiceOver have not been checked on a device.

## T08. Navigation shell

**Decided:** October 8, 2026, at the user's direction, in two steps. The user first asked for native sidebars and menus with Liquid Glass, a theme that follows the phone, and an Obsidian-like layout: files on the left, calendar on the right. After trying the first native version on a phone, the user asked for side panels that slide over the note in both directions, as in Obsidian, with one header and no stack of routes between the files and the note.

**Choice:** the note is one native `Stack` screen with one navigation bar. Two side panels from `react-native-drawer-layout@4.2.11` (the drawer that Expo Router's own drawer uses; Reanimated and Gesture Handler run its gestures on the UI thread) hold the files on the left and the calendar on the right. On a phone, each panel slides over the note from its edge with a swipe or a toolbar button and closes with a swipe, a tap outside, or a choice. At 768 points and wider, the files panel is pinned beside the note by default and the calendar can be pinned on the right. Panel contents are native SwiftUI views from `@expo/ui` on a Liquid Glass background (`expo-glass-effect` `GlassView`). The navigation bar has the files button on the left and Today, Calendar, and a "More" menu (bookmark, search, new note, settings, vault) on the right, as native `Stack.Toolbar` items.

**Alternatives:** Expo Router's `SplitView` (a native `UISplitViewController`, the first native version): on iPhone it collapses into a navigation stack with a second bar and a back button, which the user rejected; `@expo/ui` `NavigationSplitView`, which collapses the same way and has no right-hand column; Expo Router's drawer navigator, which would add drawer routes and headers that the controlled panels do not need.

**App configuration:** `ios.supportsTablet` is `true` and `orientation` is `default` in `app.json`. Without `supportsTablet`, an iPad runs the app in iPhone compatibility mode. All four orientations are needed for rotation (R17) and for iPad multitasking. The iOS workflow checks both settings after `expo prebuild`.

**Limits:** VoiceOver order with open panels, keyboard focus, Stage Manager window sizes, and the iPadOS menu bar have not been checked on a device. iPadOS menu-bar commands are not implemented yet.

## T09. Calendar

**Decided:** October 8, 2026, at the user's direction, replacing the React Native month grid.

**Choice:** the native SwiftUI graphical `DatePicker` from `@expo/ui@58.0.14` in the right-hand panel, with the daily-note settings in the panel's toolbar; Today is a button in the note's navigation bar. A picked day opens or creates that day's note through the existing daily-note resolver.

**Trade-offs:** the native picker cannot mark days that have a note, and picking the already selected day sends no change, so Today is a separate button. The pure month-grid code (`src/features/calendar/month.ts`) and its tests remain for these labels and for a later marked-day view.

## T11. UI state and styling

**Decided:** October 8, 2026; styling revised at the user's direction.

**Choice:** UI state uses React state and context: a workspace provider holds the open vault, its settings, notes, bookmarks, search index, drafts, and the open note, and passes them to the sidebar, editor, and calendar. Asynchronous results stay keyed to the request that produced them. Editor text stays native. Chrome uses native components: `@expo/ui` SwiftUI views (`List` with the sidebar style, `Form`, `Section`, `Button`, `Menu`, `DatePicker`, `ContentUnavailableView`, `ProgressView`) inside `Host`, and native navigation bars and toolbars. Colors come from the system (`PlatformColor` and SwiftUI defaults), so light and dark follow the phone. The accent is Obsidian's purple, `#7F6DF2`.

**Alternatives:** `zustand@5.0.15` for shared state, not needed for one provider; `uniwind@1.12.2` or `react-native-unistyles@3.5.1`, not needed because native components style themselves.

**Validation:** type check, lint, production export, the iOS Release build, and the Simulator flows. Rerender measurements during typing and indexing need a profiler on a device and remain open.

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

## T12. End-to-end, native, and performance test tools

**Decided:** October 8, 2026, for U1-U8. The test runner for pure TypeScript is recorded in T12 (part) above.

**Choice:**

| Layer | Tool | Entry point |
| --- | --- | --- |
| Native unit and integration tests | Swift Testing through `swift test` on the Foundation-only vault core | `swift test --package-path modules/vault` (ios workflow) |
| App flows | Maestro CLI 2.11.0 against Release Simulator builds, with a 3-minute driver startup timeout and one restart of a driver that did not start | `scripts/ci/simulator-smoke.sh` with flows in `tests/e2e/` |
| Component and Router tests | Not adopted yet | Logic is kept in pure modules tested by Bun |
| Performance | Xcode Instruments on a device | Not run; no device is available |

**Alternatives:** Detox 20.51.4, which needs an instrumented test build and runner configuration; Maestro drives the unmodified Release app, its native editor view, and system UI. XCTest UI tests would need a test target in the generated Xcode project, which CNG regenerates (T13). `jest-expo` with React Native Testing Library remains the choice when component tests are added.

**Validation:** 69 Swift tests in 11 suites pass on M1; Maestro flows for typing, saving, search, styling, bookmarks, the calendar, and relaunch pass on iPhone and iPad Simulators (see [validation](validation.md)).

**Simulator settings:** before the app is installed, the smoke script turns off the Simulator keyboard's autocorrection, predictions, spell checking, and auto-capitalization. These are test-environment settings; the app's own text input settings are unchanged, so keyboard behavior with them on is part of device qualification.

**Limits:** the flows do not open the system folder picker; the Simulator tests register the vault through a simulator-only launch argument. Simulator timings do not qualify the performance targets.

## T13. Native generation and builds

**Decided:** October 8, 2026, for U1.

**Choice:** option A, Expo prebuild (CNG) with CocoaPods. The `ios` folder is not committed; the ios workflow runs `bunx expo prebuild --platform ios` and builds with `xcodebuild` (Release, generic iOS Simulator, `CODE_SIGNING_ALLOWED=NO`). Native configuration lives in `app.json` and the local module's podspec; no custom config plugin is needed yet. The workflow checks that `VaultModule` is autolinked and that the generated project targets iPhone and iPad with all orientations.

**Alternatives:** option B, SDK 58's experimental Swift Package Manager build path, not evaluated, because the CocoaPods path already builds every module the app uses. EAS Build was not used; it is billable and was not approved.

**Validation:** Release Simulator builds from a clean prebuild passed on M1 for every recorded commit in [validation](validation.md). CocoaPods comes from the runner image; the workflow prints its version.

**Limits:** no signed device build. The Release build step took 27 and 13 minutes in runs 37751267452 and 37752908876, after a prebuild of about 2 minutes.

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

**Extension (October 8, 2026, user request):** date patterns replaced the six fixed formats. `parseDatePattern` accepts Moment's `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`, and `WW` with separators, `T`, and bracketed text, and rejects any other run of letters (such as `DDDD`, `Do`, or `ww`) instead of printing it differently from Moment. `WW` is the ISO 8601 week, computed from the Thursday of the week; like Moment, `YYYY-[W]WW` pairs it with the calendar year. Date scripts (`<%* let x = moment(...) %>`) are parsed into definitions and computed with the same calendar arithmetic; still no date library and no JavaScript evaluation.

**Limits:** the time-zone test runs on Bun (JavaScriptCore). In the Release app on Hermes, today's note name and its `Created` line matched the runner's date in its time zone (UTC) on iPhone and iPad Simulators; other time zones and a time zone change while running are not checked on Hermes.

## Pending decisions

These need macOS with Xcode, the iOS Simulator, or physical devices. They are not decided.

| Option | Unit | Blocking need |
| --- | --- | --- |
| T04 iCloud qualification | U2, U8 | Disposable iCloud vaults on devices |
| T05 final editor qualification | U3 | Release-build input trials on device |
| T06, T07 device qualification | U4, U5 | Indexing, memory, and query latency on a device; scrolling and accessibility checks; FlashList comparison for the explorer |
| T08, T09 device qualification | U5, U7 | Side panels on iPhone and iPad, multitasking widths, keyboard focus, VoiceOver, and the iPadOS menu bar |
