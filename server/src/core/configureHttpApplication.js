/**
 * Build the shared HTTP middleware stack without importing a product domain.
 * Domain routes are mounted by the application composition root after this setup.
 */
export function configureHttpApplication({
    express,
    helmet,
    cors,
    staticDirectory,
    jsonLimit = '1mb'
}) {
    if (typeof express !== 'function' || typeof express.json !== 'function' || typeof express.static !== 'function') {
        throw new TypeError('configureHttpApplication requires an Express factory with json() and static() middleware');
    }
    if (typeof helmet !== 'function' || typeof cors !== 'function') {
        throw new TypeError('configureHttpApplication requires helmet and cors middleware');
    }
    if (typeof staticDirectory !== 'string' || !staticDirectory.trim()) {
        throw new TypeError('configureHttpApplication requires a static directory');
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
    const configuredOrigins = String(process.env.AGENTOS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const allowedOrigins = new Set([
        'https://br3eze.africa',
        'https://www.br3eze.africa',
        'https://br3eze-code.vercel.app',
        'https://localhost',
        'http://localhost',
        ...configuredOrigins
    ]);
    app.use(cors({
        origin(origin, callback) {
            // Non-browser clients often omit Origin; browser origins must be allowlisted.
            callback(null, !origin || allowedOrigins.has(origin));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
        maxAge: 600
    }));
    app.use(express.json({ limit: jsonLimit }));
    app.use(express.static(staticDirectory));
    return app;
}
