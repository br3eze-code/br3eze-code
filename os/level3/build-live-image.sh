#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OS_DIR="$ROOT/os/level3"
WORK_DIR="${BR3EZE_LIVE_WORK_DIR:-$ROOT/.build/live}"
OUT_DIR="${BR3EZE_OUT_DIR:-$ROOT/out}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 2
fi

for tool in lb debootstrap xorriso mksquashfs; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing required tool: $tool (install live-build debootstrap xorriso squashfs-tools)" >&2
    exit 2
  }
done

mkdir -p "$WORK_DIR" "$OUT_DIR"
rm -rf "$WORK_DIR"/*
cp -a "$OS_DIR/live-build/." "$WORK_DIR/"
cd "$WORK_DIR"

lb config
lb build

ISO="$(find "$WORK_DIR" -maxdepth 1 -type f \( -name '*.iso' -o -name '*.hybrid.iso' \) -print -quit)"
if [[ -z "$ISO" ]]; then
  echo "live-build completed without producing an ISO" >&2
  exit 1
fi

VERSION="$(date -u +%Y%m%d)"
DEST="$OUT_DIR/br3eze-os-$VERSION.iso"
install -m 0644 "$ISO" "$DEST"
sha256sum "$DEST" > "$DEST.sha256"
printf 'Built %s\n' "$DEST"
