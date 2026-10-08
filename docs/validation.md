# Validation

This ledger records evidence for each implementation unit in the [plan](plans/2026-10-08-0149-feat-native-vault-notes-plan.md). A capability is qualified only by the evidence category the plan names. JS bundle export does not prove native compilation, Simulator results do not prove device behavior, and single-device results do not prove iCloud behavior. Starter evidence is in [starter verification](../VERIFICATION.md).

## Environments

| ID | Environment | Used for |
| --- | --- | --- |
| L1 | Linux x86_64 cloud container, Bun 1.3.14 (Bun 1.4.2 also installed), Node 22.22.0, TypeScript 6.0.3, ESLint 9.39.5 | Reference check, type check, lint, `bun test`, production JS export |
| CI | GitHub Actions, Ubuntu 24.04, Node 24, Bun 1.3.14 | The same checks plus `bunx expo install --check` |

L1 has Node 22.22.0, below the repository's Node 24.3 minimum; CI covers Node 24. The L1 egress policy blocks `api.expo.dev`, so `bunx expo install --check` and `expo-doctor` cannot run there. No macOS, Xcode, iOS Simulator, or physical device has been used for feature work yet.

## Evidence categories

| Category | Status |
| --- | --- |
| Pure TypeScript unit tests | Running in L1 and CI through `bun run check` |
| Production JS export (`bun run export`) | Passed in L1 after U1 and after U6. No route imports the U6 modules yet, so the export does not bundle them |
| Native iOS compilation | Not run for any feature unit |
| Simulator interaction | Not run for any feature unit |
| Physical-device input and performance | Not run |
| Multi-device iCloud | Not run |

## Unit status

| Unit | Status | Evidence | Open gaps |
| --- | --- | --- | --- |
| U1 | Partial | Bun test runner; [authored fixture vault](../tests/fixtures/vault-basic) with a byte manifest; deterministic 10,000-note generator; tests in `tests/unit/fixtures.test.ts` and `tests/unit/vault-generator.test.ts` | Local native module integration, iPhone/iPad development builds, Simulator smoke checks, and the T01-T03, T08, T11-T13 decisions need macOS |
| U2 | Not started | None | Needs Swift, Xcode, and disposable local and iCloud vaults |
| U3 | Not started | None | Needs U2 and native editor work |
| U4 | Not started | None | Index logic can start on Linux; FTS5 in the iOS binary needs macOS |
| U5 | Not started | None | Pure models can start on Linux; layout and accessibility need iOS |
| U6 | Logic complete; native create integration open | See below | Native `createExclusive` integration test (`tests/integration/daily-create.test.ts` in the plan) needs U2; Hermes date check |
| U7 | Not started | None | Needs U5-U6 and iOS |
| U8 | Not started | None | Needs devices and iCloud |

## U6 scenarios

The resolver is tested against an in-memory vault that implements the same interface the native vault service must provide (`DailyNoteVault` in `src/features/daily-notes/resolver.ts`). These are unit tests of the protocol, not native integration tests.

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

**Commands:** `bun run check` in L1 with Bun 1.3.14 on October 8, 2026: reference check passed, both TypeScript projects passed, ESLint reported no warnings, and 62 tests passed across 5 files. `bun test` with Bun 1.4.2 also passed 62 tests. `CI=1 bun run export` passed.
