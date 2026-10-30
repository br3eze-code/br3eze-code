# Br3eze OS — Level 3 Linux distribution foundation

This directory starts a **bootable Linux distribution**, not a new kernel. It uses Debian Live and the Linux kernel so the project can focus on the OS integration, security policy, device support, update/recovery path, and application environment instead of reimplementing mature kernel subsystems.

## Scope of this first milestone

- Reproducible amd64 live ISO build using Debian Live.
- Linux kernel and standard discovery/networking tools.
- systemd service management, NetworkManager, SSH, nftables, AppArmor, storage and diagnostic utilities.
- A build workflow that publishes the ISO as a GitHub Actions artifact.

This is a headless appliance base. It is **not yet a production installer or a validated hardware image**. The live session is not a substitute for persistent installation. Do not deploy it to routers or production machines until boot, NIC/Wi-Fi, storage, update, recovery, and security tests pass on target hardware.

## Build locally

On a Debian/Ubuntu build host with root-capable build tools:

```sh
cd os/level3
sudo apt-get update
sudo apt-get install -y live-build debootstrap xorriso squashfs-tools
bash build-image.sh
```

The resulting ISO is produced in `os/level3/br3eze-os-amd64.hybrid.iso` (or the path reported by live-build). The script deliberately refuses to run as root directly; invoke it with a normal user that can use `sudo`.

## Security and support boundaries

- This image uses Debian's kernel and drivers; it does not create custom drivers or a new kernel.
- The current image has no Br3eze-specific root service enabled. AgentOS needs a stable CLI/service entry point and an explicit host policy before being enabled at boot.
- No default password, SSH key, API key, or cloud credential is baked into the image.
- SSH is installed but must be explicitly configured for the deployment environment.
- AppArmor and nftables are installed; installation alone does not mean a complete policy has been authored or enforced.
- This initial image does not yet provide A/B updates, signed image verification, encrypted persistent state, a first-boot setup wizard, or a tested recovery partition.

## Level 3 acceptance gates

1. Build ISO deterministically in CI and retain build logs + checksums.
2. Boot in a VM and record kernel, systemd, networking, and shutdown checks.
3. Test on declared hardware targets; maintain a driver compatibility matrix.
4. Add a persistent installer with disk selection safeguards and recovery.
5. Add signed updates with rollback and offline recovery.
6. Integrate AgentOS as a least-privilege systemd service only after its startup contract is verified.
7. Threat-model device permissions, IPC, secrets, update trust, and physical access.

See [the Level 3 architecture plan](../../docs/architecture/level-3-linux-distribution.md).
