// ============================================================================
// 1. CONFIGURATION
// ============================================================================
const CONFIG = {
    API_KEY: window.GEMINI_CONFIG?.API_KEY || 'YOUR_KEY_HERE',
    MODEL: 'gemini-2.5-flash',
    MAX_HISTORY: 20,
    PROACTIVE_INTERVAL: 30000,
    MAX_TOOL_DEPTH: 3, // Prevent infinite loops
    get STREAM_URL() {
        return `https://generativelanguage.googleapis.com/v1beta/models/${this.MODEL}:streamGenerateContent?alt=sse&key=${this.API_KEY}`;
    }
};

const STATE = {
    isProcessing: false,
    toolDepth: 0,
    sessionStart: Date.now(),
    apiHistory: [],
    pendingConfirmations: new Map(),
    userFacts: {} // Cached facts
};

// ============================================================================
// 2. EXTENDED TOOL REGISTRY (Enterprise Feature Set)
// ============================================================================
const ToolRegistry = {
    definitions: {
        navigate: {
            name: 'navigate',
            description: 'Navigate to app sections',
            parameters: {
                type: 'OBJECT',
                properties: {
                    section: {
                        type: 'STRING',
                        enum: ['home', 'plans', 'transactions', 'settings', 'roaming', 'partner-networks', 'systemFunctions']
                    }
                },
                required: ['section']
            }
        },
        purchase_plan: {
            name: 'purchase_plan',
            description: 'Purchase a WiFi data plan',
            parameters: {
                type: 'OBJECT',
                properties: { plan_id: { type: 'STRING' } },
                required: ['plan_id']
            },
            dangerous: true,
            estimate: (args) => {
                const plan = window.AppData?.plans?.find(p => p.id === args.plan_id);
                return plan ? `Cost: $${plan.price} (${plan.name})` : 'Unknown';
            }
        },
        redeem_voucher: {
            name: 'redeem_voucher',
            description: 'Redeem voucher code for credit',
            parameters: {
                type: 'OBJECT',
                properties: { code: { type: 'STRING' } },
                required: ['code']
            }
        },
        share_credit: {
            name: 'share_credit',
            description: 'Transfer credit to another user',
            parameters: {
                type: 'OBJECT',
                properties: {
                    recipient: { type: 'STRING', description: 'Username or phone number' },
                    amount: { type: 'NUMBER', description: 'Amount to transfer' }
                },
                required: ['recipient', 'amount']
            },
            dangerous: true
        },
        generate_vouchers: {
            name: 'generate_vouchers',
            description: 'Generate voucher codes (Admin only)',
            parameters: {
                type: 'OBJECT',
                properties: {
                    value: { type: 'NUMBER' },
                    quantity: { type: 'NUMBER' },
                    prefix: { type: 'STRING', description: 'Optional code prefix' }
                },
                required: ['value', 'quantity']
            },
            adminOnly: true
        },
        get_system_status: {
            name: 'get_system_status',
            description: 'Get user status, balance, active plan',
            parameters: { type: 'OBJECT', properties: {} }
        },
        analyze_usage: {
            name: 'analyze_usage',
            description: 'Analyze data usage patterns',
            parameters: {
                type: 'OBJECT',
                properties: { period: { type: 'STRING', enum: ['day', 'week', 'month'], default: 'week' } }
            }
        },
        create_ticket: {
            name: 'create_ticket',
            description: 'Create support ticket',
            parameters: {
                type: 'OBJECT',
                properties: {
                    subject: { type: 'STRING' },
                    body: { type: 'STRING' },
                    priority: { type: 'STRING', enum: ['low', 'normal', 'high'], default: 'normal' }
                },
                required: ['subject', 'body']
            }
        },
        search_knowledge: {
            name: 'search_knowledge',
            description: 'Search help documentation',
            parameters: {
                type: 'OBJECT',
                properties: { query: { type: 'STRING' } },
                required: ['query']
            }
        },
        set_reminder: {
            name: 'set_reminder',
            description: 'Set user reminder',
            parameters: {
                type: 'OBJECT',
                properties: {
                    message: { type: 'STRING' },
                    trigger_condition: { type: 'STRING', enum: ['plan_expiry', 'low_balance', 'time'], description: 'Condition to trigger' },
                    trigger_value: { type: 'STRING', description: 'Hours before expiry, or time string' }
                },
                required: ['message', 'trigger_condition']
            }
        }
    },

    async execute(name, args) {
        console.log(`[Tool Execute] ${name}:`, args);
        const user = window.currentUser;

        try {
            switch (name) {
                case 'navigate':
                    window.showSection?.(args.section);
                    return { success: true, navigated_to: args.section };

                case 'purchase_plan': {
                    const plan = window.AppData?.plans?.find(p => p.id === args.plan_id);
                    if (!plan) throw new Error('Plan not found');

                    if (user?.role !== 'admin' && user?.credits < plan.price) {
                        throw new Error(`Insufficient balance. Need $${plan.price}, have $${user?.credits?.toFixed(2)}`);
                    }

                    await window.purchasePlan?.(args.plan_id);
                    ProactiveMonitor.updatePlanTracking();

                    return {
                        success: true,
                        plan_name: plan.name,
                        cost: plan.price,
                        expires: new Date(Date.now() + (plan.durationDays || 0) * 86400000).toISOString()
                    };
                }

                case 'redeem_voucher': {
                    const amount = await window.redeemVoucherLogic?.(args.code);
                    window.updateUI?.();
                    return { success: true, added: amount, new_balance: user?.credits };
                }

                case 'share_credit': {
                    if (args.amount <= 0) throw new Error('Amount must be positive');
                    if ((user?.credits || 0) < args.amount) throw new Error('Insufficient balance');

                    // Mock transfer - replace with actual API
                    await new Promise(r => setTimeout(r, 600));
                    return {
                        success: true,
                        recipient: args.recipient,
                        amount: args.amount,
                        transaction_id: `TX${Date.now()}`
                    };
                }

                case 'generate_vouchers': {
                    if (user?.role !== 'admin') throw new Error('Admin only');
                    const codes = [];
                    for (let i = 0; i < args.quantity; i++) {
                        const code = `${args.prefix || 'BRZ'}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
                        codes.push(code);
                        await window.DataStore?.createVoucher?.(code, args.value);
                    }
                    return { success: true, generated: args.quantity, codes };
                }

                case 'get_system_status':
                    return {
                        balance: user?.credits,
                        role: user?.role,
                        active_plan: window.getActiveSubscription?.()?.planName || 'None',
                        network: window.NetworkTools?.lastKnownSSID || 'Offline',
                        platform: window.device?.platform || 'Web'
                    };

                case 'analyze_usage': {
                    // Mock analytics - integrate with real usage tracking
                    return {
                        period: args.period,
                        total_gb: 12.5,
                        peak_hours: '18:00-22:00',
                        top_apps: ['YouTube', 'Instagram', 'TikTok'],
                        average_speed: '24 Mbps',
                        recommendation: 'Consider upgrading to Unlimited plan'
                    };
                }

                case 'create_ticket': {
                    const ticket = await window.DataStore?.submitTicket?.(
                        user?.uid, args.subject, args.body, { priority: args.priority }
                    );
                    return { success: true, ticket_id: ticket?.id };
                }

                case 'search_knowledge': {
                    const kb = {
                        'getting started': 'Download app → Signup → Buy credits → Connect to Power-HotSpot',
                        'device binding': 'Hardware ID locked to first device. Contact support to reset.',
                        'roaming': 'Partner hotspots available. Look for 🌐 icon.',
                        'voucher': 'Buy vouchers from agents or admin. Redeem in app.',
                        'plan expiry': 'Renew before expiry to avoid disconnection. Grace period: 1 hour.'
                    };
                    const results = Object.entries(kb)
                        .filter(([k]) => k.includes(args.query.toLowerCase()))
                        .map(([, v]) => v);
                    return { results: results.length ? results : ['No documentation found.'] };
                }

                case 'set_reminder': {
                    const reminders = JSON.parse(localStorage.getItem('br3eze_reminders') || '[]');
                    reminders.push({ ...args, created: Date.now() });
                    localStorage.setItem('br3eze_reminders', JSON.stringify(reminders));
                    return { success: true, reminder_set: true };
                }

                default:
                    return { error: `Unknown tool: ${name}` };
            }
        } catch (error) {
            console.error(`[Tool Error] ${name}:`, error);
            return { error: error.message, tool: name };
        }
    }
};

// ============================================================================
// 3. SAFETY GATE WITH ADMIN CHECKS
// ============================================================================
const SafetyGate = {
    requiresConfirmation(toolName, args) {
        const def = ToolRegistry.definitions[toolName];
        if (!def) return false;

        // Admin check
        if (def.adminOnly && window.currentUser?.role !== 'admin') {
            return 'unauthorized';
        }

        // Dangerous action check
        if (def.dangerous) {
            // Auto-confirm for admins or tiny amounts
            if (toolName === 'purchase_plan' && window.currentUser?.role === 'admin') return false;
            if (toolName === 'share_credit' && args.amount < 5) return false;
            return 'dangerous';
        }

        return false;
    },

    async prompt(toolName, args) {
        const def = ToolRegistry.definitions[toolName];
        const confirmId = `confirm-${Date.now()}`;
        const estimate = def.estimate ? def.estimate(args) : '';

        return new Promise((resolve) => {
            STATE.pendingConfirmations.set(confirmId, resolve);

            const text = `⚠️ **Confirm Action**\n${def.description}\n${estimate ? `*Impact: ${estimate}*` : ''}\n\nProceed?`;

            UI.addSystemButtons(text, [
                { label: '✅ Confirm', class: 'btn-primary', onClick: () => this.resolve(confirmId, true) },
                { label: '❌ Cancel', onClick: () => this.resolve(confirmId, false) }
            ]);
        });
    },

    resolve(id, approved) {
        const resolver = STATE.pendingConfirmations.get(id);
        if (resolver) {
            resolver(approved);
            STATE.pendingConfirmations.delete(id);
        }
    }
};

// ============================================================================
// 4. ENHANCED MEMORY SYSTEM
// ============================================================================
const MemorySystem = {
    async init() {
        // Load cached facts
        if (window.currentUser?.uid) {
            try {
                const doc = await firebase.firestore().collection('ai_memory').doc(window.currentUser.uid).get();
                STATE.userFacts = doc.data()?.facts || {};
            } catch (e) { STATE.userFacts = {}; }
        }
    },

    async buildContext() {
        const user = window.currentUser;
        const now = new Date();

        let context = `You are Br3eze Agent, an autonomous AI assistant.
        Time: ${now.toLocaleString()}
User: 
u
s
e
r
?
.
f
u
l
l
n
a
m
e
∣
∣
′
G
u
e
s
t
′
(
user?.fullname∣∣ 
′
 Guest 
′
 (
{user?.role || 'user'})
Balance: 
{user?.credits?.toFixed(2) || '0.00'}
RULES:
ALWAYS use tools instead of manual navigation instructions
If a tool fails, explain the error and suggest alternatives
Be concise but helpful
For "admin" users, allow dangerous tools without extra warnings`;

        // Add user facts
        if (Object.keys(STATE.userFacts).length > 0) {
            context += `\nUser Facts:\n${JSON.stringify(STATE.userFacts, null, 2)}`;
        }

        // Add active subscription info
        const activeSub = window.getActiveSubscription?.();
        if (activeSub) {
            context += `\nActive Subscription:\nPlan: ${activeSub.planName}\nExpires: ${new Date(activeSub.expiryDate).toLocaleString()}\nRemaining: ${activeSub.daysLeft} days`;
        }

        // Add network status
        context += `\nNetwork Status:\nSSID: ${window.NetworkTools?.lastKnownSSID || 'Unknown'}\nStatus: ${window.NetworkTools?.isConnected ? 'Connected' : 'Disconnected'}`;

        return context;
    },

    async remember(key, value) {
        const user = window.currentUser;
        if (!user) return;

        STATE.userFacts[key] = value;

        // Save to Firestore
        try {
            await firebase.firestore().collection('ai_memory').doc(user.uid).set({
                facts: STATE.userFacts,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (e) { console.error('Failed to save memory:', e); }
    }
};

// ============================================================================
// 5. PROACTIVE MONITORING SYSTEM
// ============================================================================
const ProactiveMonitor = {
    interval: null,

    init() {
        this.updatePlanTracking();
        this.interval = setInterval(() => this.checkProactive(), CONFIG.PROACTIVE_INTERVAL);
    },

    updatePlanTracking() {
        const activeSub = window.getActiveSubscription?.();
        if (activeSub) {
            STATE.planTracking = {
                planName: activeSub.planName,
                expiryDate: activeSub.expiryDate,
                daysLeft: activeSub.daysLeft
            };
        } else {
            STATE.planTracking = null;
        }
    },

    async checkProactive() {
        if (!window.currentUser) return;

        this.updatePlanTracking();

        // Check plan expiry
        if (STATE.planTracking && STATE.planTracking.daysLeft <= 3) {
            const msg = `Your ${STATE.planTracking.planName} plan expires in ${STATE.planTracking.daysLeft} days.`;
            if (!this.hasRecentNotification(msg)) {
                UI.addSystemMessage(msg, 'warning');
                this.remember('plan_warning', msg);
            }
        }

        // Check low balance
        if (window.currentUser.credits < 10) {
            const msg = `Low balance: $${window.currentUser.credits.toFixed(2)}. Consider topping up.`;
            if (!this.hasRecentNotification(msg)) {
                UI.addSystemMessage(msg, 'warning');
                this.remember('balance_warning', msg);
            }
        }

        // Check network issues
        if (window.NetworkTools?.lastKnownSSID && !window.NetworkTools?.isConnected) {
            const msg = `No connection to ${window.NetworkTools.lastKnownSSID}.`;
            if (!this.hasRecentNotification(msg)) {
                UI.addSystemMessage(msg, 'error');
                this.remember('network_issue', msg);
            }
        }
    },

    hasRecentNotification(msg) {
        const lower = msg.toLowerCase();
        return Object.values(STATE.userFacts).some(f =>
            typeof f === 'string' && f.toLowerCase().includes(lower.substring(0, 20))
        );
    }
};

// ============================================================================
// 6. MAIN ORCHESTRATOR
// ============================================================================
const Br3ezeAgent = {
    async init() {
        console.log('[Agent] Initializing...');
        await MemorySystem.init();
        ProactiveMonitor.init();

        // Listen for global events
        window.addEventListener('userChanged', () => {
            MemorySystem.init();
            ProactiveMonitor.updatePlanTracking();
        });

        window.addEventListener('networkChanged', () => {
            ProactiveMonitor.checkProactive();
        });

        console.log('[Agent] Ready for commands');
    },

    async processCommand(input) {
        if (STATE.isProcessing) {
            return { error: 'Already processing a command' };
        }

        STATE.isProcessing = true;
        STATE.toolDepth = 0;

        try {
            const context = await MemorySystem.buildContext();
            const response = await this.runAgent(input, context);

            return { success: true, response };
        } catch (error) {
            console.error('[Agent Error]', error);
            return { success: false, error: error.message };
        } finally {
            STATE.isProcessing = false;
        }
    },

    async runAgent(input, context) {
        let currentInput = input;
        let history = [...STATE.apiHistory];

        // Add user message to history
        history.push({ role: 'user', parts: [{ text: input }] });

        // Loop for tool execution
        while (STATE.toolDepth < CONFIG.MAX_TOOL_DEPTH) {
            const response = await this.callGemini(history, context);
            const text = response.text;

            // Add AI response to history
            history.push({ role: 'model', parts: [{ text }] });

            // Check for tool calls
            const toolCalls = this.extractToolCalls(text);

            if (toolCalls.length === 0) {
                // No tools, return final response
                STATE.apiHistory = history.slice(-CONFIG.MAX_HISTORY);
                return text;
            }

            // Process tools
            for (const toolCall of toolCalls) {
                const { name, args, id } = toolCall;

                // Check safety
                const safety = SafetyGate.requiresConfirmation(name, args);
                if (safety === 'unauthorized') {
                    history.push({ role: 'model', parts: [{ text: `❌ Access denied. You don't have permission for ${name}.` }] });
                    continue;
                }

                if (safety === 'dangerous') {
                    const approved = await SafetyGate.prompt(name, args);
                    if (!approved) {
                        history.push({ role: 'model', parts: [{ text: `❌ Action cancelled by user.` }] });
                        continue;
                    }
                }

                // Execute tool
                const result = await ToolRegistry.execute(name, args);

                // Add result to history
                history.push({ role: 'model', parts: [{ text: JSON.stringify(result) }] });

                // Update context if needed
                if (result.success && (name === 'purchase_plan' || name === 'redeem_voucher')) {
                    context = await MemorySystem.buildContext();
                }

                // Update current input for next iteration
                currentInput = `Tool result: ${JSON.stringify(result)}`;
            }

            STATE.toolDepth++;
        }

        // Max depth reached
        history.push({ role: 'model', parts: [{ text: 'Maximum tool depth reached. Please ask again if needed.' }] });
        STATE.apiHistory = history.slice(-CONFIG.MAX_HISTORY);
        return 'Maximum tool depth reached. Please ask again if needed.';
    },

    async callGemini(history, context) {
        const payload = {
            contents: history.slice(-CONFIG.MAX_HISTORY),
            systemInstruction: { parts: [{ text: context }] },
            tools: [{
                googleSearch: {}
            }, {
                createBubble(id, sender, text = '') {
                    if (!this.log) return;
                    const div = document.createElement('div');
                    div.id = `msg-${id}`;
                    div.className = `chat-message ${sender}`;

                    if (sender === 'bot') {
                        div.innerHTML = `<div class="bot-avatar"><i class="fas fa-robot"></i></div><div class="bubble bot" id="bubble-${id}">${this.format(text)}</div>`;
                    } else {
                        div.innerHTML = `<div class="bubble user">${this.format(text)}</div>`;
                    }

                    this.log.appendChild(div);
                    this.scroll();
                    return div;
                },

                updateBubble(id, text) {
                    const bubble = document.getElementById(`bubble-${id}`);
                    if (bubble) {
                        bubble.innerHTML = this.format(text);
                        this.scroll();
                    }
                },

                addSystemButtons(text, buttons) {
                    const id = Date.now();
                    this.createBubble(id, 'bot', text);

                    const container = document.createElement('div');
                    container.className = 'chat-action-buttons';
                    container.style.marginTop = '8px';

                    buttons.forEach(btn => {
                        const b = document.createElement('button');
                        b.className = `btn btn-sm chat-inline-btn ${btn.class || ''}`;
                        b.innerHTML = btn.label;
                        b.onclick = btn.onClick;
                        container.appendChild(b);
                    });

                    document.getElementById(`msg-${id}`)?.appendChild(container);
                    this.scroll();
                },

                addSystemMessage(text, actions = []) {
                    if (actions.length) this.addSystemButtons(text, actions);
                    else this.createBubble(Date.now(), 'bot', text);
                },

                format(text) {
                    return text
                        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.*?)\*/g, '<em>$1</em>')
                        .replace(/`([^`]+)`/g, '<code>$1</code>')
                        .replace(/\n/g, '<br>');
                },

                scroll() {
                    if (this.log) this.log.scrollTop = this.log.scrollHeight;
                }
            };
            // ============================================================================
            // 8. PUBLIC API
            // ============================================================================
            return {
                async init() {
                    await MemorySystem.init();
                    ProactiveMonitor.start();
                    const input = document.getElementById('chatInput');
                    const btn = document.getElementById('chatActionBtn');

                    if (input) {
                        input.addEventListener('keypress', (e) => {
                            if (e.key === 'Enter') Core.processMessage(input.value);
                        });
                    }

                    if (btn) {
                        btn.addEventListener('click', () => Core.processMessage(input?.value || ''));
                    }

                    console.log('[OpenClaw Agent] v3.1 Enhanced Native Online');
                },

                open() {
                    document.getElementById('chatBoxModal')?.classList.add('active');
                    if (STATE.apiHistory.length === 0) {
                        const name = window.currentUser?.fullname?.split(' ')[0] || 'there';
                        setTimeout(() => {
                            UI.createBubble('intro', 'bot', `Hello ${name}! 👋 I'm Br3eze Agent. I can help you buy plans, redeem vouchers, check usage, and manage your account. What would you like to do?`);
                        }, 300);
                    }
                },

                close() {
                    document.getElementById('chatBoxModal')?.classList.remove('active');
                },

                send: Core.processMessage,

                // Expose for debugging
                get state() { return STATE; },
                get tools() { return ToolRegistry; }