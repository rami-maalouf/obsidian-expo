# performance benchmarks

Use repeatable workloads to choose an optimization, then compare the same workload before and after one change. The benchmark tools do not change application behavior. A faster run with changed search results is rejected, not reported as an improvement.

## host workloads

[benchmark-search.ts](../scripts/benchmark-search.ts) runs the app's real `SearchIndex` and explorer code with `bun:sqlite` and an in-memory synthetic vault. It uses a fresh on-disk SQLite database for every round. It does not use Hermes, `expo-sqlite`, native vault IO, the editor, debounce, or rendered lists. Fresh database timings are not cold device-launch timings.

| metric | measured work |
| --- | --- |
| `schemaOpen` | create the index schema in a fresh database |
| `discoverFresh` | discover every note's metadata |
| `indexFresh` | read and index every note's content |
| `discoverUnchanged` | rediscover the same vault and attempt indexing; content reads must remain zero |
| `queryWarm` | query the prepared index after ten unmeasured warmup queries |
| `explorerBuild` | build the folder tree |
| `explorerSort:*` | flatten every expanded folder under each of the app's six sort modes |
| `reconcileChanges` | discover and index one edit, one rename, one deletion, and one replacement |

Fixture construction, correctness assertions, result hashing, and report serialization sit outside timed operations. The index uses immediate promises between batches, matching the earlier host benchmark. It therefore does not measure the app's scheduling pauses or UI responsiveness while indexing.

The default workload has 10,000 notes, 100 measured queries per round, one discarded full-workload warmup, and five measured rounds. The seed defaults to 1. Two notes receive synthetic marker words so reconciliation has known expected search results; the report's byte count and digest describe these exact inputs, not the unmodified generator manifest. At least three notes are required.

`--stress` adds the generator's 100 KiB and 1 MiB notes and performs 20 edit/rename/delete cycles per round. It checks full index coverage after every cycle, removal of old content, the new paths and content, and unchanged fixture records outside the three intentionally edited notes. This stresses indexing long notes, not typing into them.

## collect and compare

Run without other builds, tests, indexers, or benchmark processes competing for CPU and disk. Keep power mode and thermal conditions the same. Repeated runs in an active development session are harness smoke checks only.

```sh
bun install --frozen-lockfile
bun run benchmark:host --output .fixtures/benchmarks/before.json
# make exactly one optimization, keeping the benchmark harness unchanged
bun run benchmark:host --output .fixtures/benchmarks/after.json
bun run benchmark:host --baseline .fixtures/benchmarks/before.json --candidate .fixtures/benchmarks/after.json --output .fixtures/benchmarks/comparison.json
```

Stress uses the same comparison command:

```sh
bun run benchmark:stress --output .fixtures/benchmarks/stress-before.json
# make exactly one optimization, keeping the benchmark harness unchanged
bun run benchmark:stress --output .fixtures/benchmarks/stress-after.json
bun run benchmark:host --baseline .fixtures/benchmarks/stress-before.json --candidate .fixtures/benchmarks/stress-after.json
```

Outputs refuse to overwrite existing files. `.fixtures/` is already ignored. Use a new filename for another run. Keep both raw reports alongside the comparison when attaching evidence to a PR. Reports contain no vault text, hostname, personal paths, or credentials.

Optional run controls are `--count`, `--seed`, `--queries`, `--repeats`, and `--warmups`. Use identical values on both sides. For a quick harness smoke check:

```sh
bun run benchmark:host --count 100 --queries 10 --repeats 2 --warmups 0 --stress
```

The report records every sample, p50/p95/min/max, fixture digest, harness digest, app source digest, Git commit and dirty state, lockfile digest, declared Expo/React Native versions, Bun and SQLite versions, OS, CPU, memory, locale, and timezone. The measurement/build kind is always `host-bun-sqlite`; there is no native build in this run. For clean revision provenance, collect after committing each candidate and retain the source digest as well as the commit.

The comparator rejects different workloads, fixtures, host environments, result digests, metrics, or sample counts. It intentionally permits different app revisions, lockfiles, and dependency declarations so a controlled change can be compared. Check those differences in review. Keep the same benchmark files on both revisions; if its workload or assertions change, establish a new baseline.

Negative deltas mean less elapsed time. Deltas are descriptive, not a significance test. Five fresh-index samples are useful for finding large changes, not for claiming a small p95 improvement. Increase repetitions, alternate baseline/candidate run order, and inspect all raw samples before attributing a difference to code. Comparing the unchanged app against itself is a noise check and makes no speedup claim.

## device qualification remains separate

Host timings cannot establish a React Native or Expo runtime improvement. Use these workloads to find logic costs, then use a Release build on the same named physical device for changes to Hermes, the native bridge, SQLite, rendering, or input. Preserve the [verification contract](plans/2026-10-08-0149-feat-native-vault-notes-plan.md#verification-contract):

- generate a disposable 10,000-note vault with `bun scripts/generate-vault.ts --out /tmp/vault-performance --stress`; keep its manifest with the evidence.
- build both revisions in Release with the same platform/toolchain and fixture. The [native build instructions](../README.md) and [cloud development guide](CLOUD_DEVELOPMENT.md#native-builds) describe repository commands; simulator builds only validate flows.
- collect 30 returning cold-launch and warm-note-switch samples, at least 100 rendered search samples including debounce, and save-acknowledgement samples. Record device model, OS, build/revision, Expo/React Native revisions, and cold/warm condition.
- record a 60-second native typing trace during indexing with Instruments; repeat with the 100 KiB and 1 MiB notes. Check exact saved bytes after reopen, changed-note correctness, and unchanged-file manifests.
- report local IO separately from cloud downloads. Keep release traces and raw samples, including slow samples. Do not compare simulator timings with physical-device timings.

Physical-device launch, typing, save latency, native memory, and thermal behavior have not been measured by this harness. The existing simulator smoke scripts verify editing/search flows but do not implement a physical-device performance runner. No native performance target is qualified by a passing host benchmark.
