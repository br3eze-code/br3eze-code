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
    
    // Canonical email OTP authentication routes\napp.use('/api/auth/otp', otpRouter);\n\n// API routes
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
    
    app.get('/api/vouchers', authMiddleware, rateLimitMiddleware, (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
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
    
    app.post('/api/vouchers/redeem', rateLimitMiddleware, (req, res) => {
        const { code, user } = req.body;
        if (!code || !user) {
            return res.status(400).json({ error: 'Code and user required' });
        }
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
