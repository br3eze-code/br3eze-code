/**
 * Wi-Fi domain HTTP routes.
 *
 * Domain endpoints live here rather than in the generic server transport
 * bootstrap. Dependencies are supplied by the composition root so this
 * module can be tested without booting Firebase, SQLite, or a network device.
 */
import crypto from 'node:crypto';

const PAYMENT_PROVIDERS = [
    { id: 'stripe', name: 'Card', type: 'card', credentials: ['STRIPE_SECRET_KEY'] },
    { id: 'ecocash', name: 'EcoCash', type: 'mobile_money', credentials: ['ECOCASH_API_KEY', 'ECOCASH_MERCHANT_CODE'] },
    { id: 'netone', name: 'OneMoney', type: 'mobile_money', credentials: ['NETONE_API_KEY', 'NETONE_MERCHANT_ID'] },
    { id: 'paynow', name: 'PayNow', type: 'aggregator', credentials: ['PAYNOW_INTEGRATION_ID', 'PAYNOW_INTEGRATION_KEY'] },
    { id: 'pesapay', name: 'PesaPay', type: 'aggregator', credentials: ['PESAPAY_CONSUMER_KEY', 'PESAPAY_CONSUMER_SECRET'] },
    { id: 'mpesa', name: 'M-Pesa', type: 'mobile_money', credentials: ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET'] },
    { id: 'mastercard', name: 'Mastercard', type: 'card', credentials: ['MASTERCARD_API_KEY'] },
    { id: 'apple_pay', name: 'Apple Pay', type: 'wallet', credentials: ['APPLE_PAY_MERCHANT_ID'] },
    { id: 'google_pay', name: 'Google Pay', type: 'wallet', credentials: ['GOOGLE_PAY_MERCHANT_ID'] },
    { id: 'innbucks', name: 'InnBucks', type: 'mobile_money', credentials: ['INNBUCKS_API_KEY'] },
    { id: 'manual', name: 'Manual/Invoice', type: 'offline', credentials: [] }
];

function getPaymentMethods() {
    return PAYMENT_PROVIDERS.map(({ id, name, type, credentials }) => ({
        id,
        name,
        type,
        configured: id === 'manual' || credentials.some(key => Boolean(String(process.env[key] || '').trim())),
        serverConfirmed: false
    }));
}


export function registerWifiRoutes({
    app,
    otpRouter,
    database,
    CONFIG,
    BRAND,
    authMiddleware,
    rateLimitMiddleware,
    getCommandHandler,
    issueUserToken
}) {
    if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
        throw new TypeError('app must provide get() and post() route registration');
    }
    if (!database || !CONFIG || !BRAND || typeof getCommandHandler !== 'function' || typeof issueUserToken !== 'function') {
        throw new TypeError('Wi-Fi route dependencies are required');
    }

    // Runtime health contract shared with the PHP fallback. The Node server
    // reports its own health without claiming provider or remote-state success.
    app.get('/health', (req, res) => {
        res.json({
            success: true,
            status: 'ok',
            service: 'agentos-node-server',
            firebase: Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL),
            version: BRAND.version,
            uptime: process.uptime()
        });
    });

    app.get('/manifest', (req, res) => {
        res.json({
            name: 'AgentOS',
            offline: false,
            routeDispatcher: true,
            version: process.env.AGENTOS_VERSION || BRAND.version
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
        try {
            const token = issueUserToken({
                uid: user.uid || user.id || user.username,
                username: user.username,
                role: user.role
            }, CONFIG.GATEWAY_TOKEN);
            res.json({
                success: true,
                token,
                expiresIn: 3600,
                user: { username: user.username, role: user.role }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: 'Unable to establish a secure session' });
        }
    });
    
    const executeTool = async (req, res) => {
        const { tool, params = [] } = req.body;
        try {
            const result = await getCommandHandler().execute(tool, params, req.body._actor || 'api');
            res.json({ success: true, result });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    };
    app.post('/api/tool/execute', authMiddleware, rateLimitMiddleware, executeTool);
    app.post('/tool/execute', authMiddleware, rateLimitMiddleware, executeTool);
    
    app.get('/api/tools', authMiddleware, (req, res) => {
        res.json({ tools: getCommandHandler().getAvailableTools() });
    });

    app.get('/api/v1/tools', authMiddleware, (req, res) => {
        res.json({ tools: getCommandHandler().getAvailableTools() });
    });

    // Compatibility routes shared with the PHP fallback contract in www/.
    // Capability metadata is descriptive only; it never claims remote state.
    app.get('/api/v1/capabilities', authMiddleware, (req, res) => {
        const paymentMethods = getPaymentMethods();
        res.json({
            success: true,
            status: 'degraded',
            serverConfirmed: false,
            domains: {
                shopping: { paths: ['/shop', '/products', '/products/:id', '/product/:id', '/cart', '/cart/add', '/cart/remove', '/checkout', '/orders', '/orders/:id', '/orders/:id/ship', '/orders/:id/track', '/couriers'], skills: ['catalog', 'cart', 'checkout', 'orders', 'fulfillment', 'shopping-agent'] },
                payments: { paths: ['/api/payment/initiate', '/api/payment/status/:id', '/api/charge-card', '/api/charge-card/confirm', '/api/setup-intent/create', '/api/payment-method/save', '/billing/payment-link', '/billing/provider', '/billing/verify', '/billing/webhook', '/checkout/create', '/checkout/verify'], skills: ['provider-neutral-payments', 'idempotent-settlement', 'webhooks'] },
                vouchers: { paths: ['/voucher/generate', '/voucher/redeem', '/voucher/validate', '/vouchers', '/vouchers/:code', '/vouchers/:code/qr', '/vouchers/pay', '/vouchers/redeem', '/vouchers/stats', '/api/v1/vouchers', '/api/v1/vouchers/:code', '/api/v1/vouchers/redeem'], skills: ['voucher-claim', 'voucher-validation', 'qr'] },
                cctv: { paths: ['/api/v1/analysis/cctv', '/api/v1/cctv/stream/multi', '/cctv', '/cctv/stream', '/cctv/stream/multi', '/diagnostics/cctv'], skills: ['cctv-analysis', 'multi-channel-stream', 'audit-trails', 'device-health'] },
                network: { paths: ['/api/nodes', '/api/nodes/:name/exec', '/api/mesh/exec', '/nodes', '/nodes/:name', '/nodes/:name/command', '/nodes/fanout', '/ping', '/traceroute', '/firewall/list', '/firewall/block', '/dhcp/leases', '/diagnostics', '/diagnostics/connectivity', '/diagnostics/full', '/diagnostics/ping-router', '/hotspot/profiles', '/hotspot/profiles/:name'], skills: ['mikrotik', 'network-tools', 'mesh', 'diagnostics', 'wifi'] },
                channels: { paths: ['/channels', '/channels/:type/send', '/channels/broadcast', '/api/v1/channels/telegram/status', '/notify', '/webhooks/email'], skills: ['telegram', 'whatsapp', 'email', 'sms', 'websocket', 'channel-ui'] },
                analytics: { paths: ['/analytics/network', '/analytics/system', '/analytics/vouchers', '/financial/report', '/financial/summary', '/financial/transactions', '/financial/trends', '/api/v1/analysis/:domain'], skills: ['cctv-analyst', 'shopping-analyst', 'network-analyst', 'lifecycle-graph'] },
                skills: { paths: ['/skills', '/skills/:name', '/skills/:name/invoke', '/workflows', '/workflows/:name/trigger'], skills: ['skill-registry', 'skill-discovery', 'workflow-runner'] },
                tools: { paths: ['/tools', '/tools/:tool', '/tool/execute', '/api/v1/tools', '/api/v1/tools/:tool', '/batch/execute', '/execute'], skills: ['tool-registry', 'batch-execution', 'approval-gate'] },
                identity: { paths: ['/user', '/users/active', '/users/all', '/users/status', '/users/add', '/users/remove', '/users/kick', '/users/sync', '/system/identity', '/api/v1/users/sync', '/api/v1/users/kick'], skills: ['identity', 'tenant-scope', 'permissions', 'location-privacy'] }
            },
            paymentMethods,
            channels: ['telegram', 'whatsapp', 'email', 'sms', 'websocket', 'webpush', 'web', 'cordova', 'electron', 'cli'].map(id => ({ id, domainAgnostic: true, serverConfirmed: false })),
            message: 'Local capability manifest; authoritative remote availability is not confirmed.'
        });
    });

    const listPaymentMethods = (req, res) => {
        const methods = getPaymentMethods();
        res.json({ success: true, domain: 'payments', status: 'degraded', serverConfirmed: false, methods });
    };
    app.get('/api/payment/methods', authMiddleware, listPaymentMethods);
    app.get('/payment/methods', authMiddleware, listPaymentMethods);
    app.get('/billing/methods', authMiddleware, listPaymentMethods);

    const listChannelCapabilities = (req, res) => {
        const channels = ['telegram', 'whatsapp', 'email', 'sms', 'websocket', 'webpush', 'web', 'cordova', 'electron', 'cli']
            .map(id => ({ id, domainAgnostic: true, serverConfirmed: false }));
        res.json({ success: true, domain: 'channels', status: 'degraded', serverConfirmed: false, channels });
    };
    app.get('/channels', authMiddleware, listChannelCapabilities);
    app.get('/api/channels', authMiddleware, listChannelCapabilities);
    app.get('/channels/capabilities', authMiddleware, listChannelCapabilities);
    
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
