import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import {
    createActionWbs,
    updateActionWbs,
    completeActionWbsStep,
    summarizeActionWbs
} from './action-wbs.js';
import { createNextActionProposal } from './next-action-planner.js';

/**
 * TaskRegistry — in-memory sub-agent task lifecycle management.
 */
const TaskStatus = Object.freeze({
    CREATED: 'created',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    STOPPED: 'stopped'
});

class TaskRegistry extends EventEmitter {
    constructor() {
        super();
        this.tasks = new Map();
        this.counter = 0;
    }

    create(prompt, {
        description = null,
        teamId = null,
        action = null,
        owner = null,
        context = {},
        wbs = null,
        input = {}
    } = {}) {
        const taskId = uuidv4();
        const now = Date.now();
        const taskWbs = wbs || createActionWbs(action || 'assist.task', {
            context,
            input: { text: prompt, action, ...input }
        });
        const task = {
            taskId,
            prompt,
            description,
            status: TaskStatus.CREATED,
            createdAt: now,
            updatedAt: now,
            messages: [],
            output: '',
            teamId,
            action,
            owner: owner ? {
                userId: owner.userId || null,
                platformId: owner.platformId || null
            } : null,
            scope: {
                tenantId: context.tenantId || null,
                domainId: context.domainId || null,
                siteId: context.siteId || null,
                userId: context.userId || owner?.userId || null,
                channel: context.channel || null
            },
            wbs: taskWbs,
            wbsSummary: summarizeActionWbs(taskWbs),
            planningContext: {
                tenantId: context.tenantId || null,
                domainId: context.domainId || null,
                siteId: context.siteId || null,
                userId: context.userId || owner?.userId || null,
                channel: context.channel || null,
                role: context.role || null,
                status: context.status || context.userDoc?.status || null,
                authorizedCapabilities: Array.isArray(context.authorizedCapabilities || context.capabilities)
                    ? [...(context.authorizedCapabilities || context.capabilities)] : [],
                locationPermission: context.locationPermission === true,
                proactiveOptOut: context.proactiveOptOut === true,
                timeZone: context.timeZone || null
            },
            nextActionProposal: null
        };
        task.nextActionProposal = createNextActionProposal({ task, context, now });
        this.tasks.set(taskId, task);
        this.counter++;
        this.emit('task:created', task);
        return task;
    }

    get(taskId) {
        return this.tasks.get(taskId) || null;
    }

    list(statusFilter = null, scope = {}) {
        return Array.from(this.tasks.values()).filter((task) => {
            if (statusFilter && task.status !== statusFilter) return false;
            for (const key of ['tenantId', 'domainId', 'siteId', 'userId']) {
                if (scope[key] && task.scope?.[key] !== scope[key]) return false;
            }
            return true;
        });
    }

    listForUser(userId, scope = {}) {
        return this.list(null, { ...scope, userId });
    }

    updateWbs(taskId, stepId, patch = {}) {
        const task = this.tasks.get(taskId);
        if (!task) return null;
        task.wbs = updateActionWbs(task.wbs, stepId, patch);
        task.wbsSummary = summarizeActionWbs(task.wbs);
        task.nextActionProposal = createNextActionProposal({ task, context: task.planningContext || task.scope, now: Date.now() });
        task.updatedAt = Date.now();
        this.emit('task:wbs-updated', task);
        return task;
    }

    completeWbsStep(taskId, stepId, result = null) {
        const task = this.tasks.get(taskId);
        if (!task) return null;
        task.wbs = completeActionWbsStep(task.wbs, stepId, result);
        task.wbsSummary = summarizeActionWbs(task.wbs);
        task.nextActionProposal = createNextActionProposal({ task, context: task.planningContext || task.scope, now: Date.now() });
        task.updatedAt = Date.now();
        this.emit('task:wbs-updated', task);
        return task;
    }

    update(taskId, patch) {
        const task = this.tasks.get(taskId);
        if (!task) return null;
        Object.assign(task, patch, { updatedAt: Date.now() });
        this.emit('task:updated', task);
        return task;
    }

    appendOutput(taskId, role, content) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.messages.push({ role, content, timestamp: Date.now() });
        task.output += content + '\n';
        task.updatedAt = Date.now();
    }

    setStatus(taskId, status, reason = null) {
        const task = this.tasks.get(taskId);
        if (!task) return;
        task.status = status;
        task.updatedAt = Date.now();
        if (reason) {
            task.messages.push({
                role: 'system',
                content: `Status → ${status}: ${reason}`,
                timestamp: Date.now()
            });
        }
        this.emit(`task:${status}`, task);
    }

    stop(taskId) {
        this.setStatus(taskId, TaskStatus.STOPPED, 'Stopped by operator');
    }

    assignTeam(taskId, teamId) {
        this.update(taskId, { teamId });
    }

    summary() {
        const counts = {};
        for (const status of Object.values(TaskStatus)) counts[status] = 0;
        for (const task of this.tasks.values()) counts[task.status]++;
        return { total: this.tasks.size, ...counts };
    }
}

let _instance = null;
function getTaskRegistry() {
    if (!_instance) _instance = new TaskRegistry();
    return _instance;
}

export { TaskRegistry, TaskStatus, getTaskRegistry };
