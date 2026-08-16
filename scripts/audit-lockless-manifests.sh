#!/usr/bin/env bash
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="$repo/.security-review/multi-manifest/raw/lockless"
mkdir -p "$out"
: > "$out/status.tsv"
find "$repo" -path '*/node_modules' -prune -o -path '*/.git' -prune -o -path '*/.security-review' -prune -o -type f -name package.json -print | sort | while IFS= read -r manifest; do
  dir="$(dirname "$manifest")"
  rel="${dir#$repo/}"
  [ "$rel" = "$dir" ] && rel="root"
  safe="$(printf '%s' "$rel" | tr '/ ' '__' | tr -cd '[:alnum:]_.-')"
  work="$(mktemp -d)"
  cp "$manifest" "$work/package.json"
  set +e
  (cd "$work" && timeout 90 npm install --package-lock-only --ignore-scripts --no-audit --no-fund > install.log 2>&1)
  install_rc=$?
  if [ "$install_rc" -eq 0 ] && [ -f "$work/package-lock.json" ]; then
    (cd "$work" && npm audit --json --package-lock-only > "$out/$safe.json" 2> "$out/$safe.err")
    audit_rc=$?
  else
    audit_rc=125
  fi
  set -e
  printf '%s\t%s\t%s\t%s\n' "$rel" "$safe" "$install_rc" "$audit_rc" >> "$out/status.tsv"
  cp "$work/install.log" "$out/$safe.install.log"
  rm -rf "$work"
done
printf '%s\n' '--- lockless audit status ---'
cat "$out/status.tsv"
