#!/usr/bin/env bash
# runs the app on one simulator with the fixture vault and checks what it wrote.
#
#   scripts/ci/simulator-smoke.sh <device name prefix> <app bundle> <output dir> [maestro flow...]
#
# 1. boots the first available simulator whose name starts with the prefix and installs the app.
# 2. copies tests/fixtures/vault-basic to the app's documents and launches it with the
#    simulator-only `-VaultTestFolder vault` argument.
# 3. checks that today's note was created from the built-in template, that every other fixture
#    file is byte-identical, and that the search index (fts5) found every note.
# 4. runs each maestro flow, checks the typed lines, prints the editor's log (source styling on or
#    off), then checks the fixture bytes again. when a flow fails, it prints the
#    on-screen text, whether the app still runs, and the app's errors into the job log, because the
#    uploaded artifacts are not always reachable.
set -euo pipefail

prefix=$1
app=$2
out=$3
shift 3
bundle=com.ramimaalouf.obsidianexpo
mkdir -p "$out"

udid=$(xcrun simctl list devices available -j | jq -r --arg prefix "$prefix" '[.devices[][] | select(.name | startswith($prefix))][0].udid')
xcrun simctl list devices available | grep "$udid"
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b
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
    | tail -80 || true
  find "$out/maestro" -name 'maestro.log' -exec tail -40 {} \; 2> /dev/null || true
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
  export PATH="$HOME/.maestro/bin:$PATH"
  if ! command -v maestro > /dev/null; then
    curl -fsSL "https://get.maestro.mobile.dev" | bash
  fi
  for flow in "$@"; do
    if ! maestro --device "$udid" test -e OUT="$out" --test-output-dir "$out/maestro" "$flow"; then
      diagnose "$flow"
      exit 1
    fi
  done
  echo "--- Daily/$today.md after the flows"
  cat "$note"
  grep -q 'Typed in the simulator.' "$note"
  for line in '## Styled heading' '```' '# Inside code'; do
    grep -qxF -- "$line" "$note"
  done
  echo "--- editor log"
  xcrun simctl spawn "$udid" log show --last 15m --style compact \
    --predicate 'subsystem == "com.ramimaalouf.obsidianexpo"' | tail -20 || true
  fixture_hashes "$data/Documents/vault" > "$out/after-flows.txt"
  diff "$out/before.txt" "$out/after-flows.txt"
fi

xcrun simctl shutdown "$udid"
