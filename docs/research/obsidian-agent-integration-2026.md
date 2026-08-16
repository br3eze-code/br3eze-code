# Obsidian Agent Integration Research

## Sources

- https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache — official MetadataCache reference.
- https://obsidian.md/help/uri — official Obsidian URI documentation.
- https://github.com/obsidianmd/obsidian-api — official Obsidian API type definitions and plugin guidance.

## Findings

Obsidian's MetadataCache exposes resolved and unresolved links and file metadata. `getFileCache(file)` and `getFirstLinkpathDest(linkpath, sourcePath)` are the supported primitives for graph-aware note context. Cache updates are emitted through the `changed` event; rename and delete events must also be handled through the vault event system.

Obsidian URI supports cross-app automation through `obsidian://action?...`, including `open`, `new`, `daily`, `unique`, `search`, and `choose-vault`. URI values must be percent-encoded. The `open` and `new` actions support a vault plus a vault-relative file path; absolute paths are supported through the `path` parameter. On Linux, URI integration requires an `obsidian.desktop` file whose `Exec` field includes `%u`.

The official API guidance describes a plugin as a bundled `main.js` with a default class extending `Plugin`. Vault operations belong behind the `Vault` interface, graph metadata behind `MetadataCache`, and plugin lifecycle listeners should be registered with `registerEvent`, `registerDomEvent`, and `registerInterval` so they are detached on unload.

## Design implications for AgentOS

AgentOS should treat Obsidian as an optional local workspace adapter rather than a required backend. File access must remain vault-relative and path-confined; graph context should be a bounded, privacy-safe projection of links, tags, headings, and frontmatter; mutations should require identity, tenant/domain/site scope, and approval; and external opening should use encoded Obsidian URIs rather than shell command concatenation. The adapter should support degraded mode when Obsidian is unavailable and should never transmit raw vault contents without explicit user scope.
