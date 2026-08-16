# Security inventory findings

Date: 2026-08-16

The GitHub Dependabot API request for `br3eze-code/br3eze-code` returned HTTP 403: `Resource not accessible by integration`. The live alert records could not be enumerated with the current GitHub integration.

The repository push output reported the following aggregate on the default branch: 131 vulnerabilities total, 7 critical, 70 high, 44 moderate, and 10 low.

Local `npm audit --json` for the root package reported: 16 moderate, 0 high, 0 critical, 0 low. This local result is not equivalent to the GitHub Dependabot inventory and does not identify the 7 critical or 70 high alerts.

Dependency manifests found include the root `package-lock.json` and `package.json`, server/package.json, src/runtime/package.json, tools/package.json, numerous Cordova plugin package manifests, and the Cordova SQLite package-lock.json.

Conclusion: produce a remediation plan and reusable workflow, but do not claim package-specific fixes or exact advisory mappings until the Dependabot alert export/API access is available.
