#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as a normal user; it invokes live-build through sudo." >&2
  exit 2
fi

for tool in sudo lb sha256sum; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required command: $tool" >&2
    exit 127
  fi
done

WORKDIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKDIR"

if [[ ! -f config/package-lists/br3eze.list.chroot ]]; then
  echo "Missing config/package-lists/br3eze.list.chroot" >&2
  exit 1
fi

# Debian Live's configuration is kept in this directory so the image build is reviewable.
sudo lb config \
  --distribution trixie \
  --architectures amd64 \
  --binary-images iso-hybrid \
  --bootappend-live "boot=live components quiet"

sudo rm -f -- binary.hybrid.iso br3eze-os-amd64.hybrid.iso br3eze-os-amd64.hybrid.iso.sha256
sudo lb build

if [[ ! -s binary.hybrid.iso ]]; then
  echo "live-build completed without producing binary.hybrid.iso" >&2
  exit 1
fi

sudo mv -- binary.hybrid.iso br3eze-os-amd64.hybrid.iso
sudo chown "$(id -u):$(id -g)" br3eze-os-amd64.hybrid.iso
sha256sum br3eze-os-amd64.hybrid.iso > br3eze-os-amd64.hybrid.iso.sha256

echo "Built: $WORKDIR/br3eze-os-amd64.hybrid.iso"
echo "SHA-256: $(cut -d ' ' -f 1 br3eze-os-amd64.hybrid.iso.sha256)"
