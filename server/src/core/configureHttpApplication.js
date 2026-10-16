/**
 * Domain-agnostic HTTP application setup.
 *
 * This module owns only cross-cutting transport concerns. It deliberately
 * accepts framework/middleware implementations and a static directory from
 * the composition root; it knows nothing about AgentOS, Wi-Fi, vouchers,
 * payments, Firebase, or any network vendor.
 */

/**
 * Configure baseline HTTP middleware on an Express-compatible application.
 *
 * @param {{
 *   express: { json: (options: object) => unknown, static: (directory: string) => unknown },
 *   helmet: (options: object) => unknown,
 *   cors: () => unknown,
 *   staticDirectory: string,
 *   app?: { use: (...middleware: unknown[]) => unknown }
 * }} options
 * @returns {unknown} the configured application
 */
export function configureHttpApplication({ app, express, helmet, cors, staticDirectory }) {
    if (!app || typeof app.use !== 'function') {
        throw new TypeError('app must expose use()');
    }
    if (!express || typeof express.json !== 'function' || typeof express.static !== 'function') {
        throw new TypeError('express must provide json() and static() middleware');
    }
    if (typeof helmet !== 'function' || typeof cors !== 'function') {
        throw new TypeError('helmet and cors middleware factories are required');
    }
    if (typeof staticDirectory !== 'string' || staticDirectory.length === 0) {
        throw new TypeError('staticDirectory must be a non-empty path');
    }

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:']
            }
        }
    }));
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.static(staticDirectory));
    return app;
}

export default configureHttpApplication;
