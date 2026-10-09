#!/usr/bin/env bash
# runs the release app on a booted android emulator and checks what it wrote.
#
#   scripts/ci/emulator-smoke.sh <apk> <output dir>
#
# 1. installs the app and copies tests/fixtures/vault-basic to the emulator's shared Documents
#    folder, where a user's vault would be.
# 2. runs the maestro flows in tests/e2e/android: the system folder picker grants the vault
#    (storage access framework), first setup finds the daily-note settings, today's note is
#    created from the fixture template, text is typed and saved, and a relaunch reopens today
#    and searches the vault.
# 3. checks today's note on disk, that every other fixture file is byte-identical, and that the
#    app wrote nothing into the vault but today's note.
set -euo pipefail

apk=$1
out=$2
package=com.ramimaalouf.obsidianexpo
vault=/sdcard/Documents/vault
mkdir -p "$out"

echo "waiting for the emulator to boot"
timeout 300 adb wait-for-device
for _ in $(seq 1 120); do
  [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] && break
  sleep 2
done
[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]
adb shell getprop ro.build.version.release
# test-environment settings, not app settings: no animations, and the screen stays on.
for setting in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb shell settings put global "$setting" 0
done
adb shell svc power stayon true
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard || true

echo "installing $apk"
adb install -r "$apk"
adb shell mkdir -p /sdcard/Documents
adb push tests/fixtures/vault-basic "$vault" > /dev/null
adb shell ls -a "$vault"

# the emulator's own clock and time zone decide which note is today's.
today=$(adb shell date +%Y-%m-%d | tr -d '\r')
note="$vault/Daily/$today.md"
echo "today on the emulator: $today"

diagnose() {
  echo "--- diagnostics after $1"
  adb shell pidof "$package" || echo "the app is not running"
  adb exec-out screencap -p > "$out/failure.png" || true
  if timeout 120 maestro hierarchy > "$out/hierarchy.txt" 2> "$out/hierarchy.err"; then
    sed -n '/^{/,$p' "$out/hierarchy.txt" | jq -r '
      .. | objects | select(has("attributes")) | .attributes
      | [.text, .accessibilityText, .hintText, .["resource-id"]] | map(select(. != null and . != "")) | unique
      | select(length > 0) | join(" | ")' | head -120 || head -c 20000 "$out/hierarchy.txt"
  else
    cat "$out/hierarchy.err"
  fi
  adb logcat -d -t 400 '*:W' | grep -v -E 'chatty|GoogleApiManager' | tail -80 || true
}

run_flow() {
  echo "--- maestro: $1"
  if ! timeout 600 maestro test -e OUT="$out" -e TODAY="$today" --test-output-dir "$out/maestro" "$1" 2>&1 | tee "$out/maestro-$(basename "$1" .yaml).log"; then
    diagnose "$1"
    return 1
  fi
}

# waits up to 20 seconds for a fixed string in today's note.
wait_for_note() {
  for _ in $(seq 1 20); do
    adb shell cat "$note" 2> /dev/null | grep -qF -- "$1" && return 0
    sleep 1
  done
  echo "today's note does not contain: $1"
  adb shell cat "$note" || true
  return 1
}

fixture_hashes() {
  (cd "$1" && find . -type f ! -path "./Daily/$today.md" -exec sha256sum {} + | sort -k2)
}

check_fixture() {
  rm -rf "$out/vault"
  adb pull "$vault" "$out/vault" > /dev/null
  fixture_hashes tests/fixtures/vault-basic > "$out/before.txt"
  fixture_hashes "$out/vault" > "$out/after-$1.txt"
  diff "$out/before.txt" "$out/after-$1.txt"
}

# maestro 2.11.0 is the release the ios flows use (t12); the install script reads MAESTRO_VERSION.
export MAESTRO_VERSION=2.11.0
export PATH="$HOME/.maestro/bin:$PATH"
if ! command -v maestro > /dev/null; then
  echo "installing maestro $MAESTRO_VERSION"
  curl -fsSL "https://get.maestro.mobile.dev" | bash
fi
maestro --version

run_flow tests/e2e/android/pick-vault.yaml
wait_for_note "# $today"
echo "--- Daily/$today.md"
adb shell cat "$note"
printf -- '---\ncreated: %s ' "$today" > "$out/expected-prefix.txt"
adb exec-out cat "$note" | head -c "$(wc -c < "$out/expected-prefix.txt")" | cmp - "$out/expected-prefix.txt"
check_fixture launch

run_flow tests/e2e/android/today-write.yaml
wait_for_note "Typed on the emulator."
wait_for_note "## Styled heading"
check_fixture typing

run_flow tests/e2e/android/relaunch-search.yaml
check_fixture relaunch
echo "--- Daily/$today.md after the flows"
adb shell cat "$note"
