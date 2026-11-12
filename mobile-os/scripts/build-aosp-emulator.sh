#!/usr/bin/env bash
set -Eeuo pipefail

WORKSPACE="${1:-$HOME/agentos-os/aosp}"
TARGET="sdk_phone64_x86_64-userdebug"
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || fail "AOSP build requires Linux."
[[ -f "$WORKSPACE/build/envsetup.sh" ]] || fail "No AOSP source tree at $WORKSPACE; run bootstrap-aosp.sh first."
[[ -s "$WORKSPACE/.agentos/manifest.lock.xml" ]] || fail "Locked source manifest is missing."
[[ -s "$WORKSPACE/.agentos/manifest.lock.sha256" ]] || fail "Manifest checksum is missing."
(
  cd "$WORKSPACE"
  sha256sum --check .agentos/manifest.lock.sha256
)

# AOSP envsetup requires Bash. Run all build setup in this process.
cd "$WORKSPACE"
# shellcheck disable=SC1091
source build/envsetup.sh
lunch "$TARGET"

# Use the pinned release's manifest commit timestamp as a stable build-time input.
release_epoch="$(git -C .repo/manifests show -s --format=%ct android-17.0.0_r1^{commit})"
export BUILD_DATETIME="$release_epoch"
export BUILD_NUMBER="agentos-aosp-android-17.0.0_r1"
export SOURCE_DATE_EPOCH="$release_epoch"
jobs="${BUILD_JOBS:-$(nproc)}"
[[ "$jobs" =~ ^[1-9][0-9]*$ ]] || fail "BUILD_JOBS must be a positive integer."

mkdir -p .agentos/evidence
evidence=".agentos/evidence/build-$(date -u +%Y%m%dT%H%M%SZ).txt"
{
  printf 'product=AgentOS AOSP emulator baseline\n'
  printf 'target=%s\n' "$TARGET"
  printf 'release_tag=android-17.0.0_r1\n'
  printf 'manifest_lock_sha256=%s\n' "$(awk '{print $1}' .agentos/manifest.lock.sha256)"
  printf 'host_kernel=%s\n' "$(uname -srmo)"
  printf 'host_os=%s\n' "$(. /etc/os-release; printf '%s %s' "${ID:-unknown}" "${VERSION_ID:-unknown}")"
  printf 'build_datetime=%s\n' "$BUILD_DATETIME"
  printf 'build_number=%s\n' "$BUILD_NUMBER"
  printf 'jobs=%s\n' "$jobs"
  printf 'started_at_utc=%s\n' "$(date -u +%FT%TZ)"
} > "$evidence"

m -j"$jobs"

{
  printf 'finished_at_utc=%s\n' "$(date -u +%FT%TZ)"
  printf 'build_date_file='
  [[ -f out/build_date.txt ]] && cat out/build_date.txt || printf 'missing\n'
  printf 'build_number_file='
  [[ -f out/build_number.txt ]] && cat out/build_number.txt || printf 'missing\n'
  printf 'artifact_inventory_sha256_begin\n'
  find "out/target/product" -maxdepth 3 -type f \( -name '*.img' -o -name '*.zip' -o -name '*.bin' \) -print0 2>/dev/null \
    | sort -z | xargs -0 -r sha256sum
} >> "$evidence"

printf '\nBuild command completed. Evidence: %s/%s\n' "$WORKSPACE" "$evidence"
printf 'This is not a security certification or proof of independent bit-for-bit reproducibility. Repeat from a clean workspace and compare artifact hashes.\n'
