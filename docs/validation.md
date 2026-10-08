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
| Pure TypeScript tests | `bun run check` in L1 and CI; 82 tests across 8 files as of the search commit |
| Native unit tests | `swift test --package-path modules/vault` on M1; 42 tests in 8 suites passed for the vault bridge commit (`31e091d`) |
| Production JS export | Passes in L1 for web, iOS, and Android bundles |
| Native iOS compilation | Release Simulator builds passed on M1 for the starter (`09f6966`, 17.6 minutes), the first vault module (`24158f7`), and the journal and enumeration core (`e52e9ea`) |
| Simulator interaction | The smoke test (fixture vault → today's note → index) is added; results are recorded below once it runs |
| Physical-device input and performance | Not run |
| Multi-device iCloud | Not run |

## Unit status

| Unit | Status | Evidence | Open gaps |
| --- | --- | --- | --- |
| U1 | Mostly done | Bun tests, [authored fixture vault](../tests/fixtures/vault-basic) with a byte manifest, deterministic 10,000-note generator, local Expo module autolinked and compiled in Release Simulator builds, demo screens replaced by the app shell | iPad Simulator run; toolchain requalification with Xcode 27 when available; T01-T02, T08, T12 UI-test and T13 records |
| U2 | Core done; device qualification open | `swift test`: path containment with symlinks, file states, exact-byte reads, exclusive create under 16 concurrent writers, conditional save conflicts, deleted and renamed targets, failed writes, unreadable files never replaced, journal, enumeration, bookmark registry, session release ordering | Folder picker and bookmark restore on iOS; modern iCloud placeholders; external rename identity; presenter-based change events |
| U3 | Native editor and writing flow implemented; device qualification open | `swift test` for the document session: save round trip, restart recovery, conflict and missing states that keep drafts, foreground reconcile, read-only encodings, checkpoint failure, newline convention | Simulator typing tests; IME, dictation, hardware keyboard, and long notes on a device; source styling |
| U4 | Index and search implemented; device qualification open | `tests/integration/search.test.ts` (13 tests); preliminary host benchmark below | Device timing and memory; typing during indexing trace |
| U5 | Not started | None | Explorer, bookmarks, sidebar |
| U6 | Logic complete | See below | Native `createExclusive` path is covered by the smoke test once it runs; Hermes date check |
| U7 | Not started | None | Calendar, settings, date rollover |
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
