
const fs = require('node:fs').promises;
const path = require('node:path');

/**
 * HeartbeatScheduler - Periodic system health checks
 * Reviews HEARTBEAT.md checklist and alerts on required actions
 */
class HeartbeatScheduler {
    constructor(agentRuntime, options = {}) {
        this.runtime = agentRuntime;
        this.interval = options.interval || process.env.HEARTBEAT_INTERVAL || 1800000; // 30min default
        this.checklistPath = options.checklistPath || path.join(process.cwd(), 'HEARTBEAT.md');
        this.timer = null;
        this.running = false;
    }

    /**
     * Start the heartbeat scheduler
     */
    start() {
        if (this.running) {
            console.warn('Heartbeat scheduler is already running');
            return;
        }

        this.running = true;
        console.log(`💓 Heartbeat scheduler started (${this.interval}ms interval)`);
        
        // Run immediately, then schedule
        this.tick();
        this.timer = setInterval(() => this.tick(), this.interval);
    }

    /**
     * Stop the scheduler
     */
    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        console.log('🛑 Heartbeat scheduler stopped');
    }

    /**
     * Execute a single heartbeat tick
     */
    async tick() {
        try {
            // Check if checklist file exists
            const exists = await this.fileExists(this.checklistPath);
            if (!exists) {
                console.log('ℹ️  No HEARTBEAT.md found, skipping check');
                return;
            }

            // Read checklist
            const checklist = await fs.readFile(this.checklistPath, 'utf8');
            
            if (!checklist.trim()) {
                return;
            }

            // Ask runtime to review
            const decision = await this.reviewChecklist(checklist);
            
            if (decision && decision.action && decision.action !== 'noop') {
                await this.notifyUser(decision);
            }

        } catch (error) {
            console.error('❌ Heartbeat tick failed:', error.message);
        }
    }

    /**
     * Check if file exists
     */
    async fileExists(filepath) {
        try {
            await fs.access(filepath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Review checklist using agent runtime
     */
    async reviewChecklist(checklist) {
        if (!this.runtime || !this.runtime.execute) {
            console.warn('No runtime available for checklist review');
            return { action: 'noop' };
        }

        try {
            const result = await this.runtime.execute({
                input: {
                    role: 'system',
                    content: `Review this checklist and decide if any items require action:\n\n${checklist}\n\nRespond with JSON: { "action": "noop" | "alert", "reason": "...", "priority": "low|medium|high" }`
                },
                tools: [
                    { name: 'noop', description: 'No action needed' },
                    { name: 'alert', description: 'Alert user about required action' }
                ]
            });

            return result;
        } catch (error) {
            console.error('Checklist review failed:', error.message);
            return { action: 'noop' };
        }
    }

    /**
     * Notify user of required action
     */
    async notifyUser(decision) {
        const timestamp = new Date().toISOString();
        const message = `[${timestamp}] HEARTBEAT ALERT\n\nAction required: ${decision.action}\nReason: ${decision.reason}\nPriority: ${decision.priority || 'medium'}`;

        console.log('🔔', message);

        // Emit event for other components (e.g., Telegram)
        if (this.runtime && this.runtime.emit) {
            this.runtime.emit('system.alert', {
                type: 'heartbeat',
                priority: decision.priority || 'medium',
                message: decision.reason,
                timestamp
            });
        }

        // Here you could also send email, Slack, etc.
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        return {
            running: this.running,
            interval: this.interval,
            checklistPath: this.checklistPath,
            nextTick: this.timer ? 'scheduled' : 'not scheduled'
        };
    }
}

module.exports = HeartbeatScheduler;

