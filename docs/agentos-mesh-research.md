# AgentOS Multi-MikroTik Mesh Research

## Findings

### MikroTik RouterOS WireGuard
Source: https://help.mikrotik.com/docs/spaces/ROS/pages/69664792/WireGuard

RouterOS documents WireGuard as a cross-platform, encrypted VPN with peer public keys, allowed-address controls, persistent keepalive for peers behind NAT, and explicit routing/firewall requirements. Its site-to-site example uses a central encrypted interface, peer-specific allowed networks, /30 tunnel addresses, and routes for remote LANs. The design implication for AgentOS is to use outbound-initiated site tunnels and never expose RouterOS API/Winbox directly to the public internet.

### MikroTik Back To Home
Source: https://help.mikrotik.com/docs/spaces/ROS/pages/197984280/Back+To+Home

Back To Home provides encrypted remote VPN access even when the router is behind NAT or a firewall, using direct connections or MikroTik relay servers. It supports guest tunnels with expiration and an `allow-lan` choice. MikroTik explicitly describes it as a convenience feature and recommends manually configured advanced RouterOS VPN controls for more granular security. It is useful for one-off owner access, but not sufficient as the primary multi-tenant AgentOS control plane.

### Tailscale subnet routers
Source: https://tailscale.com/docs/features/subnet-routers

Tailscale subnet routers extend a secure tailnet to devices that cannot run a client, including legacy devices, cameras, and whole private subnets. The documentation emphasizes centralized access-control rules, route approval, and default SNAT behavior. This is a practical managed-mesh reference for connecting a local gateway or Linux edge node to a site while keeping the AgentOS control plane separate from the device LAN.
