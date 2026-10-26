# Br3eze OS kernel work

## Decision

Build the kernel layer first, before packaging the Br3eze OS userland. For the first kernel milestone, use the upstream Linux kernel source and create a reproducible Br3eze kernel build/configuration pipeline. This is a real Linux kernel build, not a new kernel written from scratch. A new kernel would require architecture bring-up, boot code, memory management, scheduling, interrupts, drivers, filesystems, and a security model before it could run useful workloads.

## Milestones

1. **K1 — Kernel source and config:** pin a reviewed upstream Linux release and its source checksum; keep Br3eze configuration fragments and patches in this directory.
2. **K2 — Reproducible build:** build the kernel and modules for x86_64 in CI, record compiler/config/source metadata, and publish artifacts only after the job succeeds.
3. **K3 — Boot smoke test:** package the kernel into a minimal QEMU boot test; verify console, init, memory, and virtual networking.
4. **K4 — Hardware enablement:** qualify target CPU, storage, Ethernet/Wi-Fi, USB, and firmware combinations.
5. **K5 — Distribution integration:** only after K2/K3 pass, have the Debian Live image consume the built kernel package/artifacts instead of silently using the stock kernel.
6. **K6 — Security and release:** review config, reduce unnecessary drivers/features, produce SBOM/provenance, sign release artifacts, and test rollback/recovery.

## Configuration policy

- Start from the upstream x86_64 defconfig; do not maintain a giant copied config without provenance.
- Store Br3eze-specific changes as a small, reviewable config fragment and merge it with the base using upstream kernel config tooling.
- Enable serial/virtual console, initramfs, virtio block/network, ext4, devtmpfs, procfs, sysfs, namespaces/cgroups needed by the intended platform, and modules where suitable.
- Never claim a config option is enabled until the merged .config has been checked.
- Keep signing keys and release credentials out of the repository and CI logs.
- Do not replace a user's installed kernel or write to a physical disk as part of CI.

## Build contract

The build pipeline must fail closed if the source revision is not pinned, checksums do not match, config merging fails, or the expected kernel image/modules are missing. It must preserve logs and emit a manifest with source revision, config hash, compiler version, architecture, and artifact checksums.

## Current status

This document defines the kernel-first direction. The source fetch, actual compile, QEMU boot test, and artifact publication are not complete until the dedicated workflow proves each stage.
