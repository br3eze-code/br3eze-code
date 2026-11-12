---
name: node-module-compatibility
description: Diagnose Node.js runtime, ESM/CommonJS interoperability, package exports, version, dependency, and platform compatibility issues. Use for import errors, startup failures, build issues, package changes, and cross-environment bugs.
---

# Node.js and Module Compatibility

1. Verify the actual `package.json` fields (`type`, `main`, `exports`, `engines`, scripts) and the runtime version used by local development and CI.
2. Treat repository documentation as potentially stale. If it conflicts with package metadata or observed boot paths, investigate and report the discrepancy; do not silently choose one.
3. Trace the actual executable and imports to establish whether a file runs in ESM or CommonJS context. Do not infer module mode from extension alone when package scope matters.
4. Check package exports, default/named exports, dynamic imports, require bridges, file extensions, path casing, and supported Node versions.
5. Avoid dependency upgrades or module-system conversions unrelated to the fix.
6. Test the affected import/startup path and the repository's syntax/build/test gates.
7. Report verified runtime/module facts separately from assumptions and identify any documentation that needs correction.
