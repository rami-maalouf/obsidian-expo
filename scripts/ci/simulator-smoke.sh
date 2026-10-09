#!/usr/bin/env bash
# runs the app on one simulator with the fixture vault and checks what it wrote.
#
#   scripts/ci/simulator-smoke.sh <device name prefix> <app bundle> <output dir> [maestro flow | @external-edit | @lock-daily | @unlock-daily ...]
#
# 1. boots the first available simulator of an ios 27 or newer runtime whose name starts with the
#    prefix, and installs the app.
# 2. copies tests/fixtures/vault-basic to the app's documents and launches it with the
#    simulator-only `-VaultTestFolder vault` argument.
# 3. checks that today's note was created from the built-in template, that every other fixture
#    file is byte-identical, and that the search index (fts5) found every note.
# 4. runs each maestro flow, checks the typed lines, prints the editor's log, then checks the
#    fixture bytes again. when a flow fails, it prints the
#    on-screen text, whether the app still runs, and the app's errors into the job log, because the
#    uploaded artifacts are not always reachable.
set -euo pipefail

prefix=$1
app=$2
out=$3
shift 3
bundle=com.ramimaalouf.obsidianexpo
mkdir -p "$out"

# the app needs ios 27 (laperm's editor), so only simulators of an ios 27 or newer runtime qualify.
udid=$(xcrun simctl list devices available -j | jq -r --arg prefix "$prefix" '
  [.devices | to_entries[] | select(.key | test("SimRuntime\\.iOS-(2[7-9]|[3-9][0-9])-")) | .value[]
   | select(.name | startswith($prefix))][0].udid // empty')
if [ -z "$udid" ]; then
  echo "no available \"$prefix\" simulator with an ios 27 or newer runtime"
  xcrun simctl list runtimes
  exit 1
fi
xcrun simctl list devices available | grep "$udid"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b
# simulator keyboard settings, not app settings: typed test text stays exact, and the keyboard
# does less work while maestro types. in run 37766313601 maestro's typing never reported a
# result while the prediction bar was showing, although the app had saved the text.
for key in KeyboardAutocorrection KeyboardPrediction KeyboardCheckSpelling KeyboardAutocapitalization; do
  xcrun simctl spawn "$udid" defaults write com.apple.Preferences "$key" -bool NO
done
xcrun simctl install "$udid" "$app"
data=$(xcrun simctl get_app_container "$udid" "$bundle" data)
mkdir -p "$data/Documents/vault"
cp -R tests/fixtures/vault-basic/. "$data/Documents/vault/"
xcrun simctl launch "$udid" "$bundle" -VaultTestFolder vault

today=$(date +%Y-%m-%d)
note="$data/Documents/vault/Daily/$today.md"
for _ in $(seq 1 60); do
  [ -f "$note" ] && break
  sleep 1
done
sleep 5
xcrun simctl io "$udid" screenshot "$out/today.png"
xcrun simctl spawn "$udid" log show --last 3m --style compact \
  --predicate 'process == "obsidianexpo" AND messageType == error' > "$out/errors.log" || true
echo "--- Daily/$today.md"
cat "$note"
printf '# %s\n\nCreated %s ' "$today" "$today" > "$out/expected-prefix.txt"
head -c "$(wc -c < "$out/expected-prefix.txt")" "$note" | cmp - "$out/expected-prefix.txt"

diagnose() {
  echo "--- diagnostics after $1"
  xcrun simctl spawn "$udid" launchctl list | grep -i "$bundle" || echo "the app is not running"
  if maestro --device "$udid" hierarchy > "$out/hierarchy.txt" 2> "$out/hierarchy.err"; then
    # the hierarchy is json after any progress lines; print each element that has text.
    sed -n '/^{/,$p' "$out/hierarchy.txt" | jq -r '
      .. | objects | select(has("attributes")) | .attributes
      | [.text, .accessibilityText, .title, .value] | map(select(. != null and . != "")) | unique
      | select(length > 0) | join(" | ")' | head -120 || head -c 20000 "$out/hierarchy.txt"
  else
    cat "$out/hierarchy.err"
  fi
  xcrun simctl spawn "$udid" log show --last 10m --style compact \
    --predicate 'process == "obsidianexpo" AND (messageType == error OR messageType == fault OR subsystem == "com.facebook.react.log")' \
    | grep -v -E 'CoreHaptics|UIKBFeedbackGenerator|Automation type mismatch' | tail -60 || true
  find "$out/maestro" -name 'maestro.log' -exec tail -40 {} \; 2> /dev/null || true
}

# runs one maestro flow. only a driver that never started is retried, once: no flow command
# has run at that point. failed assertions are never retried.
run_flow() {
  local log
  log="$out/maestro-$(basename "$1" .yaml).log"
  for attempt in 1 2; do
    if maestro --device "$udid" test -e OUT="$out" -e TODAY="$today" --test-output-dir "$out/maestro" "$1" 2>&1 | tee "$log"; then
      return 0
    fi
    if [ "$attempt" = 2 ] || ! grep -q 'iOS driver not ready in time' "$log"; then
      return 1
    fi
    echo "maestro's ios driver did not start; stopping leftover drivers and starting it once more"
    pkill -f maestro-driver || true
    sleep 5
  done
}

# waits up to 20 seconds for a fixed string in today's note.
wait_for_note() {
  for _ in $(seq 1 20); do
    grep -qF -- "$1" "$note" && return 0
    sleep 1
  done
  echo "today's note does not contain: $1"
  cat "$note"
  return 1
}

fixture_hashes() {
  (cd "$1" && find . -type f ! -path "./Daily/$today.md" -exec shasum -a 256 {} + | sort -k2)
}
fixture_hashes tests/fixtures/vault-basic > "$out/before.txt"
fixture_hashes "$data/Documents/vault" > "$out/after-launch.txt"
diff "$out/before.txt" "$out/after-launch.txt"

expected=$(cd "$data/Documents/vault" && find . -type f -name '*.md' -not -path '*/.*' | wc -l | tr -d ' ')
db=""
indexed=0
for _ in $(seq 1 60); do
  db=$(ls "$data"/Library/Caches/vault-index/index-*.db 2>/dev/null | head -1 || true)
  if [ -n "$db" ]; then
    indexed=$(sqlite3 "$db" "select count(*) from notes where indexed_modified is not null" 2>/dev/null || echo 0)
    [ "$indexed" = "$expected" ] && break
  fi
  sleep 1
done
echo "index: $indexed of $expected notes indexed"
[ "$indexed" = "$expected" ]
# the runner's sqlite3 tool has no fts5 module, so check the app-created fts5 table through its
# schema and its plain content table; the maestro flow then searches through the app itself.
sqlite3 "$db" "select sql from sqlite_master where name = 'note_text'" | tee "$out/fts.txt"
grep -qi 'using fts5' "$out/fts.txt"
sqlite3 "$db" "select n.path from note_text_content c join notes n on n.id = c.id where c.c1 like '%Callout title%'" | tee -a "$out/fts.txt"
grep -qx 'Welcome.md' "$out/fts.txt"

if [ "$#" -gt 0 ]; then
  # maestro 2.11.0 was the release observed in ci on october 8, 2026 (t12); the install script
  # reads MAESTRO_VERSION. its xctest driver sometimes did not start within the default timeout
  # (runs 37761335047 and 37761485857), and once not within five minutes (run 37775525566), so
  # the timeout is three minutes and run_flow restarts a driver that did not start.
  export MAESTRO_VERSION=2.11.0
  export MAESTRO_DRIVER_STARTUP_TIMEOUT=180000
  export PATH="$HOME/.maestro/bin:$PATH"
  if ! command -v maestro > /dev/null; then
    curl -fsSL "https://get.maestro.mobile.dev" | bash
  fi
  # a driver left running by an earlier step can keep this simulator's driver from starting.
  pkill -f maestro-driver || true
  for flow in "$@"; do
    case "$flow" in
      @external-edit)
        # the background flow's text was saved before suspension; now another app appends a line.
        wait_for_note 'Before background.'
        printf '\nExternal line from another app.\n' >> "$note"
        continue
        ;;
      @lock-daily)
        # saves into the daily folder now fail, as they would on a read-only or full volume.
        chmod 555 "$(dirname "$note")"
        continue
        ;;
      @unlock-daily)
        chmod 755 "$(dirname "$note")"
        if grep -qF 'Kept as a draft.' "$note"; then
          echo "the save into the read-only folder should have failed"
          exit 1
        fi
        continue
        ;;
    esac
    before_flow=$(shasum -a 256 < "$note")
    if ! run_flow "$flow"; then
      diagnose "$flow"
      exit 1
    fi
    # daily-notes flows only reopen today's note, so its bytes must not change.
    if [[ "$flow" == */daily-notes/* ]] && [ "$(shasum -a 256 < "$note")" != "$before_flow" ]; then
      echo "today's note changed during $flow"
      exit 1
    fi
  done
  echo "--- Daily/$today.md after the flows"
  cat "$note"
  grep -q 'Typed in the simulator.' "$note"
  for line in '## Styled heading' '```' '# Inside code'; do
    grep -qxF -- "$line" "$note"
  done
  if [[ " $* " == *" @external-edit "* ]]; then
    # the outside change was reloaded, and typing afterwards saved on top of it.
    wait_for_note 'External line from another app.'
    wait_for_note 'After foreground.'
  fi
  if [[ " $* " == *" @unlock-daily "* ]]; then
    # the journaled draft was saved from the recovery list.
    wait_for_note 'Kept as a draft.'
  fi
  echo "--- editor log"
  xcrun simctl spawn "$udid" log show --last 15m --style compact \
    --predicate 'subsystem == "com.ramimaalouf.obsidianexpo"' | tail -20 || true
  fixture_hashes "$data/Documents/vault" > "$out/after-flows.txt"
  diff "$out/before.txt" "$out/after-flows.txt"
fi

xcrun simctl shutdown "$udid"
