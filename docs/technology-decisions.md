# Technology decisions

This file records technology choices required by KTD8, following the [technology options](technology-options-2026-10.md). Each entry gives the option ID, the choice, alternatives, sources, compatibility findings, validation evidence, and open limits. Choices that need macOS, Xcode, or devices are listed as pending.

## Native verification environment

The cloud workers that implement this plan run Linux and cannot run Xcode. The vault core's Swift tests run in the [ios workflow](../.github/workflows/ios.yml) on GitHub-hosted macOS runners, which are free for this public repository. Observed on October 8, 2026: image `macos-26-arm64` version 20260907.0351, macOS 26.6.2, Xcode 26.6 (17F113), Swift 6.3.3. The starter was originally verified with Xcode 27.0; the runner image did not offer a stable Xcode 27 at this date. Simulator builds and tests on this runner do not qualify physical-device input, performance, or iCloud behavior. Since the T05 revision, the app needs Xcode 27 and Swift tools 6.4, because its editor package requires them. The workflow's Simulator job stopped at its Xcode 27 check in run 37847969598 (`3614b80`) and run 37882059978 (`819f055`), and every ios run between them failed, so the job was removed on October 9, 2026. The workflow now runs only `swift test`, with the newest stable Xcode. The Simulator build and smoke test run on a Mac with Xcode 27 ([README](../README.md#native-tests-and-builds)), and EAS builds compile the app for devices. EAS builds of October 8, 2026 used the image `macos-tahoe-26.6-xcode-27.0` (Xcode 27.0, 27A266a).

## T01. Expo, React Native, and their runtime dependencies

**Decided:** October 8, 2026, for U1-U8, within KTD1.

**Choice:** the SDK 58 group from the default template, as resolved in `bun.lock`: `expo@58.0.6`, `react-native@0.88.0-rc.3`, `react@19.3.0`, `expo-router@58.0.16`, `expo-modules-core@58.0.14`, and Hermes (`hermes-compiler@260318099.0.4`). Packages use SDK-compatible ranges; `bunx expo install --check` passes in the `check` workflow. The runtime dependencies added since the template are `expo-sqlite@58.0.10` (T06), `react-native-drawer-layout@4.2.11` (T08), and `expo-updates@58.0.15` (T14). Updated on October 10, 2026, to the SDK 58 patch releases that `bunx expo install --check` asked for: `expo@58.0.7`, `react-native@0.88.0-rc.4`, `expo-router@58.0.17`, `@expo/ui@58.0.15`, `expo-dev-client@58.0.12`, `expo-splash-screen@58.0.7`, `expo-sqlite@58.0.11`, and `react-native-web@0.21.4`, which bring `expo-modules-core@58.0.15`. The SDK stays 58; no package was added or removed.

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

**Limits:** requalify with Xcode 27 when the runner offers it; since the T05 revision the app build requires it. Swift 6 language mode was not adopted for the vault module.

## T03. Native module authoring

**Decided:** October 8, 2026, for U1-U2.

**Choice:** option A, the established Expo Modules API (`Module`, `ModuleDefinition`, `AsyncFunction`) from `expo-modules-core@58.0.14`, in a local module at `modules/vault`. Autolinking finds it through the default `./modules` search path; no `package.json` is needed.

**Structure:** all file rules live in a Foundation-only core (`modules/vault/ios/Core`). The Expo binding (`VaultModule.swift`) only converts arguments and results. `modules/vault/Package.swift` builds the core alone, so `swift test` runs it on a Mac without a Simulator. The podspec compiles the same core sources into the app.

**Alternatives:** option B, the Expo Modules 2.0 Swift macros (`@JS`, `@ExpoModule`), which `expo-modules-core@58.0.14` ships. The options research describes them as a preview that does not cover native views. Because the binding is thin, moving the service functions to macros later changes only `VaultModule.swift`.

**Validation:** until October 9, 2026, the ios workflow's Simulator job confirmed that `VaultModule` appears in the generated `ExpoModulesProvider.swift` after `expo prebuild`; no CI job checks it now. Core tests pass with `swift test`. Simulator compile evidence is recorded in [validation](validation.md).

**Limits:** the folder picker has not run in CI; the Simulator tests register the fixture vault through a simulator-only launch argument. The editor view (T05) is not part of this decision.

Runtime evidence: on iPhone and iPad Simulators, JavaScript called the module's asynchronous functions and received the editor view's events in the Release app (see [validation](validation.md)).

## T04. Original-vault and iCloud document access

**Decided provisionally:** October 8, 2026, for U2. iCloud qualification remains open (U8).

**Choice:** an explicit `NSFileCoordinator` service rather than per-note `UIDocument`. Every read, exclusive create, and conditional save runs inside one coordinated access. A save rereads the file inside the coordinated write and replaces it only when the bytes still match the base revision. New files are staged in the system's item-replacement directory and moved into place with `renamex_np(RENAME_EXCL)`, so a create never replaces an existing file. A rename is a coordinated move (`.forMoving` on the old path, `.forReplacing` on the new one, with `item(at:willMoveTo:)` and `item(at:didMoveTo:)`) that also uses `renamex_np(RENAME_EXCL)`; only a change of case on a volume that ignores case, where both paths name the same file, renames without the exclusive flag. The editor's `rename` view function first saves pending edits and waits for the document's queue, and moves the file only when the document is clean or read-only. Folder access uses a security-scoped bookmark from the system folder picker, stored with a stable vault ID in app-private storage. A session keeps access until running operations finish.

**Alternatives:** per-note `UIDocument`, or a composition of a directory service with per-note documents. `UIDocument` supplies autosave and conflict-version handling, but its save path writes without exposing a compare-then-replace step inside the same coordinated write. The Persistence Protocol needs that step. A composition remains possible for the editor's document lifecycle in U3.

**Validation:** `swift test` on the macOS runner covers path containment (including dangling and relative symlinks), file states (readable, legacy cloud stub, absent, unlistable folder), exact-byte reads, exclusive create with 16 concurrent writers, conditional save conflicts, deleted and renamed targets, renames that never replace a file (including a change of case), failed writes, the draft journal, enumeration, the bookmark registry, and session release ordering.

**Limits and open work:**

- Not tested with real iCloud Drive. Modern iCloud placeholders are detected through `ubiquitousItemDownloadingStatus`, which cannot be produced on the CI runner; only the legacy `.name.icloud` stub is tested.
- File presenters and foreground reconciliation for open documents are not implemented yet; they belong with the editor sessions in U3.
- The folder picker and bookmark persistence on iOS need a manual or UI-test run in the Simulator.

## T05. Markdown source editor

**Decided provisionally:** October 8, 2026, for U3, and revised the same day at the user's direction: the editor now shows Obsidian-style live preview. Device input trials remain open.

**Choice:** `MarkdownTextView` from [LapermEditor](https://github.com/k-ymmt/LapermEditor) (product `LapermEditor`), pinned to commit `b905bc45dca55cd689f810e491e64b6b99b45e89` (September 29, 2026). It is a `UITextView` subclass on TextKit 2, hosted by the Expo native view `VaultEditorView`. With live preview on, it hides Markdown markers (heading `#`, emphasis, strikethrough and inline-code delimiters, link and image brackets, quote `>`) on every line except the lines that the caret or selection touches. While the keyboard is down, it hides them on every line. It draws front matter as a key/value table and GFM tables as grids while the caret is outside them. It hides markers with a near-zero font in a display paragraph and with text-storage attributes, never by changing characters, and it defers styling while the keyboard composes text. Its parser is `swift-markdown` 0.8 (a dependency of the package).

**Integration:** `VaultEditorView` keeps the document session, draft journal, saves, newline convention, background flush, and foreground reconcile. It sets live preview on, line numbers off, readable margins, and pair completion off, so typing never adds characters such as a closing backtick. List continuation, task toggling, list indentation, and URL paste over a selection stay on. The view's theme uses the system body font at the user's Dynamic Type size (rebuilt when the size changes), bold headings, and monospaced code; colors come from Laperm's default theme. A note opens at its top without the keyboard (changed October 9, 2026, at the user's request; it used to take focus, and UIKit's caret at the end of the set text scrolled to the bottom). The caret waits on the line after the front matter, found with Laperm's `FrontMatterParser`, until a tap places it. The view forwards `textView(_:editMenuForTextIn:suggestedActions:)` so the edit menu offers "Open Link" on a link. The earlier display-only styler (`MarkdownStyler.swift`, `MarkdownStyle.swift`) and its tests were removed, because Laperm owns the content-storage delegate.

**Wikilinks:** each complete note listing (`listNotes`) also builds a native name index (`modules/vault/ios/Core/WikiLinkTargets.swift`), so the editor resolves links without a call to JavaScript. A target without "/" matches a note name; a target with "/" matches a vault path or its end. Matching ignores case, Unicode normalization, surrounding spaces, and a trailing `.md`. When names repeat, a note in the linking note's folder wins, then the shortest path, then sorted order (this rule is the app's own; Obsidian's rule for repeated names was not checked). Links to missing notes take Laperm's unresolved color. A tap on a rendered link opens the note; with no match, JavaScript creates the note exclusively beside the open note (or at the link's vault path) and opens it, as for new notes (R9). `[[note#heading]]` puts the caret on the first heading with that text, ignoring case. Front matter `aliases` and links to non-Markdown files are not supported yet.

**Link completion:** typing `[[` opens a native popup near the caret (`WikiLinkCompletionView.swift`), styled after hellonotes' list: up to six notes with their folders, below the caret's line or above it when the keyboard leaves more room there. `WikiLinkCompletion.swift` finds the target being typed and the range a choice replaces (a new link, the rest of an existing link and its `]]`, or the target before an alias or heading). `WikiLinkTargets.suggestions` ranks the listing's notes: an exact name, a name prefix, a word prefix, a substring, then the query's characters in order, ignoring case and accents; ties prefer the linking note's folder, then recently modified notes. An empty query lists recent notes, a query with "/" matches paths, and a shared name inserts a path when the name alone would open another note. `[[#` lists the open note's headings. A tap, Return, or Tab inserts the link as one undo step; with a hardware keyboard, the arrow keys move the highlight and Escape closes the popup. The popup does not open during keyboard composition. Headings of other notes (`[[note#`) are not offered, because that needs a read of the other note.

**Save state:** the note title in the navigation bar ends with an asterisk (`*`) while edits wait for a save: from the first edit, through saving and failed saves, until a coordinated save completes. Opening a note, or a completed save, shows the title without it. The routine states have no text. A line above the note appears only when a save goes wrong or the note is read-only or unavailable, with Retry where it can help. The user chose this on October 9, 2026, in place of a status line that always showed "No unsaved changes", "Unsaved", "Saving…", or "Saved locally". UI tests read the state from the text view's accessibility identifier (`note-status:<status>`, for example `note-status:saved`), which VoiceOver does not speak. How VoiceOver reads the asterisk has not been checked.

**Packaging:** `modules/vault/ios/Vault.podspec` declares the package with React Native's `spm_dependency` helper (`react-native/scripts/react_native_pods.rb`), which adds it to the pod during `pod install`. The requirement is the exact revision, so an upstream change cannot reach a build unannounced. The package requires Swift tools 6.4 (Xcode 27) and iOS 27, so `app.json` sets `ios.deploymentTarget` to `27.0` and the podspec targets iOS 27.0.

**License:** the upstream repository has no LICENSE file at the pinned commit. On October 8, 2026, the user reported that the author approved use and will add the MIT license. This repository references the package by URL and commit and contains none of its code. When the license file is published, move the pin to that commit.

**Alternatives** (researched October 8, 2026, from source code; none was built):

| Option | Why not chosen |
| --- | --- |
| The local display-only styler (previous choice) | Markers stayed visible; live preview would need the same hiding, caret-reveal, and table work that Laperm already has. |
| `hellotham/hellonotes` `Packages/NotesEditor` (MIT) | Caret-line reveal on TextKit 2, but it is part of a whole app, has no marked-text guard, and its app reads every note to rebuild its link graph. Its wikilink completion remains a reference for later work. |
| `v57/Markdown`, `nodes-app/swift-markdown-engine` | No license file, or macOS only (AppKit). |
| `@expensify/react-native-live-markdown@0.1.343` | Markers can change color but cannot hide; its parser receives no selection; its compatibility notes stop at React Native 0.86. |
| Enriched Markdown 1.1.1 | Rich-text editing with Markdown output; it normalizes source, so lossless editing is not established. |
| CodeMirror 6 through Expo DOM with a live-preview extension | Obsidian's own approach on iOS (a web view); a separate web runtime with an asynchronous bridge, and native input and draft ownership would need proof. |

**Validation:** on L1, `bun run check` and the production export pass, and `expo prebuild --platform ios --no-install` writes `ios.deploymentTarget` `27.0` to `Podfile.properties.json` and the app target. EAS preview build `6c41494c-9896-41ff-9657-81e73206c430` (`3614b80`, Xcode 27.0) archived the app for devices with the package resolved at the pinned commit, and copied Laperm's resource bundle into the app. The GitHub Simulator job cannot build it until its runner image offers Xcode 27. Details are in [validation](validation.md).

**Limits:** image previews have no base folder; the Simulator flows have not run with this editor; VoiceOver, IME, dictation, hardware keyboard, undo, and long notes (4 KiB, 100 KiB, 1 MiB) are unverified on a device; the package has one author and no releases.

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

**Sorting** (added October 9, 2026, at the user's request): a sort button at the right of the Files header opens a native menu with Obsidian's six orders in three groups: file name (A to Z, Z to A), modified time (new to old, old to new), and created time (new to old, old to new). The current order has a checkmark, so a change takes two taps. Folders always come before notes. Name orders sort folders and notes in the chosen direction; time orders sort notes by that time, with notes that have no time last and equal times by name, and keep folders A to Z. The choice is saved per vault in the app-data store (`vault:<id>:file-sort`). Modified and created times come from the vault scan (`contentModificationDateKey`, `creationDateKey`). A file's creation date is what the device's file system reports: for a note copied or downloaded to this device, for example by iCloud, it can be the copy's date rather than the note's first creation elsewhere.

**Limits:** scrolling a 10,000-note tree, Dynamic Type, and VoiceOver have not been checked on a device.

## T08. Navigation shell

**Decided:** October 8, 2026, at the user's direction, in two steps. The user first asked for native sidebars and menus with Liquid Glass, a theme that follows the phone, and an Obsidian-like layout: files on the left, calendar on the right. After trying the first native version on a phone, the user asked for side panels that slide over the note in both directions, as in Obsidian, with one header and no stack of routes between the files and the note.

**Choice:** the note is one native `Stack` screen with one navigation bar. Two side panels from `react-native-drawer-layout@4.2.11` (the drawer that Expo Router's own drawer uses; Reanimated and Gesture Handler run its gestures on the UI thread) hold the files on the left and the calendar on the right. On a phone, each panel slides over the note from its edge with a swipe or a toolbar button and closes with a swipe, a tap outside, or a choice. A panel closes the keyboard when it opens, by a swipe, a button, or the menu bar. The vault module's `dismissKeyboard` resigns the first responder, because the drawer's own keyboard handling calls React Native's `Keyboard.dismiss()`, which reaches only React Native text inputs and not the native editor. At 768 points and wider, the files panel is pinned beside the note by default and the calendar can be pinned on the right. Panel contents are native SwiftUI views from `@expo/ui` on a Liquid Glass background (`expo-glass-effect` `GlassView`); in dark mode the glass is tinted with the dark grouped background (`#1C1C1E` at 82% opacity), because plain glass let too much of the note through. The navigation bar has the files button and Today on the left and a "More" menu (bookmark, rename, settings, vault) and then Calendar on the right, as native `Stack.Toolbar` items. A bottom toolbar (October 10, 2026, at the user's request) has Back and Forward on the left and Search and New Note on the right, as `Stack.Toolbar placement="bottom"` items. The user asked for a bar like Safari's and Obsidian's, not a tab bar: it slides away while the user scrolls toward the end of the note and comes back when they scroll back or reach the top. The editor decides this natively, from scrolls that the user drives: 24 points or dp of travel in one direction moves the toolbar, the top always shows it, and the bounce past the end and scrolls that follow the caret are ignored. On iOS, Expo Router puts the items in the navigation controller's `UIToolbar`, where a flexible space splits them into two Liquid Glass groups at the edges; `VaultEditorView.swift` hides and shows that toolbar with `setToolbarHidden(_:animated:)` when the screen passes `hidesToolbarOnScroll`, so no event goes through JavaScript. It shows only a toolbar that it hid, again when a note opens or the editor is removed. On Android, Expo Router draws the items as a Material 3 floating toolbar in Jetpack Compose (`HorizontalFloatingToolbar` from `@expo/ui`). It has no flexible space, so a 48 dp space separates the two pairs. The Kotlin editor sends `onToolbarHiddenChange`, and the screen moves the toolbar's layer below the screen's edge with a native-driver `Animated` translation. The toolbar floats 16 dp above the system's navigation bar, it stays behind the keyboard (`disableImePadding`), and the editor's `bottomInset` prop lets the end of the text scroll above it. On iOS, the navigation bar is see-through (changed October 10, 2026, at the user's request): the screen sets `headerTransparent`, so the note scrolls under the bar, and `VaultEditorView` sets its text view's top scroll edge effect to the soft style, which blurs the text under the bar and fades out below it. React Native Screens' `scrollEdgeEffects` option does not reach the editor: it is applied when the option changes or when the screen is attached, before the editor mounts. With the automatic style that the text view kept, the Simulator drew a hard edge with a line under the native title and left the text under the custom rename title sharp. The editor's `UITextView` keeps UIKit's automatic content inset, so its first line starts below the bar. A save or load notice above the text is padded by the header height, and the SwiftUI status views stay inside the safe area. Android has no Liquid Glass, and a see-through bar without a blur would put the text behind the title and buttons. So the Android app bar follows Material 3's top app bar instead: it has no shadow and the page's background color while the note is at its top, and it takes the palette's surface color while the note is scrolled. The Kotlin editor sends `onScrolledChange` when its `ScrollView` leaves or returns to the top; the iOS editor does not send it.

**Alternatives:** Expo Router's `SplitView` (a native `UISplitViewController`, the first native version): on iPhone it collapses into a navigation stack with a second bar and a back button, which the user rejected; `@expo/ui` `NavigationSplitView`, which collapses the same way and has no right-hand column; Expo Router's drawer navigator, which would add drawer routes and headers that the controlled panels do not need. For the bottom toolbar: a tab bar, which the user rejected; `UINavigationController.hidesBarsOnSwipe`, which also hides the navigation bar with the title, files, and calendar, and reacts to any swipe rather than to the note's scrolling; and a toolbar drawn with React Native views on Android, which would not match the app bar that Expo Router already draws with Compose.

**App configuration:** `ios.supportsTablet` is `true` and `orientation` is `default` in `app.json`. Without `supportsTablet`, an iPad runs the app in iPhone compatibility mode. All four orientations are needed for rotation (R17) and for iPad multitasking. The ios workflow's Simulator job checked both settings after `expo prebuild` until it was removed on October 9, 2026; no CI job checks them now.

**Menu bar:** on iPadOS 26, `UIMainMenuSystem` adds the app's commands to the system menu bar (`modules/vault/ios/MainMenu.swift`): New Note (⌘N) and Note Settings (⌘,) in File, Files (⌃⌘S) and Calendar (⌥⌘I) in View, and a Go menu with Back (⌘[), Forward (⌘]), Today's Note (⌘T), and Search Notes (⇧⌘F). Back and Forward were added on October 10, 2026, with the note history. The commands are implemented on `UIApplication`, which is always in the responder chain, and reach JavaScript as module events that run the same actions as the toolbar.

**Limits:** closing the keyboard when a panel opens has not run on a Simulator or a device. The see-through navigation bar has been seen only in the iOS 27.0 Simulator on an iPhone; it has not been seen on an iPad or a device. While the keyboard is up it covers the bottom toolbar, so Back, Forward, Search, and New Note need the keyboard closed first, as in Safari. VoiceOver order with open panels, keyboard focus, Stage Manager window sizes, and the menu bar and its shortcuts have not been checked on a device; the Simulator tests do not open the menu bar.

## T09. Calendar

**Decided:** October 8, 2026, at the user's direction, replacing the React Native month grid.

**Choice:** the native SwiftUI graphical `DatePicker` from `@expo/ui@58.0.14` in the right-hand panel, with the note settings in the panel's toolbar; Today is a button in the note's navigation bar. A picked day opens or creates that day's note through the existing daily-note resolver.

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
| App flows | Maestro CLI 2.11.0 against Release Simulator builds, with a 3-minute driver startup timeout and one restart of a driver that did not start | `scripts/ci/simulator-smoke.sh` with flows in `tests/e2e/`, on a Mac with Xcode 27 (no CI job since October 9, 2026) |
| Component and Router tests | Not adopted yet | Logic is kept in pure modules tested by Bun |
| Performance | Xcode Instruments on a device | Not run; no device is available |

**Alternatives:** Detox 20.51.4, which needs an instrumented test build and runner configuration; Maestro drives the unmodified Release app, its native editor view, and system UI. XCTest UI tests would need a test target in the generated Xcode project, which CNG regenerates (T13). `jest-expo` with React Native Testing Library remains the choice when component tests are added.

**Validation:** 69 Swift tests in 11 suites pass on M1; Maestro flows for typing, saving, search, styling, bookmarks, the calendar, and relaunch pass on iPhone and iPad Simulators (see [validation](validation.md)).

**Simulator settings:** before the app is installed, the smoke script turns off the Simulator keyboard's autocorrection, predictions, spell checking, and auto-capitalization. These are test-environment settings; the app's own text input settings are unchanged, so keyboard behavior with them on is part of device qualification.

**Limits:** the flows do not open the system folder picker; the Simulator tests register the vault through a simulator-only launch argument. Simulator timings do not qualify the performance targets.

## T13. Native generation and builds

**Decided:** October 8, 2026, for U1.

**Choice:** option A, Expo prebuild (CNG) with CocoaPods. The `ios` folder is not committed; `bunx expo prebuild --platform ios` generates it, and `xcodebuild` builds it (Release, generic iOS Simulator, `CODE_SIGNING_ALLOWED=NO`; commands in the [README](../README.md#native-tests-and-builds)). Native configuration lives in `app.json` and the local module's podspec; no custom config plugin is needed yet. Until October 9, 2026, the ios workflow ran these steps and checked that `VaultModule` is autolinked and that the generated project targets iPhone and iPad with all orientations.

**Alternatives:** option B, SDK 58's experimental Swift Package Manager build path, not evaluated, because the CocoaPods path already builds every module the app uses. CI does not use EAS Build. On October 8, 2026, the user asked for iPhone development and preview builds; T14 records that setup.

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

## T14. Device builds, app variants, and over-the-air updates

**Decided:** October 8, 2026, at the user's request: a development build and a preview build on an iPhone, with over-the-air updates.

**Choice:**

- EAS Build with internal (ad hoc) distribution for the `development` and `preview` profiles in `eas.json`. A `production` profile is defined for later store builds. Builds use Bun 1.3.14 from `packageManager` and the image that EAS selects for SDK 58. On October 8, 2026, that image was `macos-tahoe-26.6-xcode-27.0`, with Node 22.23.2. This is in the `^22.13.0` engine range of `expo` and `react-native`.
- EAS Update through `expo-updates@58.0.15`, the version in SDK 58's `bundledNativeModules.json`. The preview build reads the `preview` channel. The development build loads any update from the dev client's Extensions tab. The runtime version uses the `fingerprint` policy, so an update reaches only builds with the same native code and app config.
- App variants in `app.config.ts`, applied on top of `app.json`. `APP_VARIANT=development` or `preview` adds `.dev` or `.preview` to the bundle identifier, `Dev` or `Preview` to the name, and `-dev` or `-preview` to the URL scheme. Without `APP_VARIANT`, the config is the release app, so CI and `bun run ios` are unchanged. The development variant has its own icon (T15). Only the preview variant leaves out the dev client's `exp+obsidian-expo` scheme, so QR codes from `expo start` open the development build.
- The update URL comes from `extra.eas.projectId` in `app.json`. `app.json` stays static so that `eas init` can write the project ID there. Until it does, prebuild sets `EXUpdatesEnabled` to false.

**Alternatives:**

| Option | Why not chosen |
| --- | --- |
| Local builds on a Mac (`expo run:ios --device`) | No hosted install link and no update channel; every install needs the Mac. They remain available for local work. |
| Runtime version policy `appVersion` | Simpler, and the same for every variant, but an update can reach a build with different native code unless someone changes the version by hand. |
| One bundle identifier for every build | The preview build would replace the development build on the phone. |

**Compatibility:** with the `fingerprint` policy, the app config is part of the runtime version. So `eas update` must run with the same `APP_VARIANT` as the build; `bun run update:preview` sets it.

**Validation (L1):** `expo config` resolves the three variants. `expo prebuild --platform ios --no-install` with `APP_VARIANT=development` generated the bundle identifier `com.ramimaalouf.obsidianexpo.dev`, the display name `obsidian-expo Dev`, `ASSETCATALOG_COMPILER_APPICON_NAME = app-dev` with the `.icon` folder copied into the project, the schemes `obsidianexpo-dev` and `exp+obsidian-expo`, and an `Expo.plist` with `EXUpdatesRuntimeVersion` set to `file:fingerprint` and `EXUpdatesEnabled` set to false. Without `APP_VARIANT`, prebuild generated the release identifier and the `app` icon. `tests/unit/app-config.test.ts` covers the variants and the update URL.

**Limits:** no EAS build, device installation, or update delivery has run. The L1 egress policy blocks `api.expo.dev`, so EAS CLI commands run on a contributor's computer. Ad hoc builds install only on devices registered with `eas device:create`, and iOS requires Developer Mode for them.

## T15. App icon

**Decided:** October 8, 2026, at the user's request: an icon that resembles Obsidian in a Liquid Glass style, and a different version for the development build.

**Choice:** a faceted glass shard (obsidian is volcanic glass). The release icon is violet; the development icon is the same shard in amber. One committed script, `scripts/generate-icons.ts` (`bun run icons`), draws the shard and writes every icon file:

- Icon Composer bundles for `ios.icon`: `assets/icons/app.icon` and `assets/icons/app-dev.icon`. Each has six flat facet layers in one translucent group on an automatic gradient fill. iOS 26 adds the Liquid Glass lighting. Expo copies the folder into the native project (SDK 54 and later), and Xcode compiles it.
- Flattened PNGs with a drawn glass look for the top-level `icon`, the splash image, the web favicon, and the Android adaptive icon layers. They are rendered with `@resvg/resvg-js@2.6.2`, a development dependency (the newest release on October 8, 2026).

**Alternatives:** `sharp@0.35.5`, a larger native dependency for one rendering task; a headless browser screenshot, which needs a browser that is not a project dependency; drawing the bundle in Apple's Icon Composer, which runs only on macOS and cannot be regenerated from this repository.

**Validation:** `tests/unit/app-config.test.ts` regenerates the icons in a temporary folder, compares the bundles byte for byte, checks that every layer exists, and checks the PNG sizes. The flattened PNGs were inspected visually on L1.

**Limits:** the script writes the `icon.json` files, not Icon Composer. They use only keys that the SDK 58 template's icon used. No Xcode has compiled them yet; a Release Simulator build compiles `app.icon` for the release variant, and `app-dev.icon` compiles only in a development build. The Liquid Glass rendering on iOS 26 has not been seen.

## T16. Android

**Decided:** October 9, 2026, at the user's request to build the app for Android as well, with the design left to the executor.

**Approach:** one JavaScript app for both platforms. The local module `modules/vault` has the same name (`Vault`), functions, results, and editor view on Android as on iOS, so the workspace, daily notes, templates, search, bookmarks, and drafts code is shared unchanged. Only screens whose iOS version uses SwiftUI have an `.android.tsx` version. A unit test fails when an `.ios` file has no Android counterpart.

| Layer | iOS | Android |
| --- | --- | --- |
| Native module | Swift, Expo Modules API | Kotlin, Expo Modules API from `expo-modules-core@58.0.14` (`modules/vault/android`). Vault calls run in order on their own threads (`vault.files`, and `vault.listing` for the vault scan) through `runOnQueue(CoroutineScope)`, not on Expo's shared module queue |
| Core and its tests | Foundation-only Swift core; `swift test` | Plain Kotlin core with no Android imports (`android/src/main/java/expo/modules/vault/core`), ported from the Swift core with its tests; `gradle test` through a standalone Kotlin JVM build (`modules/vault/android/core-tests`, Kotlin 2.2.0 as in React Native 0.88, Gradle 8.14.3 wrapper) |
| Vault access | Security-scoped bookmark, `NSFileCoordinator` | Storage access framework: the system folder picker (`ACTION_OPEN_DOCUMENT_TREE`, starting in Documents), a persisted permission for that folder only, and `DocumentsContract` queries, one per folder |
| Saves and creates | Coordinated reread, compare, and replace; `renamex_np(RENAME_EXCL)` | Reread and compare under a lock in the process, write in place (`"wt"`), sync, and read the bytes back. A create uses the provider's create and keeps the file only when it has exactly the wanted name |
| Renaming a note | Coordinated move with `renamex_np(RENAME_EXCL)`; a change of case alone renames in place | `DocumentsContract.renameDocument` within the note's folder, after a listing shows the name free. A result with another name gets the old name back. A change of case alone goes through a temporary name |
| Drafts, app data, vault list | App support folder | `filesDir/vault`: synced temporary file, rename, then a folder `fsync` (`android.system.Os`) |
| Editor | LapermEditor (TextKit 2) with live preview | The platform `EditText` in a `ScrollView`, with restrained source styling as spans (`MarkdownStyles.kt`), the same `[[` completion ranking, and wikilinks that open on a tap while the keyboard is down |
| Screens | SwiftUI from `@expo/ui` | React Native core components with small Material-style pieces (`src/features/workspace/android-ui.tsx`), Material Symbols from the font that `expo-symbols` installs, and an Obsidian light and dark palette |
| App bar and bottom toolbar | `Stack.Toolbar` with SF Symbols; the bottom toolbar is the navigation controller's `UIToolbar` | `Stack.Toolbar`, which Expo Router draws with Jetpack Compose on Android (the bottom toolbar is a Material 3 floating toolbar), with vector drawables generated from the Material Symbols font by `scripts/generate-android-icons.ts` |
| Calendar | SwiftUI graphical `DatePicker` | A month grid from `src/features/calendar/month.ts`; days with a note have a dot |
| Side panels, search index | `react-native-drawer-layout`, `expo-sqlite` FTS5 | The same; the index opener is shared (`open-index.native.ts`) |
| Device builds | EAS, ad hoc | EAS profiles `development` and `preview` build APKs (`android.buildType: apk`) for direct installation |

**Alternatives:**

| Option | Why not chosen |
| --- | --- |
| All-files access (`MANAGE_EXTERNAL_STORAGE`) with `java.io` | Exclusive create and atomic rename would be available, but the app would ask for access to all shared files instead of one folder, and Google Play restricts this permission to a few kinds of apps. |
| `androidx.documentfile` | Its tree documents ask the provider once per property of each file, so listing a 10,000-note vault would make tens of thousands of queries. `DocumentsContract` returns one folder's names, sizes, and times in one query. |
| `expo-file-system`'s storage access framework API | A general file API: a save would compare and write in separate bridge calls, so another write could land between them. This is the same reason as for iOS (T04). |
| Jetpack Compose screens through `@expo/ui/jetpack-compose` | The Material 3 counterpart of the iOS SwiftUI screens. Not chosen for the screens because no Android device or emulator was available in the authoring environment to check Compose layout inside React Native views; core components behave predictably. The app bar still uses Compose through Expo Router. Revisit after a device review. |
| A WebView editor (CodeMirror 6) | As for iOS (T05): a separate web runtime and an asynchronous bridge between the text and its drafts. |
| Kotlin Multiplatform for one core on both platforms | It would replace the tested Swift core and add a build system to the iOS app. Here, the Kotlin core is a port, and its tests are ports of the Swift tests. |

**Validation:** the Kotlin core's 64 tests pass on L2 and on A1; the Release app compiles for x86_64 on A1 with the module autolinked; see [validation](validation.md#android-october-9-2026). On an Android 15 emulator, the Release app picked the fixture vault with the system folder picker, created today's note from the vault's template, saved typed text, reopened today after a relaunch, and searched, with every other fixture file byte-identical (run 37902235503).

**Limits:**

- Android has no file coordination between apps. A write by another app in the instant between the comparison and the write is not detected. Writes are in place, not atomic: an interrupted write can leave a partial file. The journal keeps the draft until a save reads back correctly, and the next open then offers recovery.
- Only folders on this device were considered. Cloud document providers, virtual documents, and providers that write through pipes have not been tried.
- The editor has no live preview. A lone carriage return shows as a space. Composing text is saved as shown. The editor keeps its text in the `EditText`, and notes of 100 KiB and 1 MiB have not been tried on a device.
- Swiping from the screen's left edge is Android's back gesture with gesture navigation; the files panel also opens from the app bar.
- The documents that the folder picker serves report no creation time and no stable identity across a rename, so "Created time" sorting keeps name order and bookmarks do not follow notes that another app renamed.
- There are no hardware-keyboard shortcuts for app commands (the iPadOS menu bar has no Android counterpart yet).

## T17. Editing toolbar

**Decided:** October 10, 2026, at the user's request for a toolbar above the keyboard like Obsidian's, built on LapermEditor's commands on iOS and in the platform's own way on Android.

**Choice:** a native toolbar on each platform, owned by the vault module's editor view. JavaScript takes no part, so no button press sends note text across the bridge (KTD3). The buttons, in order: Undo, Redo, Outdent, Indent, Task, Link, Tag, Bold, Italic, and Hide Keyboard. The row scrolls sideways when it is wider than the screen.

| Part | iOS | Android |
| --- | --- | --- |
| Placement | The text view's `inputAccessoryView`. UIKit attaches it to the keyboard, and Laperm adds its height to the text's bottom inset. | A row at the bottom of the editor that sits on the keyboard, placed with the window insets that the editor already reads (`WindowInsetsCompat.Type.ime()`). It shows while the text has focus. |
| View | A SwiftUI row in a `UIHostingController` sized by its content, as in Laperm's own `keyboardAccessory`; SF Symbols in glass capsules | A `HorizontalScrollView` of `ImageButton`s; Material Symbols vector drawables written by `scripts/generate-android-icons.ts` |
| Undo, Redo | The text view's `undoManager`. The buttons dim when there is nothing to undo or redo. | The `EditText`'s own undo (`android.R.id.undo` and `android.R.id.redo`, API 23). Android has no public "can undo" query, so the buttons stay enabled. |
| Indent, Outdent, Bold, Italic | Laperm: `EditingAssistant.indent` and `outdent`, and `MarkdownTextView.toggleEmphasis`, each applied as one undo step | `EditorCommands.kt` in the Kotlin core |
| Task, Link, Tag | `EditorCommands.swift` in the Swift core | `EditorCommands.kt` in the Kotlin core |

**Command rules:**

- **Indent and Outdent** change list lines only (`-`, `*`, `+`, `1.`, `1)`), in the selection or on the caret's line. Indent adds four spaces. Outdent removes up to four leading spaces. A plain line does not change.
- **Task** works on each line in the selection or the caret's line: a plain line becomes `- [ ] line`, a list item gets `[ ] ` after its marker, `[ ]` becomes `[x]`, and `[x]` or `[X]` becomes `[ ]`. An empty line becomes `- [ ] `. Blank lines in a selection of several lines do not change.
- **Link** inserts `[[]]` with the caret between the brackets, so the link suggestions open. A selection on one line becomes `[[selection]]`, with the caret before `]]`.
- **Tag** inserts `#` at the caret or before the selection, with a space before it when the character before is not a space, a tab, or a line break.
- **Bold and Italic** add or remove `**` and `*` around the selection, or around the word at the caret. With no word, they insert an empty pair with the caret between, and a second press removes it. Underscore markers are removed too. Nothing happens in a code span, across a blank line, or when the selection holds markers of separate spans.

**Shared cases:** `modules/vault/spec/editor-commands.txt` lists each command's text and selection before and after. The Swift and Kotlin core tests both read it. The Indent, Outdent, Bold, and Italic cases describe Laperm's behavior at the pinned commit, taken from its own tests, and run only in the Kotlin tests: Laperm is not part of the Swift core package, because it needs Xcode 27. The Kotlin code is written from these cases, not translated from Laperm's source, which has no license file yet (T05).

**Alternatives:**

| Option | Why not chosen |
| --- | --- |
| CodeMirror 6 in an Expo DOM component, one editor for both platforms | It has undo, redo, and indent commands (`@codemirror/commands@6.11.1`), but it brings back the web runtime and the asynchronous bridge between the text and its drafts that T05 and T16 rejected. Live preview would have to be built again. |
| `@expensify/react-native-live-markdown`, Enriched Markdown | One editor for both platforms, but without hidden markers, or with Markdown rewritten (T05) |
| `react-native-keyboard-controller@1.22.4` `KeyboardStickyView` (the version SDK 58 lists) | One toolbar in TypeScript. UIKit would not attach it to the keyboard, and Laperm's inset counts only an `inputAccessoryView`, so the bar would cover the last lines. Its `KeyboardToolbar` is a form bar with Previous, Next, and Done. |
| `UITextInputAssistantItem` (the shortcuts bar) | iPad only; iPhone ignores its items ([Apple](https://developer.apple.com/documentation/uikit/uitextinputassistantitem)) |
| SwiftUI `.toolbar(placement: .keyboard)` | It does not attach to a UIKit text view, as Laperm's own notes say |
| An undo history of the app's own on Android | Not needed while the `EditText`'s undo passes the emulator test |

**Validation:** recorded in [validation](validation.md#editing-toolbar-october-10-2026).

**Limits:**

- The iOS toolbar compiles only with Xcode 27, on a Mac or in an EAS build; no CI job builds it.
- On an iPad, UIKit also shows its shortcuts bar, which has its own Undo and Redo; the two rows have not been seen together.
- Lists indented with tabs do not outdent, because Laperm removes spaces only. Android follows the same rule, so the two platforms agree.
- The buttons are fixed; there is no setting to choose them yet. Tag does not suggest existing tags.
- VoiceOver, TalkBack, hardware keyboards, and Dynamic Type sizes have not been checked with the toolbar.

## Pending decisions

These need macOS with Xcode, the iOS Simulator, Android devices, or physical devices. They are not decided.

| Option | Unit | Blocking need |
| --- | --- | --- |
| T04 iCloud qualification | U2, U8 | Disposable iCloud vaults on devices |
| T05 final editor qualification | U3 | Release-build input trials on device |
| T06, T07 device qualification | U4, U5 | Indexing, memory, and query latency on a device; scrolling and accessibility checks; FlashList comparison for the explorer |
| T08, T09 device qualification | U5, U7 | Side panels on iPhone and iPad, multitasking widths, keyboard focus, VoiceOver, and the iPadOS menu bar and shortcuts |
| T16 device qualification | U2-U8 | Android phones and tablets: input methods, TalkBack, folder providers other than local storage, long notes, and performance |
| T17 device qualification | U3 | The iOS toolbar on an iPhone and an iPad (with and without a hardware keyboard), VoiceOver and TalkBack, and Dynamic Type |
