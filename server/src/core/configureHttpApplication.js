/**
 * Build the shared HTTP middleware stack without importing a product domain.
 * Domain routes are mounted by the application composition root after this setup.
 */
export function configureHttpApplication({
    express,
    helmet,
    cors,
    staticDirectory,
    jsonLimit = '10mb'
}) {
    if (!express || typeof express !== 'function') {
        throw new TypeError('configureHttpApplication requires an Express factory');
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
    app.use(cors());
    app.use(express.json({ limit: jsonLimit }));
    app.use(express.static(staticDirectory));
    return app;
}
