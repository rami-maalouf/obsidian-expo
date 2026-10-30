# expo explore

Explore captures the note, search, and settings routes before and after a change, then produces a visual report and app map. The configuration uses `@expo/explore@0.23.0`, deterministic navigation, iPhone 17 and Pixel 7 targets, and the app's light/dark appearances. Reports can be hosted on EAS Hosting.

## isolated capture app

The `explore` EAS profile builds **Sapphire Explore** with the `com.ramimaalouf.obsidianexpo.explore` identifier and `obsidianexpo-explore` scheme. This identity has storage separate from the production, development, and preview apps. OTA updates are disabled for this build so the captured JavaScript comes from the compared commit.

On a simulator/emulator only, the native module copies the public [Welcome fixture](../tests/fixtures/vault-basic/Welcome.md) into a fixed `expo-explore` folder inside this app's container. It registers that folder and initializes its daily-note settings and navigation history. The first screen opens `Welcome.md`, avoiding a clock-dependent daily note. It reads no personal vault, takes no filesystem path or content from JavaScript, and preserves edits and existing settings across relaunches. The production, preview, and development identities never run this bootstrap; neither do physical devices.

The fixture contains Markdown syntax and sample links. Only its Welcome note is seeded, so links to the larger fixture vault's other files are deliberately not part of this route-capture scenario. Use the existing fixture/E2E suites for link resolution and data-integrity qualification.

## commands

Use Node.js 24.12 or newer and install the app with its lockfile:

```sh
bun install --frozen-lockfile
APP_VARIANT=explore bunx @expo/explore@0.23.0 doctor --json
bunx @expo/explore@0.23.0 setup --check
```

After the profile and fixture bootstrap are committed on both compared revisions, capture a change or all three routes:

```sh
APP_VARIANT=explore bunx @expo/explore@0.23.0 capture --base <base-sha> --head <head-sha>
APP_VARIANT=explore bunx @expo/explore@0.23.0 capture --base <base-sha> --head <head-sha> --scope all --upload
```

Capture starts EAS builds and simulator sessions. `--upload` publishes the report to EAS Hosting. Review the selected commits and expected usage before starting a run. `--simulator local` uses local devices, but the native builds still come from EAS. iOS needs a runtime compatible with this app's iOS 27 deployment target.

The initial integration has no usable pre-integration baseline: older commits have neither the `explore` build profile nor the fixture bootstrap. Establish the first baseline from the integration commit, then compare later commits against it. Do not report an absent baseline as a regression-free comparison.

## routes and readiness

| route | representative state |
| --- | --- |
| `/` | synthetic Welcome note, native editor reports opened |
| `/search` | search sheet over the selected synthetic vault |
| `/settings` | settings sheet for that same synthetic vault |

All three links are included. The settings preview contains the current date and creation time; those text differences are expected across capture times and are not evidence of a behavior regression. Setup opens the root link and waits for the existing native `note-status:opened` identifier, also used by the editor E2E tests. The static analyzer does not recognize `VaultGate`'s conditional rendering as a source redirect, so a passing route analysis alone does not prove that the editor is ready. The native fixture bootstrap satisfies the gate, and the readiness check fails if it does not.

Explore reports three runtime-computed navigator registrations as source-analysis warnings. The route files are discovered, but some transition edges may be absent from the map. Files, calendar, menus, and editor keyboard states are not separate Router routes and are outside this initial static route inventory.

## github actions

The generated `explore-review.yml`, `explore-baseline.yml`, and `explore-compare.yml` workflows pin Explore 0.23.0. App dependency installation uses Bun. The unmodified upstream templates install Explore's own tools with npm against its release shrinkwrap, preserving the tool's tested dependency tree.

Before enabling captures:

1. Set the repository's `EXPO_TOKEN` secret for an account with access to this EAS project and EAS Simulator. Hosting requires a token able to create/deploy the report project. Never commit the token.
2. Run the capture check from a clean, committed checkout: `APP_VARIANT=explore bunx @expo/explore@0.23.0 doctor --capture --yes`. Inspect all three routes on both platforms and appearances.
3. Merge the verified workflows into `main`, then run **Expo Explore baseline** from Actions. The PR workflow runs the default branch's workflow, so adding it in a PR cannot review that PR itself.

The compare workflow accepts base/head refs for later before/after checks. Keep fixture preparation the same on both sides. For an upgrade, run `APP_VARIANT=explore bunx @expo/explore@<exact-version> setup --workflows` and review the generated changes.

## evidence and remaining checks

The configuration schema and online doctor were checked during authoring. Expo login, project access, EAS Simulator availability, both platform build profiles, SDK compatibility, and the preview EAS environment were available. The repository had no `EXPO_TOKEN` secret, and the new workflows were not on `main`.

Native fixture tests exercise the production/device gates, fixture bytes, isolation from another folder, and preservation of edits. The app configuration test checks the isolated identity and disabled updates. Both Swift and Kotlin fixture tests and the app configuration tests passed. The iOS resource lives under the pod root as `Resources/Welcome.txt`, with a byte-parity test against the public Markdown fixture. This fixes CocoaPods omitting the earlier resource outside the pod root. After the SDK update, a clean Release simulator build and fresh installation opened the Welcome note on iOS 27 and exposed the expected toolbar accessibility labels. Search and settings deep links opened; the rendered note, search, and settings screens were inspected, including dark settings. The branch includes the SDK 58 compatibility update; frozen install, all 231 JavaScript tests, types, lint, references, online Expo compatibility, all 20 Doctor checks, and all-platform export passed. The complete Swift core suite passed (89 tests), and Kotlin core passed all 80 tests on Linux; the Mac filesystem cannot represent one pre-existing case/Unicode fixture requirement. A cloud capture, hosted report, and successful CI comparison have not yet been observed. Native core tests and bundle export do not prove that the built app reaches its capture screens; keep that distinction when reviewing this integration.
