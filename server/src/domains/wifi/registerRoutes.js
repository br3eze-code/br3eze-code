/**
 * Wi-Fi domain HTTP routes.
 *
 * Domain endpoints live here rather than in the generic server transport
 * bootstrap. Dependencies are supplied by the composition root so this
 * module can be tested without booting Firebase, SQLite, or a network device.
 */
import crypto from 'node:crypto';

export function registerWifiRoutes({
    app,
    otpRouter,
    database,
    CONFIG,
    BRAND,
    authMiddleware,
    rateLimitMiddleware,
    getCommandHandler
}) {
    if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
        throw new TypeError('app must provide get() and post() route registration');
    }
    if (!database || !CONFIG || !BRAND || typeof getCommandHandler !== 'function') {
        throw new TypeError('Wi-Fi route dependencies are required');
    }

    // Health check
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            version: BRAND.version,
            uptime: process.uptime()
        });
    });
    
    // Canonical email OTP authentication routes
app.use('/api/auth/otp', otpRouter);

// API routes
    app.post('/api/auth/login', (req, res) => {
        const { username, password } = req.body;
        const user = database.validateUser(username, password);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        res.json({
            success: true,
            token: CONFIG.GATEWAY_TOKEN,
            user: { username: user.username, role: user.role }
        });
    });
    
    app.post('/api/tool/execute', authMiddleware, rateLimitMiddleware, async (req, res) => {
        const { tool, params = [] } = req.body;
        try {
            const result = await getCommandHandler().execute(tool, params, req.body._actor || 'api');
            res.json({ success: true, result });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });
    
    app.get('/api/tools', authMiddleware, (req, res) => {
        res.json({ tools: getCommandHandler().getAvailableTools() });
    });

    // Compatibility routes shared with the PHP fallback contract in www/.
    // Capability metadata is descriptive only; it never claims remote state.
    app.get('/api/v1/capabilities', (req, res) => {
        const paymentMethods = [
            { id: 'stripe', name: 'Card', type: 'card', configured: Boolean(process.env.STRIPE_SECRET_KEY) },
            { id: 'ecocash', name: 'EcoCash', type: 'mobile_money', configured: Boolean(process.env.ECOCASH_API_KEY && process.env.ECOCASH_MERCHANT_CODE) },
            { id: 'netone', name: 'OneMoney', type: 'mobile_money', configured: Boolean(process.env.NETONE_API_KEY && process.env.NETONE_MERCHANT_ID) },
            { id: 'paynow', name: 'PayNow', type: 'aggregator', configured: Boolean(process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY) },
            { id: 'pesapay', name: 'PesaPay', type: 'aggregator', configured: Boolean(process.env.PESAPAY_CONSUMER_KEY && process.env.PESAPAY_CONSUMER_SECRET) },
            { id: 'mpesa', name: 'M-Pesa', type: 'mobile_money', configured: Boolean(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET) },
            { id: 'mastercard', name: 'Mastercard', type: 'card', configured: Boolean(process.env.MASTERCARD_API_KEY) },
            { id: 'innbucks', name: 'InnBucks', type: 'mobile_money', configured: Boolean(process.env.INNBUCKS_API_KEY) },
            { id: 'manual', name: 'Manual/Invoice', type: 'offline', configured: true }
        ].map(({ id, name, type, configured }) => ({
            id, name, type, configured, domainAgnostic: true, serverConfirmed: false
        }));
        res.json({
            success: true,
            status: 'degraded',
            serverConfirmed: false,
            domains: {
                identity: { paths: ['/api/auth/login', '/api/auth/otp'], skills: ['identity', 'tenant-scope', 'permissions'] },
                tools: { paths: ['/api/tools', '/api/tool/execute', '/api/v1/tools'], skills: ['tool-registry', 'batch-execution', 'approval-gate'] },
                vouchers: { paths: ['/api/vouchers', '/api/v1/vouchers', '/api/v1/vouchers/redeem'], skills: ['voucher-claim', 'voucher-validation', 'qr'] },
                payments: { paths: ['/api/payment/methods', '/api/checkout/create', '/api/checkout/verify'], skills: ['provider-neutral-payments', 'idempotent-settlement', 'webhooks'] },
                network: { paths: ['/api/router/status'], skills: ['network-tools', 'diagnostics', 'wifi'] }
            },
            paymentMethods,
            channels: [],
            message: 'Local capability manifest; authoritative remote availability is not confirmed.'
        });
    });

    app.get('/api/payment/methods', (req, res) => {
        const methods = [
            ['stripe', 'Card', 'card', Boolean(process.env.STRIPE_SECRET_KEY)],
            ['ecocash', 'EcoCash', 'mobile_money', Boolean(process.env.ECOCASH_API_KEY && process.env.ECOCASH_MERCHANT_CODE)],
            ['netone', 'OneMoney', 'mobile_money', Boolean(process.env.NETONE_API_KEY && process.env.NETONE_MERCHANT_ID)],
            ['paynow', 'PayNow', 'aggregator', Boolean(process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY)],
            ['pesapay', 'PesaPay', 'aggregator', Boolean(process.env.PESAPAY_CONSUMER_KEY && process.env.PESAPAY_CONSUMER_SECRET)],
            ['mpesa', 'M-Pesa', 'mobile_money', Boolean(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET)],
            ['mastercard', 'Mastercard', 'card', Boolean(process.env.MASTERCARD_API_KEY)],
            ['innbucks', 'InnBucks', 'mobile_money', Boolean(process.env.INNBUCKS_API_KEY)],
            ['manual', 'Manual/Invoice', 'offline', true]
        ].map(([id, name, type, configured]) => ({
            id, name, type, configured, domainAgnostic: true, serverConfirmed: false
        }));
        res.json({ success: true, domain: 'payments', status: 'degraded', serverConfirmed: false, methods });
    });
    
    app.get('/api/vouchers', authMiddleware, rateLimitMiddleware, (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
        const used = req.query.used === 'true' ? true : req.query.used === 'false' ? false : null;
        res.json(database.listVouchers(limit, used));
    });

    app.get('/api/v1/vouchers', authMiddleware, rateLimitMiddleware, (req, res) => {
        const limit = parseInt(req.query.limit, 10) || 50;
        const used = req.query.used === 'true' ? true : req.query.used === 'false' ? false : null;
        res.json(database.listVouchers(limit, used));
    });
    
    app.post('/api/vouchers', authMiddleware, rateLimitMiddleware, (req, res) => {
        const { plan, count = 1 } = req.body;
        if (!CONFIG.VOUCHER_PLANS[plan]) {
            return res.status(400).json({ error: `Invalid plan: ${plan}` });
        }
    
        const vouchers = [];
        for (let i = 0; i < Math.min(count, 100); i++) {
            const code = CONFIG.VOUCHER_PREFIX + crypto.randomBytes(3).toString('hex').toUpperCase();
            vouchers.push(database.createVoucher(code, plan, 'api'));
        }
    
        res.json({ success: true, vouchers });
    });

    app.post('/api/v1/vouchers', authMiddleware, rateLimitMiddleware, (req, res) => {
        const { plan, count = 1 } = req.body;
        if (!CONFIG.VOUCHER_PLANS[plan]) return res.status(400).json({ error: `Invalid plan: ${plan}` });
        const requested = Number.parseInt(count, 10);
        if (!Number.isFinite(requested) || requested < 1) return res.status(400).json({ error: 'count must be a positive integer' });
        const vouchers = [];
        for (let i = 0; i < Math.min(requested, 100); i++) {
            const code = CONFIG.VOUCHER_PREFIX + crypto.randomBytes(3).toString('hex').toUpperCase();
            vouchers.push(database.createVoucher(code, plan, 'api'));
        }
        res.json({ success: true, vouchers });
    });
    
    app.post('/api/vouchers/redeem', rateLimitMiddleware, (req, res) => {
        const { code, user } = req.body;
        if (!code || !user) {
            return res.status(400).json({ error: 'Code and user required' });
        }
        res.json(database.redeemVoucher(code, user));
    });

    app.post('/api/v1/vouchers/redeem', rateLimitMiddleware, (req, res) => {
        const { code, user } = req.body;
        if (!code || !user) return res.status(400).json({ error: 'Code and user required' });
        res.json(database.redeemVoucher(code, user));
    });
    
    app.get('/api/vouchers/stats', authMiddleware, (req, res) => {
        res.json(database.getVoucherStats());
    });
    
    app.get('/api/audit', authMiddleware, (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
        res.json(database.getAuditLog(limit));
    });
}
