# Network Topology - AgentOS Discovered Map

## Router: RB5009
- **Identity**: board-name="RB5009UG+S+IN", RouterOS 7.15.2
- **Location**: Bulawayo, ZW, GMT+2
- **Last Scanned**: 2026-04-14

## Interfaces
| Name | Type | Status | IP | Role | Notes |
| --- | --- | --- | --- |
| ether1 | ethernet | unknown | TBD | WAN | NEVER TOUCH - soul.md rule |
| ether2 | ethernet | unknown | TBD | LAN | Hotspot bridge |
| bridge1 | bridge | unknown | 10.5.50.1/24 | Hotspot | Main client network |

## Discovered Rules
- Hotspot server on bridge1
- Address pool: 10.5.50.0/24
- DNS: TBD

## Mesh Nodes
*None discovered yet*

## Update Protocol
When I run 'interfaces', 'ip', or 'routes' tools, I auto-append new data here via 'note' skill.
If I detect changes, I log them with timestamp.
