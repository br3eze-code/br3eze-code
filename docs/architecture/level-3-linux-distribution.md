# Level 3 — Br3eze Linux distribution architecture

## Decision

Build Br3eze OS as a Linux-based distribution first. Do not write a new kernel. The existing AgentOS runtime remains a user-space application and must not be treated as a security boundary by itself.

The first target is a headless x86-64 appliance ISO. ARM64 and specific mini-PC/router hardware are follow-on targets only after the initial image is reproducible and boot-tested.

## Layering

- Hardware
- UEFI / firmware
- GRUB / live boot
- Linux kernel + upstream drivers
- systemd + OS security and device services
  - NetworkManager / nftables / storage tools
  - Future Br3eze OS management service (not enabled yet)
    - Canonical AgentOS runtime
      - Apps, skills, provider and device adapters
  - Future recovery / update service

## Existing Level 2 components and Level 3 responsibilities

| Concern | Implementation boundary |
| --- | --- |
| Kernel, memory, process scheduling, device drivers | Upstream Linux kernel and distribution packages |
| Boot and init | Debian Live boot flow and systemd |
| OS process lifecycle | systemd units; AgentOS ServiceSupervisor manages application services inside the runtime only |
| App permissions | Linux users/groups, filesystem permissions, AppArmor and explicit capability policy |
| Network isolation | nftables and host network configuration |
| IPC | Level 2 in-process bus is not cross-process IPC; use Unix domain sockets or another authenticated OS IPC transport when required |
| Persistent state | Explicitly mounted persistent storage with permissions and backup policy; live-session state alone is not durable |
| Updates and recovery | Signed, verified update mechanism and rollback are future acceptance gates, not implemented by this image |
| Application distribution | Signed package/manifest format and installation/upgrade transaction are future work |

## Milestones

### L3.0 — Reproducible bootable base (this change)

- Debian Live ISO build configuration.
- Minimal headless package set.
- CI validation and an ISO artifact workflow.
- SHA-256 checksum for artifact integrity checking (not a signature).

### L3.1 — Boot and hardware verification

- Boot in QEMU/KVM; capture serial/console output.
- Verify kernel startup, systemd target, Ethernet, Wi-Fi discovery where supported, DNS, storage discovery, shutdown and reboot.
- Maintain a tested hardware matrix. Never infer device compatibility from a successful ISO build.

### L3.2 — Install, persist and recover

- Installer with explicit target-disk confirmation and safeguards.
- Persistent data partition, permissions, optional disk encryption and documented recovery.
- Recovery environment that can repair or roll back a failed system update.

### L3.3 — Managed update and trust chain

- Build provenance and software bill of materials.
- Sign release manifests and images; verify signatures before installation.
- Atomic/A-B or equivalent rollback-capable updates, health checks, interrupted-update recovery, and release-channel policy.
- A checksum alone is not authenticity or a secure update system.

### L3.4 — AgentOS integration

- Define a stable CLI entry point and health/readiness contract first.
- Install AgentOS as a dedicated unprivileged service account, not root.
- Add systemd unit hardening such as NoNewPrivileges, filesystem protections, and restricted address families/capabilities as compatible.
- Pass device operations through explicit privileged adapters or narrow helper services; never grant the AI runtime unrestricted shell/root access.
- Store credentials in a host-managed secret store or protected files; never bake secrets into the image.

### L3.5 — Target hardware and release readiness

- Test supported x86-64 appliance targets and then ARM64.
- Verify thermal/power behavior, network recovery, offline operation, update rollback and long-duration stability.
- Publish supported hardware, known limitations, installation instructions and recovery procedures.

## Security model

The Linux host is the primary isolation boundary. Node.js modules and AgentOS application manifests are not a sandbox. Treat all app manifests, provider output, tool arguments, downloaded packages and IPC messages as untrusted. Require host-side authorization, resource limits, audit trails, signature verification, and least privilege at every trust boundary.

## Current limitations

- The current artifact is a live ISO, not an installer image or complete desktop environment.
- No custom kernel or custom hardware drivers.
- No automated VM boot test or physical hardware certification yet.
- No AgentOS service enabled at boot until its real launch/health contract is verified.
- No signed updates, A/B partitioning, secure boot enrollment, or recovery partition yet.
- The ISO build and package list must pass CI before claiming the image is reproducible.
