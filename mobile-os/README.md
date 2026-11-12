# AgentOS Mobile OS workspace

This directory holds the **build orchestration and provenance**, not the Android/GrapheneOS source tree. Keep the OS checkout outside this Node.js repository: AOSP and GrapheneOS span hundreds of Git repositories and use a manifest-driven checkout. Vendoring them into the AgentOS runtime repository would create an enormous, difficult-to-update, license-mixed monorepo.

## First milestone: clean AOSP emulator baseline

The initial target is the generic Android emulator, not a physical device. This proves the source/build pipeline without pretending we have selected a device vendor or have firmware/vendor blobs.

Pinned baseline:
- Project: Android Open Source Project (AOSP)
- Manifest: `https://android.googlesource.com/platform/manifest`
- Release tag: `android-17.0.0_r1`
- Tag commit: `5bc9a7ce1cd78dd53613bbfd0ebf506e1e4adb0f`
- Target: `sdk_phone64_x86_64-userdebug`
- Source lock: generated `.agentos/manifest.lock.xml` from `repo manifest -r` after sync

The release tag is a starting baseline, not a promise of current security patch level. Before any device release, choose a supported device and a current supported AOSP security release, then pin the exact manifest and device/vendor revisions.

## Host requirements

Use a dedicated x86_64 Linux machine/VM with Bash, Git, Python 3, GPG, OpenSSH, `repo`, and the dependencies documented by AOSP. Google currently documents at least 64 GB RAM and 400 GB free disk for checkout plus build. The scripts stop when basic host capacity is insufficient. Do not run the full OS checkout on a small production server or inside this Node runtime's deployment environment.

Official setup reference: https://source.android.com/docs/setup/start/requirements

## Bootstrap

From the repository root, on the dedicated Linux build host:

```bash
bash mobile-os/scripts/bootstrap-aosp.sh "$HOME/agentos-os/aosp"
```

The script checks Linux, required tools, memory and disk; initializes the pinned AOSP tag; syncs the manifest; writes a revision-locked manifest; and hashes it. It does **not** add OS source to this repository.

## Build

```bash
bash mobile-os/scripts/build-aosp-emulator.sh "$HOME/agentos-os/aosp"
```

This uses AOSP's own build environment and `sdk_phone64_x86_64-userdebug`. Build provenance is written outside the source tree under `.agentos/evidence/`, including the locked manifest checksum, host details, target and build metadata. A successful command is a build result, not a security certification or a bit-for-bit reproducibility claim.

## What “reproducible” means here

1. Start from a named, immutable AOSP release tag.
2. Save `repo manifest -r` so every checked-out project is locked to a commit.
3. Record host OS/kernel, build target, environment, manifest checksum, source revision and build metadata.
4. Rebuild from the same locked manifest and compare artifacts/checksums. Investigate differences; do not call the build bit-reproducible until independent clean builds actually match.
5. Keep signing keys out of Git and outside CI logs. Release signing is a separate controlled step.

## GrapheneOS source and patch ledger

After the AOSP emulator baseline builds, use the official GrapheneOS source manifest as a **separate reference checkout**. Its manifest selects many upstream AOSP projects plus GrapheneOS forks and unique projects; it is not one repository to copy into this Node project. Record each candidate patch's upstream repository, exact commit, license, AOSP base, files, threat addressed, tests, device constraints, and decision in `security-patch-ledger.csv`.

Official source map: https://grapheneos.org/source  
Feature overview: https://grapheneos.org/features  
Build guide: https://grapheneos.org/build

Do not cherry-pick the whole GrapheneOS tree onto AOSP. Review and port changes in small, independently testable units. Preserve license notices and attribution. Some components are built separately or supplied as prebuilts, and some changes depend on specific supported hardware.

## AgentRuntime boundary

The Android OS workspace is separate from the Node.js AgentOS harness. Runtime permissions, scoped tool access, approvals, audit/redaction, revocation and fail-closed execution remain runtime responsibilities. Kernel, SELinux, verified boot, system-wide USB/sensor/clipboard controls, and hardware-backed attestation require Android platform/device changes; a Node process cannot enforce them.

**No physical-device target, GrapheneOS patch, bootable AgentOS release, or security certification is claimed by this bootstrap.**
