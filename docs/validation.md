# Validation

This ledger records evidence for each implementation unit in the [plan](plans/2026-10-08-0149-feat-native-vault-notes-plan.md). A capability is qualified only by the evidence category the plan names. JS bundle export does not prove native compilation, Simulator results do not prove device behavior, and single-device results do not prove iCloud behavior. Starter evidence is in [starter verification](../VERIFICATION.md); technology choices are in [technology decisions](technology-decisions.md).

## Environments

| ID | Environment | Used for |
| --- | --- | --- |
| L1 | Linux x86_64 cloud container, Bun 1.3.14 (Bun 1.4.2 also installed), Node 22.22.0, TypeScript 6.0.3, ESLint 9.39.5, SQLite 3.53.0 in `bun:sqlite` | Reference check, type check, lint, `bun test`, production JS export, preliminary search benchmark |
| CI | GitHub Actions `check` workflow: Ubuntu 24.04, Node 24, Bun 1.3.14 | The same checks plus `bunx expo install --check` |
| M1 | GitHub Actions `ios` workflow: image `macos-26-arm64` 20260907.0351, macOS 26.6.2, Xcode 26.6 (17F113), Swift 6.3.3 | `swift test` for the vault core; `expo prebuild`; Release build for the iOS Simulator; Simulator smoke test |

L1 has Node 22.22.0, below the repository's Node 24.3 minimum; CI covers Node 24. The L1 egress policy blocks `api.expo.dev`, so `bunx expo install --check` and `expo-doctor` run only in CI. M1 runs Xcode 26.6 because the runner image had no stable Xcode 27 on October 8, 2026; the starter was first verified with Xcode 27.0. No physical device has been used.

## Evidence categories

| Category | Status |
| --- | --- |
| Pure TypeScript tests | `bun run check` in L1 and CI; 107 tests across 11 files as of `01a3a36` |
| Native unit tests | `swift test --package-path modules/vault` on M1; 69 tests in 11 suites passed for `becf682` |
| Production JS export | Passes in L1 for web, iOS, and Android bundles |
| Native iOS compilation | Release Simulator builds passed on M1 for the starter (`09f6966`, 17.6 minutes), the first vault module (`24158f7`), the journal and enumeration core (`e52e9ea`), the JavaScript bridge with the folder picker (`31e091d`), the full app with the editor, search, explorer, calendar, and settings (`3fbdf82`), the native iPad build with all orientations (`0a1aec2`), and the editor with source styling (`becf682`) |
| Simulator interaction | `scripts/ci/simulator-smoke.sh` runs on an iPhone and an iPad Pro 13-inch Simulator: fixture vault → today's note → byte checks → FTS5 index, then Maestro flows. First run (`3fbdf82`, iPhone Simulator, October 8, 2026): the Release app opened the fixture vault through the test hook, created `Daily/2026-10-08.md` from the built-in template (`# 2026-10-08`, `Created 2026-10-08 08:00`), left every other fixture file byte-identical, and indexed 26 of 26 notes in its own SQLite build; the harness then failed because the runner's `sqlite3` tool lacks FTS5 (fixed in `51e8518`). With `51e8518`, the iPhone flow passed: Maestro typed into today's note, the status changed from "No unsaved changes" to "Saved locally", the typed text was on disk, in-app search for "callout" found Welcome, and every other fixture file stayed byte-identical. The iPad flow failed: without `ios.supportsTablet` the app ran in iPhone compatibility mode. With `0a1aec2` (native iPad app, all orientations; run 37751267452), both devices passed. On the iPad Pro 13-inch (M5) Simulator, iOS 26.4: today's note created from the template, 26 of 26 notes indexed, the same typing, saving, and search flow, then the wide layout with the sidebar beside the editor, a bookmark added and listed, and Today reopened from the calendar. Typed text was appended at the end of the note, and all other fixture files stayed byte-identical. With `becf682` (run 37752908876), both devices passed again with three more checks: lines typed after Enter (`## Styled heading`, a code fence, and `# Inside code`) were on disk exactly as typed; the editor log said "source styling on: styled the first paragraph" at every launch, so TextKit 2 used the styler; and a relaunch opened today's note again without changing its bytes. On the iPad, a relaunch also kept the bookmark. Screenshots are uploaded as the `simulator-smoke` artifact, but the L1 egress policy blocks artifact downloads, so the UI has not been inspected visually from L1 |
| Physical-device input and performance | Not run |
| Multi-device iCloud | Not run |

## Unit status

| Unit | Status | Evidence | Open gaps |
| --- | --- | --- | --- |
| U1 | Mostly done | Bun tests, [authored fixture vault](../tests/fixtures/vault-basic) with a byte manifest, deterministic 10,000-note generator, local Expo module autolinked and compiled in Release Simulator builds, iPhone and iPad Simulator launches, demo screens and the starter reset script removed | Toolchain requalification with Xcode 27 when available; T01-T02 and T13 records |
| U2 | Core done; device qualification open | `swift test`: path containment with symlinks, file states, exact-byte reads, exclusive create under 16 concurrent writers, conditional save conflicts, deleted and renamed targets, failed writes, unreadable files never replaced, journal, enumeration, bookmark registry, session release ordering | Folder picker and bookmark restore on iOS (the smoke test registers the fixture vault without the picker); modern iCloud placeholders; presenter-based change events |
| U3 | Native editor, writing flow, and display-only source styling implemented; device qualification open | `swift test` for the document session: save round trip, restart recovery, conflict and missing states that keep drafts, foreground reconcile, read-only encodings, checkpoint failure, newline convention; Simulator typing and saving on iPhone and iPad (`0a1aec2`); `swift test` for the styling rules; with styling on, typed headings and fences were saved exactly on iPhone and iPad Simulators (`becf682`) | IME, dictation, hardware keyboard, undo with styling, and long notes on a device; visual review of the styling |
| U4 | Index and search implemented; device qualification open | `tests/integration/search.test.ts` (17 tests, including a refresh during discovery, separate indexes per vault, and schema-version rebuilds); the app's own SQLite build created the FTS5 index and indexed 26 of 26 fixture notes, and in-app search found Welcome on iPhone and iPad (`0a1aec2`); preliminary host benchmark below | Device timing and memory; typing during indexing trace |
| U5 | Implemented; device qualification open | `tests/unit/explorer-bookmarks.test.ts`: folders first in natural order, deep folders, a 10,000-note tree, duplicate basenames, missing bookmarks, observed moves by file identity; `swift test` for file identity across a rename and the app-data store; iPad Simulator flow with the sidebar beside the editor, adding a bookmark, and listing it (`0a1aec2`), and finding it again after a relaunch (`becf682`) | Narrow iPad multitasking and VoiceOver focus on a device |
| U6 | Logic complete | See below; the Release app created today's note through native `createExclusive` from the built-in template on iPhone and iPad Simulators | Hermes date check |
| U7 | Implemented; device qualification open | `tests/unit/calendar.test.ts` (grid, leap years, paging, VoiceOver labels); `tests/unit/daily-settings-store.test.ts` (stored settings, rollover timer); resolver tests for repeated taps, cancellation, and late completion; launch into Today, and Today reopened from the calendar, on the iPad Simulator (`0a1aec2`); relaunch into Today with unchanged note bytes on iPhone and iPad Simulators (`becf682`) | Midnight and time zone changes while running; keyboard and VoiceOver navigation on a device |
| U8 | Not started | None | Devices and iCloud |

## U6 scenarios

The resolver is tested against an in-memory vault implementing `DailyNoteVault` (`src/features/daily-notes/resolver.ts`), and through the adapter to the native module's API shape (`tests/unit/daily-note-vault.test.ts`).

| Plan scenario | Evidence |
| --- | --- |
| Existing note with a broken template opens unchanged | `daily-resolver.test.ts`: "an existing note opens unchanged even when the template is now invalid"; also with the sanitized reference template |
| Invalid tags and arguments | `templates.test.ts`: "unsupported tags, commands, and arguments" (44 cases) |
| Unsupported execution tags, variable expressions, and date formats create nothing | Each fixture in `tests/fixtures/vault-basic/Templates/Unsupported/` and the sanitized `Daily Template.md` produce a template error with zero create calls |
| Supported starter template creates successfully | Built-in template, `tests/fixtures/vault-basic/Templates/Daily.md`, and the sanitized `Daily Basic.md` render exactly |
| Selected historical date; explicit title reference | Yesterday's note uses its own title while `tp.date.now()` uses the captured clock; `tp.file.title` references in both filename formats |
| DST, leap day, and year rollover | Calendar arithmetic tests; `captureClock` under `America/New_York` and `Asia/Tokyo` |
| Invalid path | `daily-path.test.ts`: absolute, `..`, hidden (including `.obsidian`), empty segments, forbidden characters, leading or trailing spaces, overlong names |
| Repeated taps | One create call and one current result for two taps on the same day |
| Create collision | A racing writer's file is opened, not overwritten |
| Cancellation and late completion | Selecting another day before creation creates nothing; navigating away after commit keeps the note without taking focus |
| Cloud placeholder or unknown state | Shows unavailable and creates nothing; an unavailable or non-UTF-8 template also blocks creation |

## Preliminary search benchmark

`bun scripts/benchmark-search.ts` on L1 (linux x64, Bun 1.3.14, SQLite 3.53.0), October 8, 2026: 10,000 generated notes, 44,317,263 bytes. Discovery 81 ms; full content indexing 1,810 ms; 100 queries, p50 10.86 ms and p95 34.9 ms for the search function alone. This excludes rendering, debounce, and the native bridge, and it is not a device measurement; it does not qualify the "warm indexed search p95 ≤ 100 ms" target.
