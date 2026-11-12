#!/usr/bin/env bash
set -Eeuo pipefail

readonly AOSP_MANIFEST_URL="https://android.googlesource.com/platform/manifest"
readonly AOSP_TAG="android-17.0.0_r1"
readonly AOSP_TAG_COMMIT="5bc9a7ce1cd78dd53613bbfd0ebf506e1e4adb0f"
WORKSPACE="${1:-$HOME/agentos-os/aosp}"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"; }

[[ "$(uname -s)" == "Linux" ]] || fail "AOSP build workspace requires Linux."
[[ "$(uname -m)" == "x86_64" ]] || fail "Initial target is an x86_64 Linux build host."
for command in repo git python3 gpg ssh; do need "$command"; done
need df
need awk
need sha256sum

# AOSP's documented minimum is 64 GB RAM and 400 GB free disk for checkout + build.
mem_kib="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
(( mem_kib >= 60 * 1024 * 1024 )) || fail "Need at least 60 GiB reported RAM (AOSP recommends 64 GB); found $((mem_kib / 1024 / 1024)) GiB."
mkdir -p "$(dirname "$WORKSPACE")"
available_kib="$(df -Pk "$(dirname "$WORKSPACE")" | awk 'NR==2 {print $4}')"
(( available_kib >= 400 * 1024 * 1024 )) || fail "Need at least 400 GiB free disk; found $((available_kib / 1024 / 1024)) GiB."
[[ ! -e "$WORKSPACE" ]] || fail "Workspace already exists: $WORKSPACE. Inspect it and choose a new path; this script will not overwrite it."

mkdir -p "$WORKSPACE"
cd "$WORKSPACE"
repo init -u "$AOSP_MANIFEST_URL" -b "$AOSP_TAG"
manifest_head="$(git -C .repo/manifests rev-parse HEAD)"
tag_commit="$(git -C .repo/manifests rev-parse "$AOSP_TAG^{commit}")"
[[ "$tag_commit" == "$AOSP_TAG_COMMIT" ]] || fail "AOSP tag resolved to unexpected commit: $tag_commit"
printf 'Manifest checkout: %s\nTag commit: %s\n' "$manifest_head" "$tag_commit"

repo sync -c -j8 --fail-fast
mkdir -p .agentos
repo manifest -r -o .agentos/manifest.lock.xml
sha256sum .agentos/manifest.lock.xml > .agentos/manifest.lock.sha256

cat > .agentos/source-lock.txt <<EOF
product=AgentOS
baseline=AOSP
manifest_url=$AOSP_MANIFEST_URL
release_tag=$AOSP_TAG
release_tag_commit=$AOSP_TAG_COMMIT
manifest_checkout_commit=$manifest_head
target=sdk_phone64_x86_64-userdebug
manifest_lock_sha256=$(awk '{print $1}' .agentos/manifest.lock.sha256)
EOF

printf '\nAOSP source sync completed.\n'
printf 'Locked manifest: %s/.agentos/manifest.lock.xml\n' "$WORKSPACE"
printf 'Next: bash mobile-os/scripts/build-aosp-emulator.sh "%s"\n' "$WORKSPACE"
