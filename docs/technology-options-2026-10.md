# obsidian-expo: technology options for October 2026

**Checked:** October 8, 2026. **Decision owner:** the implementing agent. **Applies to:** the [implementation plan](plans/2026-10-08-0149-feat-native-vault-notes-plan.md).

Use the newest maintained, compatible technology that best satisfies the app's requirements. This is a research snapshot, not an installed dependency list or evidence of measured app performance. It covers releases available on the check date, not releases expected later in October. Recheck before implementation.

The user selected Expo and Bun. Original Markdown files, iCloud folder access, source preservation, native input behavior, and the limited template grammar remain requirements. Other technology choices below belong to the executor. Prefer correctness, responsiveness, simplicity, accessibility, and long-term maintenance; implementation effort is not the deciding factor. A higher version number alone is insufficient evidence.

## Repository scope

This dated research was transferred from the planning project. The user has already selected SDK 58 and iOS (iPhone/iPad) for obsidian-expo. SDK 57 and web alternatives remain comparison material, not permission to downgrade or implement additional platforms. Reuse the existing verified starter and its lockfile. Recheck candidates before adoption; this transfer does not newly verify the release claims below.

## How the executor makes decisions

1. Before each dependent implementation unit, inspect current official documentation, release notes, package metadata, deprecations, and the chosen Expo SDK's compatibility guidance. Use SDK-versioned documentation when available.
2. Compare the relevant options below. A preview is eligible for an isolated experiment; adopting it requires evidence that its needed APIs and dependencies satisfy the product contract. Do not install both alternatives into the shipping app merely because both are documented.
3. Resolve routine choices without asking the user to pick libraries. Run the smallest experiment that addresses a real uncertainty, using disposable notes. Change a product requirement only through an explicit plan revision.
4. Record the choice in `docs/technology-decisions.md` before building dependent features. Include option ID, chosen version, alternatives, dated primary sources, compatibility findings, validation evidence, and any unresolved limitation. Create this file when decisions are made; this research document does not preselect winners.
5. Commit the compatible dependency graph and `bun.lock`. Run `bunx expo install --check` and `bunx expo-doctor`, then the relevant native build and tests. Revalidate affected choices when changing SDK or a native dependency.

The [registry snapshot](references/technology-versions-2026-10-08.json) preserves the queried versions, distribution tags, declared peers, and template dependencies. Registry `latest` means the publisher's current default tag, not proof of compatibility. Candidate-only and rejected package names in that snapshot are not dependencies to install. Apply the same decision process to any additional package introduced later.

## T01. Expo, React Native, and their runtime dependencies

Treat these as a compatible group. Both template groups are documented for comparison; this repository uses the user-requested SDK 58 group and still needs feature-specific native validation.

| Component | Stable SDK 57 template | SDK 58 beta template |
| --- | --- | --- |
| Template | `expo-template-default@57.0.29` | `expo-template-default@58.0.15` |
| Expo | `57.0.27` | `58.0.6`, currently tagged `next` |
| React Native | `0.86.3` | `0.88.0-rc.3` |
| React | `19.2.3` | `19.3.0` |
| Expo Router | `~57.0.25` | `~58.0.16` |
| `@expo/ui` | `~57.0.22` | `~58.0.14` |
| Reanimated / Worklets | `4.5.1` / `0.10.1` | `4.7.0` / `0.13.0` |
| Gesture Handler | `~2.32.0` | `~3.2.1` |
| Screens / Safe Area Context | `~4.26.0` / `~5.7.0` | `~4.28.0` / `~5.9.1` |

These are template constraints, not a final lockfile. [Stable template metadata](https://registry.npmjs.org/expo-template-default/57.0.29), [beta template metadata](https://registry.npmjs.org/expo-template-default/58.0.15).

SDK 57 is the current stable release. SDK 58 is beta and introduces runtime/native-build changes that warrant a separate compatibility experiment. Native editor dependencies must be checked against its RN release candidate. Both are documented for context; SDK 58 remains the selected baseline in this repository. [SDK 57 release](https://expo.dev/changelog/sdk-57), [SDK 58 beta release](https://expo.dev/changelog/sdk-58-beta).

Standalone React Native `0.87.1`, React `19.3.0`, Reanimated `4.7.1`, Worklets `0.13.0`, and Gesture Handler `3.3.0` are newer than some stable-template entries. Do not substitute them independently. Likewise, RN's `next` tag points to `0.88.0-rc.4`, while the beta template specifies RC 3. Use Expo's compatibility guidance and validate any deviation. [Registry snapshot](references/technology-versions-2026-10-08.json), [RN release status](https://reactnative.dev/releases/overview).

Hermes, Metro, native architecture support, and Expo module infrastructure follow the chosen SDK unless a documented experiment establishes a reason to change them. Assess release builds for performance; development-server timing is not app launch timing. [Expo Hermes guidance](https://docs.expo.dev/guides/using-hermes/).

**Choose after:** clean install, dependency checks, iPhone/iPad development builds, a native service call, an editor-view mount, and background/foreground handling. Resolve the Live Markdown Worklets constraint in T05 before freezing this group.

## T02. Host tools, Swift, and TypeScript

| Technology | Current options | Decision evidence |
| --- | --- | --- |
| Bun | `1.4.2` is the checked latest release; the host currently has `1.3.14` | Bun remains the package manager and script entry point. Record the version actually used; no upgrade was performed during research. [Metadata](https://registry.npmjs.org/bun/1.4.2) |
| Node | `24.21.0` LTS or `26.11.1` Current | Expo still requires Node for parts of its tooling even when using Bun. Prefer the supported release whose lifecycle and SDK compatibility fit. The host has `26.5.0`. [Node releases](https://nodejs.org/en/about/previous-releases), [Expo with Bun](https://docs.expo.dev/guides/using-bun/) |
| Xcode / Swift | Xcode 27.0 stable with Swift 6.4; Xcode 27.1 RC and 27.2 beta are preview alternatives | The host has Xcode 27.0 on macOS 27.0.1. Swift and platform SDKs come from the selected Xcode. Verify host support, deployment target, simulator runtime, and native packages together. [Apple compatibility table](https://developer.apple.com/xcode/system-requirements) |
| TypeScript | `7.0.2`, or template-compatible `~6.0.3` | TypeScript 7's native compiler is stable, but its programmatic compiler API is not provided in 7.0. Tools relying on that API can require TypeScript 6 compatibility packages. Choose 7 with a verified tooling arrangement, or 6 until the full toolchain supports 7. [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/), [registry snapshot](references/technology-versions-2026-10-08.json) |

Building SDK 57 with the iOS 27 SDK requires the scene-lifecycle opt-in available from Expo `57.0.23`, configured through `expo-build-properties`. SDK 58 enables scenes by default. Native lifecycle tests must match the chosen configuration. [SDK 57 compatibility notes](https://expo.dev/changelog/sdk-57), [build properties](https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/).

## T03. Native module authoring

**Option A: established Expo Modules API.** Supports native views, events, properties, and asynchronous service methods. Keep file-provider work off the main thread; view methods have different queue semantics from background services. [Module API](https://docs.expo.dev/modules/module-api/).

**Option B: Expo Modules 2.0 Swift macros for supported service APIs, alongside the established API for views.** The SDK 57 preview and SDK 58 beta are candidates for the service boundary. The inspected preview does not cover native views; both APIs can coexist. Do not infer editor readiness from method-call microbenchmarks or assume generated TypeScript support exists. [Modules 2.0 announcement](https://expo.dev/blog/an-early-look-at-expo-modules-2-0).

**Choose after:** one async vault operation, one revision event, and one native editor view compile and behave correctly through backgrounding and teardown. Native `expo-modules-core` versions belong to T01.

## T04. Original-vault and iCloud document access

| Option | Fit and obligations |
| --- | --- |
| `UIDocument` per open note, with separate vault-directory handling | Supplies coordinated document lifecycle, autosave hooks, and conflict facilities. The app still owns snapshots, conditional-save policy, recovery, root enumeration, and folder authorization. [UIDocument](https://developer.apple.com/documentation/uikit/uidocument) |
| Explicit `NSFileCoordinator` and `NSFilePresenter` service | Offers direct ownership of directory operations and document sessions. The app implements snapshotting, safe replacement, presenter lifecycle, conflict handling, and foreground reconciliation. [Coordinator](https://developer.apple.com/documentation/foundation/nsfilecoordinator), [presenter](https://developer.apple.com/documentation/foundation/nsfilepresenter) |

These can be composed: a root-directory observer and per-file documents address different responsibilities. This composition is an architectural option, not an Apple-prescribed vault implementation. Both need a folder picker and persistent security-scoped access; storing a path alone is insufficient. General `expo-file-system` access does not by itself supply the coordinated-vault protocol. Keep iCloud as the file provider; adding a CloudKit database or custom sync backend is outside scope. [Apple directory access](https://developer.apple.com/documentation/uikit/providing-access-to-directories).

**Choose after:** disposable local and iCloud notes survive relaunch, permission loss, external rename/edit, background save, and conflict races. Manual presenter lifecycle must reconcile missed events; notifications are not a complete change log. Preserve the plan's acknowledgement and recovery rules with either option.

## T05. Markdown source editor

| Option | Current fit | Required evidence |
| --- | --- | --- |
| Local UIKit `UITextView` with TextKit 2 | Native source input and range-based decoration; the app owns Markdown styling and native draft integration | Verify selection, composition, undo, newline preservation, and bounded revision events. Avoid legacy layout APIs that trigger TextKit 1 fallback. [Apple TextKit guidance](https://developer.apple.com/videos/play/wwdc2022/10090/) |
| `@expensify/react-native-live-markdown@0.1.343` | Native source input with bundled ExpensiMark styling or a custom parser | Compatibility documentation includes RN 0.86, not RN 0.88. Worklets compatibility lists `0.10.2` and later supported lines, which needs reconciliation with the stable template's `0.10.1`. Its parser runs on the UI thread; the default 4,000-character parsing cutoff disables styling, not editing. Test before raising it. [Tagged README](https://github.com/Expensify/react-native-live-markdown/blob/0.1.343/README.md), [parser](https://github.com/Expensify/react-native-live-markdown/blob/0.1.343/src/parseExpensiMark.ts) |

Use the scoped Live Markdown package, not the unscoped `react-native-live-markdown@0.0.0` placeholder. Its declared peers and installation patches also need checking against the resolved build. [Published package](https://registry.npmjs.org/@expensify%2Freact-native-live-markdown/0.1.343).

Two additional alternatives deserve documentation but are not assumed to satisfy the current contract:

- **Enriched Markdown `1.1.1`:** native rich-text editing with Markdown output. This does not establish lossless source editing, and the inspected input feature list is incomplete. Eligible only after untouched syntax survives round trips and required input behavior works. The older `react-native-enriched` package was renamed to Enriched HTML; do not adopt that deprecated package for Markdown. [Maintainer documentation](https://github.com/software-mansion/enriched-markdown/blob/main/packages/react-native-enriched-markdown/README.md), [registry snapshot](references/technology-versions-2026-10-08.json).
- **CodeMirror 6 through Expo DOM/WebView:** strong source-editor candidate for a future shared web implementation. Current packages include `@codemirror/view@6.43.14` and `@codemirror/lang-markdown@6.5.2`. Its asynchronous bridge, separate editor runtime, newline handling, keyboard behavior, and native recovery integration need proof. A web editor cannot be substituted solely because it renders Markdown well. [Expo DOM](https://docs.expo.dev/guides/dom-components/), [CodeMirror state implementation](https://github.com/codemirror/state/blob/main/src/state.ts), [registry snapshot](references/technology-versions-2026-10-08.json).

**Choose after:** release-build input trials with 4 KiB, 100 KiB, and 1 MiB notes, plus the plan's source-fidelity and accessibility fixtures. Native input and durable draft ownership are mandatory whichever implementation wins. Keep full note strings out of React's per-keystroke controlled state. Document any additional parser before adoption; a parser's Markdown dialect must not rewrite unsupported source.

## T06. SQLite index and metadata

| Option | Current release | Tradeoff to validate |
| --- | --- | --- |
| `expo-sqlite` | SDK 57: `57.0.4`; SDK 58 candidate: `58.0.10` | FTS enabled by default. Async transaction scope can include unrelated queries; exclusive transactions isolate scope but competing writes can still lock. Use an explicit write scheduler. [SDK 57 API](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) |
| `@op-engineering/op-sqlite` | `18.2.5` | Native build and explicit FTS5 configuration. Its async thread and result APIs may suit large reads; verify transaction rules and vendored versus system SQLite behavior. No comparative speed claim is established here. [Installation](https://op-engineering.github.io/op-sqlite/docs/installation/), [API](https://op-engineering.github.io/op-sqlite/docs/api/) |

SQLite FTS5 remains the index capability. Choose tokenizer/query semantics explicitly: token, prefix, and substring search differ, and trigram queries shorter than three characters need a separate strategy. Persist app-owned bookmarks/settings outside the vault; keep note bodies authoritative in Markdown and the index disposable. [SQLite FTS5](https://www.sqlite.org/fts5.html).

**Choose after:** verify FTS5 in the actual iOS binary, 10,000-note indexing, incremental rename/delete/save, interrupted rebuild, lock recovery, query replacement, and memory. SDK-specific cancellation APIs must be checked before relying on them. Avoid adding an ORM unless a documented need justifies another dependency.

## T07. Explorer and result virtualization

**Option A: core `FlatList`.** Uses the selected RN version, with no extra list dependency. Row state must survive unmounts outside the row component, and updates must respect shallow comparison. **Option B: `@shopify/flash-list@2.3.3`.** Uses New Architecture and recycles rows without size estimates; item-local state must reset when a recycled view changes identity. Version 2.3.3 includes a fast-scroll blank-row fix. [FlatList](https://reactnative.dev/docs/flatlist), [FlashList migration](https://shopify.github.io/flash-list/docs/v2-migration/), [release](https://github.com/Shopify/flash-list/releases/tag/v2.3.3).

**Choose after:** compare the same flattened explorer and search results under rapid scrolling, expansion, result replacement, long filenames, large Dynamic Type, and VoiceOver. Fixed row-height assumptions must hold at supported text sizes. Vendor benchmarks do not establish this app's winner.

## T08. Navigation shell and platform controls

**Option A: Expo Router drawer/stack with an adaptive persistent sidebar and separate calendar sheet/panel.** Provides the required compact/wide layout using SDK-compatible gesture and animation packages. **Option B: native Router SplitView where its supported behavior meets the app's needs.** Its documentation still explicitly calls it alpha and unsuitable for production, with root-only use, restricted headers, and an iOS 26+ Inspector. Treat it as an experiment until those limits are resolved or the required experience is proven without unsupported APIs. [Drawer](https://docs.expo.dev/router/advanced/drawer/), [SplitView status](https://docs.expo.dev/versions/latest/sdk/router/split-view/).

SDK 58's `@expo/ui` `NavigationSplitView` is another preview candidate, distinct from Router SplitView. Do not transfer maturity or routing guarantees between similarly named components. [SDK 58 announcement](https://expo.dev/changelog/sdk-58-beta).

For small settings/control groups, compare SDK-matched `@expo/ui` native controls with React Native primitives styled to platform conventions. Neither choice replaces the dedicated large-list or editor decision. [Expo UI](https://docs.expo.dev/versions/latest/sdk/ui/).

**Choose after:** required toolbar actions, iPhone back navigation, iPad resizing, state restoration, keyboard focus, and VoiceOver work together. A beta SDK does not make every component stable.

## T09. Calendar

**Option A: `@expo/ui` graphical SwiftUI DatePicker.** Native month selection; the documented API does not expose arbitrary day decorations. Validate opening the already-selected day, because its event describes selection changes. **Option B: `react-native-calendars@1.1314.0`.** Provides explicit day presses, markings, and custom cells; the app owns native visual fit and accessibility. Marking updates require immutable data. [SDK 57 DatePicker](https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/datepicker/), [RN Calendar API](https://wix.github.io/react-native-calendars/docs/Components/Calendar), [package release](https://registry.npmjs.org/react-native-calendars/1.1314.0).

**Choose after:** month paging creates nothing; selecting or reselecting a day opens the correct note; Today, locale, timezone changes, VoiceOver, and large text behave correctly. Note-existence decorations are optional, not a new requirement. Do not choose a component based only on a screenshot.

## T10. Dates and the Templater subset

| Option | Benefit | Compatibility work |
| --- | --- | --- |
| `date-fns@4.4.0` behind an explicit format adapter | Maintained utilities with modular imports | Templater uses Moment tokens; date-fns uses Unicode tokens. Passing `YYYY-MM-DD` through unchanged is wrong. Map only the plan's allowlisted formats and strictly validate dates. [Token guidance](https://blog.date-fns.org/v2-unicode-tokens/) |
| Temporal with `@js-temporal/polyfill@0.5.1` where needed | `PlainDate` models the selected civil day separately from clock time | Verify the exact Hermes runtime; do not assume native Temporal support. Provide the same limited format adapter and validate Intl/polyfill behavior. [PlainDate](https://tc39.es/proposal-temporal/docs/plaindate.html), [polyfill](https://github.com/js-temporal/temporal-polyfill) |
| Isolated `moment@2.31.0` compatibility adapter | Directly matches Templater's format vocabulary | Moment remains a legacy, mutable library. Its August 2026 policy permits technical maintenance; claims that it is abandoned or can never have another major release are stale. Use only if compatibility evidence warrants it. [Current maintenance policy](https://momentjs.com/news/), [release](https://github.com/moment/moment/releases/tag/2.31.0) |

**Choose after:** selected-day versus actual-time tests, strict invalid-date rejection, leap days, DST transitions, year boundaries, literal formatting, and timezone changes. Capture the clock once. An upstream Temporal iOS Intl issue has a recently closed Hermes counterpart; test the shipped runtime instead of assuming the fix is included. [Polyfill issue](https://github.com/js-temporal/temporal-polyfill/issues/344), [Hermes issue](https://github.com/facebook/hermes/issues/1716).

The template parser remains a small non-evaluating parser regardless of date library. Choosing Moment does not authorize arbitrary Templater JavaScript or expand KTD6. [Templater date semantics](https://silentvoid13.github.io/Templater/internal-functions/internal-modules/date-module.html).

## T11. UI state and styling

| Layer | Option A | Option B | Selection check |
| --- | --- | --- | --- |
| UI state | React hooks/reducers and `useSyncExternalStore` for bounded native-session snapshots | `zustand@5.0.15` with narrow subscriptions | Measure rerenders during indexing and typing. Keep editor text native and authoritative persistence in the designated store. Use a library only where shared state benefits. [React subscription contract](https://react.dev/reference/react/useSyncExternalStore), [Zustand](https://github.com/pmndrs/zustand) |
| Styling | RN `StyleSheet`, shared semantic tokens, and platform appearance APIs | `uniwind@1.12.2` with compatible Tailwind 4 tooling | Compare Dynamic Type, dark mode, native-control integration, and build compatibility. Do not add styling syntax that cannot express the needed behavior. [StyleSheet](https://reactnative.dev/docs/stylesheet), [Uniwind setup](https://docs.uniwind.dev/quickstart) |

`react-native-unistyles@3.5.1` is a further maintained styling candidate if runtime theme capabilities justify its native dependency. It requires compatible New Architecture, React/RN, and Nitro Modules versions. It is an alternative to adopting another styling system, not an additional default layer. [Unistyles requirements](https://unistyl.es/v3/start/getting-started/).

Exact third-party versions above were checked in the [registry snapshot](references/technology-versions-2026-10-08.json). Icons, animation, and miscellaneous Expo packages should use the chosen SDK's components first; document additional libraries with the same compatibility checks.

## T12. Tests, static checks, and performance tools

| Scope | Options | Decision boundary |
| --- | --- | --- |
| Pure TypeScript logic | Bun's test runner or the app's Jest setup | Either must support deterministic clock/filesystem injection. Running scripts through Bun does not require every test to use Bun's runner. [Bun tests](https://bun.sh/docs/test) |
| Expo components and Router | SDK-matched `jest-expo` (`57.0.5` on SDK 57), React Native Testing Library `14.0.1`, and compatible Jest (current `30.5.2`) | Prefer the documented Expo testing integration over assuming Bun alone can replace its mocks and renderer. Verify peer dependencies, transforms, and Router helpers together. [Expo unit tests](https://docs.expo.dev/develop/unit-testing/), [Router tests](https://docs.expo.dev/router/reference/testing/) |
| Native tests | Swift Testing or XCTest for unit/integration checks; XCTest for UI/performance APIs | These can coexist. Swift Testing does not replace every XCTest capability. Choose per test layer. [Apple testing guidance](https://developer.apple.com/documentation/xcode/testing) |
| App flows | Maestro CLI `2.11.0` or Detox `20.51.4` | Maestro provides UI-driven flows; Detox provides instrumented RN testing. Validate the chosen tool against native views, system folder pickers, backgrounding, and the selected SDK. Recheck CLI/runtime requirements during U1. [Maestro release](https://github.com/mobile-dev-inc/Maestro/releases/tag/cli-2.11.0), [Expo Maestro example](https://docs.expo.dev/eas/workflows/examples/e2e-tests/), [Detox setup](https://wix.github.io/Detox/docs/introduction/getting-started/) |
| Lint/format | SDK-matched `eslint-config-expo` (`57.0.2`) with compatible ESLint and Prettier; or Biome with explicit rule coverage | Current standalone releases: ESLint `10.12.0`, Prettier `3.9.9`, Biome `2.5.15`. Do not override Expo peer constraints blindly or drop React Hooks/RN checks when switching. [Expo linting](https://docs.expo.dev/guides/using-eslint/), [Biome rule sources](https://biomejs.dev/linter/rules-sources/) |
| Performance | Xcode Instruments and native signposts, supplemented by RN tooling where useful | Hardware release traces qualify typing, save, and launch targets. JS benchmarks and simulator timings alone cannot qualify them. Record instrument, device, OS, build, fixture, and samples. [Apple Instruments](https://developer.apple.com/tutorials/instruments) |

Use `bun run test` as the common entry point, with explicit scripts for each selected layer. This table does not require every listed runner. Package versions and declared peers are preserved in the [registry snapshot](references/technology-versions-2026-10-08.json); recheck before installation.

## T13. Native generation and builds

**Option A: Expo prebuild/CNG with the SDK's established native dependency integration.** Keep repeatable configuration in app config and config plugins; document any native files intentionally owned by the repository. **Option B: SDK 58's experimental Swift Package Manager build path.** Evaluate only after the chosen modules, config plugins, tests, and editor dependencies are supported. A faster build does not compensate for missing native functionality. [Prebuild](https://docs.expo.dev/workflow/prebuild/), [SDK 58 build changes](https://expo.dev/changelog/sdk-58-beta).

Local Xcode development builds meet the current execution scope. EAS Build is an alternative if remote reproducibility or distribution later warrants it; no cloud build service or paid deployment is required by this plan. Expo Go cannot validate the app's custom native vault/editor module. [Development builds](https://docs.expo.dev/develop/development-builds/introduction/).

**Choose after:** clean native regeneration, reproducible simulator builds, module tests, and native configuration survive the selected workflow. Record Xcode, Ruby/CocoaPods or SwiftPM, SDKs, and any build-service image actually used; avoid claiming a tool version is selected before this exists.

## Decision handoff by implementation unit

| Unit | Choices to settle before dependent work |
| --- | --- |
| U1 | T01-T03, initial T08/T11, T12-T13: framework group, toolchain, module integration, test/build scripts |
| U2 | T04: document ownership and lifecycle; verify it with the T03 native boundary |
| U3 | T05: editor; revisit T01 if a native dependency requires a different compatible group |
| U4 | T06 and search-list portion of T07: index, query semantics, virtualization |
| U5 | T07-T08/T11: explorer, shell, UI subscriptions, styling |
| U6 | T10: date adapter; preserve the existing template grammar |
| U7 | T09: calendar and day-selection semantics |
| U8 | Recheck maintenance/security changes, record final versions and qualification evidence; no unverified last-minute major upgrades |

Keep the [sanitized Obsidian examples](references/README.md) unchanged. They define source-fidelity and unsupported-template cases, not permission to execute plugins or alter the original vault.
