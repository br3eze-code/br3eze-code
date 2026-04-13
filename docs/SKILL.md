# Available Skills & Tools

## Core Router Skills
- `user.add` — Add new hotspot user
- `user.kick <username>` — Disconnect user
- `user.status <username>` — Show user details
- `users.active` — List currently connected users
- `system.stats` — CPU, memory, uptime
- `system.logs` — Recent RouterOS logs
- `ping <host>` — Ping test
- `traceroute <host>` — Traceroute
- `firewall.list` — Show firewall rules
- `reboot` — Safe router reboot (with confirmation)

## Voucher System
- `voucher create <duration>` — e.g. `voucher create 1Day`
- `voucher list`
- `voucher revoke <code>`

## Network Tools
- `network ping`, `network scan`, `network block <ip>`, `network unblock <ip>`

## AI Capabilities
The AI uses ReAct reasoning and can chain multiple skills automatically.

**Security Rules**:
- Never expose passwords
- Always confirm destructive actions (kick, reboot, block)
- All changes are logged with audit trail

New skills can be added by placing them in the `skills/` folder and updating `manifest.yaml`.
