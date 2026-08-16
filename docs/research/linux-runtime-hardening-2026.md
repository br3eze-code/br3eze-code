# Linux Runtime Hardening Research

## Findings

The Linux runtime should prefer a user-scoped systemd service for user-local deployments, use `Type=exec` where supported so startup failures are reported accurately, and keep secrets outside unit files through environment-file or credential injection. The service should retain network access only because the gateway requires it, while narrowing filesystem writes to the AgentOS profile directory.

Systemd hardening guidance consistently recommends layered restrictions rather than a single control. Relevant controls for this runtime include `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome=read-only`, `ReadWritePaths`, `RestrictSUIDSGID`, `LockPersonality`, `SystemCallArchitectures=native`, `RestrictAddressFamilies`, and capability reduction. `systemd-analyze security` should be used after unit changes where systemd is available.

The Linux host adapter must separate diagnostics from mutations. Diagnostics require an authenticated identity context; mutations additionally require an explicit approved action. Remote operations must use allow-listed hosts and validated argument vectors, never transmit sudo passwords, and must avoid interpolating untrusted values into shell command strings.

The implementation must preserve legacy domain tool signatures. Identity context propagation is therefore opt-in at the tool registration boundary, allowing hardened host tools to receive context without changing unrelated AI, network, vision, or voice tools.

## Sources

1. SUSE, “Securing systemd Services”: https://documentation.suse.com/smart/security/html/systemd-securing/index.html
2. NixOS Wiki, “Systemd/Hardening”: https://wiki.nixos.org/wiki/Systemd/Hardening
3. freedesktop.org, “systemd.service”: https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html
4. freedesktop.org, “systemd.exec”: https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html
5. GitHub, “systemd-service-hardening”: https://github.com/alegrey91/systemd-service-hardening
