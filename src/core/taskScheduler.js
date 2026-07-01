'use strict';
/**
 * TaskScheduler — SQLite-backed cron/interval/once scheduled task runner
 * ─────────────────────────────────────────────────────────────────
 * AgentOS port of PicoClaw's task-scheduler.ts (MIT, © 2026 BreakCafe,
 * https://github.com/breakcafe/picoclaw). The cron/interval/once
 * next-run math is a direct translation; the execution path was
 * rewritten to dispatch through AgentKernel.dispatch() or, since
 * AgentKernel isn't wired into the live gateway yet, AskEngine.run()
 * (the path src/cli/commands/gateway.js actually exercises via
 * global.askEngine) — instead of PicoClaw's Claude-only agent engine,
 * so it works across AgentOS's multi-LLM (Gemini/Anthropic/OpenAI)
 * domains. See /THIRD_PARTY_LICENSES.md for the original license text.
 *
 * Falls back to in-memory storage when SQLite is unavailable (CI/test),
 * matching src/core/sessionManager.js's pattern.
 * ─────────────────────────────────────────────────────────────────
 */

const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

let CronExpressionParser = null;
try {
  ({ CronExpressionParser } = require('cron-parser'));
} catch (_) {
  // optional dependency — cron schedules unavailable, interval/once still work
}

const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// ── schedule math ──────────────────────────────────────────────────────────

function validateCron(scheduleValue) {
  if (!CronExpressionParser) {
    throw new Error("cron schedules require the 'cron-parser' package (npm i cron-parser)");
  }
  CronExpressionParser.parse(scheduleValue, { tz: TIMEZONE });
}

function validateInterval(scheduleValue) {
  const intervalMs = Number.parseInt(scheduleValue, 10);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`Invalid interval: ${scheduleValue}`);
  }
  return intervalMs;
}

function parseLocalTimestamp(scheduleValue) {
  if (/[Zz]$/.test(scheduleValue) || /[+-]\d{2}:\d{2}$/.test(scheduleValue)) {
    throw new Error('schedule_value for "once" must be local time without timezone suffix');
  }
  const date = new Date(scheduleValue);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid once schedule_value: ${scheduleValue}`);
  }
  return date;
}

/** scheduleType: 'once' | 'cron' | 'interval' */
function computeInitialNextRun(scheduleType, scheduleValue, now = new Date()) {
  if (scheduleType === 'once') {
    return parseLocalTimestamp(scheduleValue).toISOString();
  }
  if (scheduleType === 'cron') {
    validateCron(scheduleValue);
    const expression = CronExpressionParser.parse(scheduleValue, { currentDate: now, tz: TIMEZONE });
    return expression.next().toISOString();
  }
  const intervalMs = validateInterval(scheduleValue);
  return new Date(now.getTime() + intervalMs).toISOString();
}

function computeNextRun(task, now = new Date()) {
  if (task.schedule_type === 'once') return null;

  if (task.schedule_type === 'cron') {
    validateCron(task.schedule_value);
    const expression = CronExpressionParser.parse(task.schedule_value, { currentDate: now, tz: TIMEZONE });
    return expression.next().toISOString();
  }

  const intervalMs = validateInterval(task.schedule_value);
  const anchorTime = task.next_run ? new Date(task.next_run).getTime() : now.getTime();

  let next = anchorTime + intervalMs;
  while (next <= now.getTime()) next += intervalMs;

  return new Date(next).toISOString();
}

// ── TaskScheduler ────────────────────────────────────────────────────────

class TaskScheduler extends EventEmitter {
  /**
   * @param {object} opts
   * @param {object} opts.kernel   AgentKernel instance — must implement dispatch(agentConfig, context)
   * @param {string} [opts.dbPath] Directory for agentos.sqlite (shared with SessionManager's default)
   * @param {number} [opts.pollIntervalMs] How often to check for due tasks (default 30s)
   */
  /**
   * @param {object} opts
   * @param {object} [opts.kernel]  AgentKernel instance — dispatch(agentConfig, context)
   * @param {object} [opts.engine]  AskEngine instance (or anything with .run(prompt)) — the
   *                                actually-wired runtime path via global.askEngine in
   *                                src/cli/commands/gateway.js. Exactly one of kernel/engine
   *                                is required.
   * @param {string} [opts.dbPath] Directory for agentos.sqlite (shared with SessionManager's default)
   * @param {number} [opts.pollIntervalMs] How often to check for due tasks (default 30s)
   */
  constructor(opts = {}) {
    super();
    const hasKernel = opts.kernel && typeof opts.kernel.dispatch === 'function';
    const hasEngine = opts.engine && typeof opts.engine.run === 'function';
    if (!hasKernel && !hasEngine) {
      throw new Error('TaskScheduler requires either { kernel } with dispatch(agentConfig, context) or { engine } with run(prompt)');
    }
    this._kernel = opts.kernel || null;
    this._engine = opts.engine || null;
    this._mem = new Map();
    this._db = null;
    this._timer = null;
    this._pollIntervalMs = opts.pollIntervalMs || 30_000;

    const dbDir = opts.dbPath || process.env.AGENTOS_STATE_PATH || path.join(process.cwd(), 'data');
    this._dbPath = path.join(dbDir, 'agentos.sqlite');
    this._initDB();
  }

  _initDB() {
    try {
      const Database = require('better-sqlite3');
      const fs = require('fs');
      fs.mkdirSync(path.dirname(this._dbPath), { recursive: true });
      this._db = new Database(this._dbPath);
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
          id             TEXT PRIMARY KEY,
          domain         TEXT,
          prompt         TEXT NOT NULL,
          schedule_type  TEXT NOT NULL,   -- 'once' | 'cron' | 'interval'
          schedule_value TEXT NOT NULL,
          next_run       TEXT,
          last_run       TEXT,
          last_status    TEXT,
          last_summary   TEXT,
          enabled        INTEGER NOT NULL DEFAULT 1,
          createdAt      INTEGER NOT NULL,
          updatedAt      INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_runs (
          id          TEXT PRIMARY KEY,
          task_id     TEXT NOT NULL,
          run_at      TEXT NOT NULL,
          duration_ms INTEGER,
          status      TEXT,
          result      TEXT,
          error       TEXT
        );
      `);
    } catch (_) {
      this._db = null; // SQLite unavailable — in-memory only (CI/test)
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────

  createTask({ domain, prompt, scheduleType, scheduleValue }) {
    const id = `task-${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const task = {
      id,
      domain: domain || 'default',
      prompt,
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      next_run: computeInitialNextRun(scheduleType, scheduleValue),
      last_run: null,
      last_status: null,
      last_summary: null,
      enabled: 1,
      createdAt: now,
      updatedAt: now,
    };
    this._mem.set(id, task);
    if (this._db) {
      this._db.prepare(`
        INSERT INTO scheduled_tasks
          (id, domain, prompt, schedule_type, schedule_value, next_run, enabled, createdAt, updatedAt)
        VALUES (@id, @domain, @prompt, @schedule_type, @schedule_value, @next_run, @enabled, @createdAt, @updatedAt)
      `).run(task);
    }
    this.emit('task:created', task);
    return task;
  }

  getTask(id) {
    if (this._mem.has(id)) return this._mem.get(id);
    if (this._db) {
      const row = this._db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id);
      if (row) {
        this._mem.set(id, row);
        return row;
      }
    }
    return null;
  }

  listTasks(filter = {}) {
    const all = this._db
      ? this._db.prepare('SELECT * FROM scheduled_tasks').all()
      : [...this._mem.values()];
    return all.filter(t => !filter.domain || t.domain === filter.domain);
  }

  deleteTask(id) {
    this._mem.delete(id);
    if (this._db) this._db.prepare('DELETE FROM scheduled_tasks WHERE id=?').run(id);
    this.emit('task:deleted', { id });
  }

  setEnabled(id, enabled) {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.enabled = enabled ? 1 : 0;
    task.updatedAt = Date.now();
    this._persist(task);
    return task;
  }

  _persist(task) {
    this._mem.set(task.id, task);
    if (this._db) {
      this._db.prepare(`
        UPDATE scheduled_tasks SET
          next_run=@next_run, last_run=@last_run, last_status=@last_status,
          last_summary=@last_summary, enabled=@enabled, updatedAt=@updatedAt
        WHERE id=@id
      `).run(task);
    }
  }

  _logRun({ task_id, run_at, duration_ms, status, result, error }) {
    if (!this._db) return;
    this._db.prepare(`
      INSERT INTO task_runs (id, task_id, run_at, duration_ms, status, result, error)
      VALUES (?,?,?,?,?,?,?)
    `).run(`run-${crypto.randomUUID().slice(0, 8)}`, task_id, run_at, duration_ms, status, result, error);
  }

  // ── execution ─────────────────────────────────────────────────────────

  /** Runs a single task immediately through AgentKernel.dispatch() and reschedules it. */
  async runTask(task) {
    const startedAt = Date.now();
    let status = 'success';
    let resultText = null;
    let error;

    try {
      let resultOut;
      if (this._kernel) {
        const session = await this._kernel.dispatch(
          { domain: task.domain, prompt: task.prompt },
          { isScheduledTask: true, taskId: task.id }
        );
        resultOut = session?.result ?? null;
      } else {
        const out = await this._engine.run(task.prompt);
        resultOut = out?.result ?? null;
        if (out?.type === 'error') {
          status = 'error';
          error = String(resultOut);
          resultOut = null;
        }
      }
      resultText = resultOut;
    } catch (err) {
      status = 'error';
      error = err instanceof Error ? err.message : String(err);
    }

    const nextRun = computeNextRun(task, new Date());
    const summary = status === 'error'
      ? `Error: ${error || 'Unknown error'}`
      : (resultText || 'Completed').toString().slice(0, 200);

    task.next_run = nextRun;
    task.last_run = new Date().toISOString();
    task.last_status = status;
    task.last_summary = summary;
    task.updatedAt = Date.now();
    this._persist(task);

    const durationMs = Date.now() - startedAt;
    this._logRun({ task_id: task.id, run_at: task.last_run, duration_ms: durationMs, status, result: resultText, error: error || null });

    this.emit('task:ran', { task_id: task.id, status, durationMs, nextRun });
    return { status, task_id: task.id, result: resultText, duration_ms: durationMs, next_run: nextRun, error };
  }

  /** Runs every due, enabled task once. */
  async runDueTasks(now = new Date()) {
    const due = this.listTasks().filter(t => t.enabled && t.next_run && new Date(t.next_run) <= now);
    const results = [];
    for (const task of due) {
      results.push(await this.runTask(task));
    }
    return results;
  }

  // ── polling loop ──────────────────────────────────────────────────────

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => {
      this.runDueTasks().catch(err => this.emit('error', err));
    }, this._pollIntervalMs);
    if (this._timer.unref) this._timer.unref();
    this.emit('started');
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.emit('stopped');
  }
}

module.exports = TaskScheduler;
module.exports.computeInitialNextRun = computeInitialNextRun;
module.exports.computeNextRun = computeNextRun;
