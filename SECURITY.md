# Security Policy

## Supported Versions

Security fixes are applied to the `main` branch and the latest published release. Older releases should be upgraded before deployment unless a documented exception and compensating controls exist.

## Credential and Signing-Key Policy

The repository must not contain live service-account keys, private keys, keystores, signing-property files, environment files, or unrestricted credential exports. Runtime credentials must be supplied through the deployment platform's secret manager or through explicitly configured local environment variables. Android and iOS signing material must remain in protected CI/CD secrets or a secure local keystore outside the repository.

Firebase Admin authentication must use `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_SERVICE_ACCOUNT`, or platform Application Default Credentials. Client-side Firebase configuration may be generated during the build, but API keys must be restricted by project, application, and API scope.

## Reporting a Vulnerability

Please report security vulnerabilities privately through the repository's GitHub Security Advisories page rather than opening a public issue. Include the affected version or commit, impact, reproduction steps, and any suggested mitigation. Do not include live credentials in the report.

Security reports will be acknowledged within five business days. Maintainers will assess severity, coordinate remediation, and publish a fix or mitigation when appropriate.

## Exposed Credential Response

If a credential or signing key is found in Git history, assume it is compromised. Revoke or rotate it at the issuing provider, replace dependent deployment configuration, remove the file from active branches, and rewrite repository history when appropriate. History rewriting does not replace revocation; both actions are required for live credentials.
