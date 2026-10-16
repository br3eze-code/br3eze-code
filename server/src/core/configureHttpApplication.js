/**
 * Domain-agnostic HTTP application setup.
 *
 * This module owns only cross-cutting transport concerns. It deliberately
 * accepts framework/middleware implementations and a static directory from
 * the composition root; it knows nothing about product domains, persistence,
 * identity providers, payments, or network vendors.
 */

/**
 * Create an Express-compatible app and install baseline HTTP middleware.
 *
 * @param {{
 *   express: Function & { json: (options: object) => unknown, static: (directory: string) => unknown },
 *   helmet: (options: object) => unknown,
 *   cors: () => unknown,
 *   staticDirectory: string
 * }} options
 * @returns {unknown} the configured application
 */
export function configureHttpApplication({ express, helmet, cors, staticDirectory }) {
    if (typeof express !== 'function' || typeof express.json !== 'function' || typeof express.static !== 'function') {
        throw new TypeError('express must provide an app factory, json(), and static() middleware');
    }
    if (typeof helmet !== 'function' || typeof cors !== 'function') {
        throw new TypeError('helmet and cors middleware factories are required');
    }
    if (typeof staticDirectory !== 'string' || staticDirectory.length === 0) {
        throw new TypeError('staticDirectory must be a non-empty path');
    }

    const app = express();
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
