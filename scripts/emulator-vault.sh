#!/usr/bin/env bash
# copies a vault folder to a running android emulator, and later shows what the app changed in
# that copy. the source folder is only read: nothing is ever written to it, moved, or deleted.
#
#   scripts/emulator-vault.sh push <vault folder> [name]
#   scripts/emulator-vault.sh check <name>
#
# push copies the folder to the emulator's Documents/<name> (the name defaults to the folder's
# name) and records a sha-256 manifest of the copied files in .fixtures/emulator/, which git
# ignores. it refuses when Documents/<name> already exists on the emulator, so an earlier copy
# is never replaced. in the app, choose Documents/<name> with "Choose Folder".
#
# check pulls the emulator's copy into .fixtures/emulator/ and lists the files that were added,
# changed, or removed since push, by path only. no file contents are printed.
#
# the vault's notes stay on this computer and the emulator; keep them out of the repository.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work="$root/.fixtures/emulator"

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

# a folder name under Documents: no slashes, quotes, or leading dot.
check_name() {
  case "$1" in
    '' | .* | */* | *"'"* | *'"'*) echo "unsuitable name: $1" >&2; exit 2 ;;
  esac
}

# exactly one booted device or emulator.
require_device() {
  command -v adb > /dev/null || { echo "adb is not on PATH; install the Android SDK platform tools" >&2; exit 1; }
  local devices
  devices=$(adb devices | awk 'NR > 1 && $2 == "device"' | wc -l | tr -d ' ')
  if [ "$devices" != 1 ]; then
    echo "need exactly one running emulator or device; adb lists $devices" >&2
    adb devices >&2
    exit 1
  fi
  [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ] || { echo "the emulator has not finished booting" >&2; exit 1; }
}

# "<sha-256>  ./relative/path" for every file in a folder, sorted by path.
manifest() {
  (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256)
}

[ "$#" -ge 2 ] || usage
command=$1
shift

case "$command" in
  push)
    source=$1
    [ -d "$source" ] || { echo "not a folder: $source" >&2; exit 1; }
    source=$(cd "$source" && pwd)
    name=${2:-$(basename "$source")}
    check_name "$name"
    require_device
    target="/sdcard/Documents/$name"
    if [ "$(adb shell "test -e '$target' && echo yes || echo no" | tr -d '\r')" = yes ]; then
      echo "the emulator already has $target; pass another name, or remove it on the emulator yourself" >&2
      exit 1
    fi
    # older icloud versions leave hidden ".<name>.icloud" stubs for files that are not downloaded;
    # the copy would lack those notes, so they are listed rather than copied silently.
    stubs=$(find "$source" -name '.*.icloud' -type f | wc -l | tr -d ' ')
    if [ "$stubs" != 0 ]; then
      echo "$stubs files in the vault are not downloaded from iCloud (.icloud stubs); download them first, for example with Finder's Download Now" >&2
      exit 1
    fi
    files=$(find "$source" -type f | wc -l | tr -d ' ')
    echo "copying $files files ($(du -sh "$source" | cut -f1)) to $target"
    mkdir -p "$work"
    manifest "$source" > "$work/$name.pushed.sha256"
    adb shell mkdir -p /sdcard/Documents
    adb push "$source" "$target" > /dev/null
    # the copy on the emulator must match what was read.
    rm -rf "$work/$name.pulled"
    adb pull "$target" "$work/$name.pulled" > /dev/null
    manifest "$work/$name.pulled" > "$work/$name.copied.sha256"
    if ! cmp -s "$work/$name.pushed.sha256" "$work/$name.copied.sha256"; then
      echo "the copy on the emulator differs from the vault folder:" >&2
      diff "$work/$name.pushed.sha256" "$work/$name.copied.sha256" | sed -n 's/^\([<>]\) [0-9a-f]*  /\1 /p' >&2
      exit 1
    fi
    echo "copied and checked $files files; in the app, choose Documents/$name"
    ;;
  check)
    name=$1
    check_name "$name"
    [ -f "$work/$name.pushed.sha256" ] || { echo "no push of $name is recorded in $work" >&2; exit 1; }
    require_device
    rm -rf "$work/$name.pulled"
    adb pull "/sdcard/Documents/$name" "$work/$name.pulled" > /dev/null
    manifest "$work/$name.pulled" > "$work/$name.now.sha256"
    # paths only: added (+), removed (-), and changed (~) since push.
    awk '
      FNR == 1 { file++ }
      { hash = $1; sub(/^[0-9a-f]+  \.\//, ""); if (file == 1) before[$0] = hash; else after[$0] = hash }
      END {
        for (path in after) if (!(path in before)) print "+ " path; else if (before[path] != after[path]) print "~ " path
        for (path in before) if (!(path in after)) print "- " path
      }' "$work/$name.pushed.sha256" "$work/$name.now.sha256" | LC_ALL=C sort -k2 > "$work/$name.changes.txt"
    if [ -s "$work/$name.changes.txt" ]; then
      echo "changes in Documents/$name since push (+ added, ~ changed, - removed):"
      cat "$work/$name.changes.txt"
    else
      echo "no file in Documents/$name changed since push"
    fi
    ;;
  *)
    usage
    ;;
esac
