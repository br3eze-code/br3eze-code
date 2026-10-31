# Br3eze OS image status

## What is implemented

- Debian Live ISO configuration for amd64.
- Linux kernel and firmware package selection through Debian Live.
- NetworkManager, basic diagnostics, systemd, and console recovery notes.
- An opt-in, unprivileged AgentOS systemd unit template with filesystem and kernel hardening directives.
- Pull-request configuration validation and an on-demand/tag-triggered ISO artifact workflow.

## What is not yet verified

- The ISO has not yet been built and booted in a VM from this branch.
- Hardware support has not been qualified on Br3eze's target devices.
- The AgentOS service is not enabled by default and the AgentOS runtime is not bundled into the ISO.
- There is no installer, persistent disk setup, signed update channel, rollback mechanism, secure-boot key management, or independent workload sandbox yet.

## Release gate

Do not call this a production OS release until the ISO build succeeds, the image boots in QEMU with working networking, a reboot/recovery test passes, checksums are verified, and security/update design is reviewed.
