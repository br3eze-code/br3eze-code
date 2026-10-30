# Br3eze OS — Level 3 Linux Distribution

Br3eze OS starts as a reproducible Debian Live-based distribution, not a new kernel. It boots a real Linux kernel and uses Linux drivers, process/memory management, namespaces and systemd. This is the fastest credible route to a standalone OS while keeping hardware support broad.

## Scope of this slice

- Reproducible ISO-hybrid build using Debian Live (live-build).
- Bootable console environment with NetworkManager, systemd, diagnostics, and recovery instructions.
- AgentOS integration is an optional host service, not PID 1 and not a privileged kernel component.
- CI builds the image artifact on manual dispatch and version tags.
- Build metadata and checksums are emitted with the ISO.

## Build locally (Debian/Ubuntu)

Install live-build, debootstrap, xorriso, squashfs-tools, and sudo, then run:

    sudo ./os/level3/build-live-image.sh

The generated ISO is placed in out/. Building a live ISO requires Linux and root privileges. Do not flash it to a disk containing data you need.

## Boot and recovery

1. Test the ISO in QEMU/VirtualBox before using physical hardware.
2. Select the live boot entry; the default is a non-persistent live session.
3. Use systemctl --failed, journalctl -b, ip link, and nmcli device status for diagnostics.
4. If boot fails, use the firmware boot menu and return to the existing operating system. The image does not repartition or install to disks automatically.

## Security boundaries

This first image is a bootable Linux distribution, not a hardened appliance yet. It does not automatically enable remote SSH, install to internal disks, grant workloads host privileges, or claim to sandbox AgentOS plugins. Do not run untrusted workloads as root. A production release still needs signed artifacts, secure boot policy, tested update/rollback, installer UX, hardware matrix testing, and an isolation design for third-party workloads.

## Roadmap

- **L3.1:** bootable reproducible live ISO and smoke tests.
- **L3.2:** signed image releases, SBOM, artifact provenance, update/rollback strategy.
- **L3.3:** optional AgentOS system service under a dedicated unprivileged account.
- **L3.4:** installer, persistence setup, recovery partition, desktop profile.
- **L3.5:** hardware qualification and threat-model review.

The Linux kernel and Debian packages remain upstream components; this project integrates and configures them rather than forking a kernel.
