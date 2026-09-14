import express from 'express';
import http from 'node:http';
import EventEmitter from 'node:events';
import { logger } from './logger.js';

/**
 * Domain-neutral HTTP/WebSocket gateway. Routes, authentication, channels,
 * tools and external services are injected by the host application.
 */
export class Gateway extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { host: config.host || '0.0.0.0', port: config.port || 3000, cors: config.cors, routes: config.routes || [], middleware: config.middleware || [], health: config.health || (() => ({ ok: true })) };
    this.app = express();
    this.server = null;
    this._configure();
  }
  _configure() {
    this.app.disable('x-powered-by');
    this.app.use(express.json({ limit: this.config.bodyLimit || '1mb' }));
    for (const middleware of this.config.middleware) this.app.use(middleware);
    this.app.get('/health', async (req, res) => { try { res.json(await this.config.health(req)); } catch (error) { res.status(503).json({ ok: false, error: error.message }); } });
    this.app.get('/health/live', (req, res) => res.json({ ok: true, live: true }));
    this.app.get('/health/ready', async (req, res) => { try { const value = await this.config.health(req); res.status(value?.ok === false ? 503 : 200).json(value); } catch (error) { res.status(503).json({ ok: false, error: error.message }); } });
    for (const route of this.config.routes) { if (route?.path && route.router) this.app.use(route.path, route.router); }
  }
  addRoute(path, router) { if (!path || !router) throw new TypeError('path and router are required'); this.app.use(path, router); return this; }
  addMiddleware(middleware) { this.app.use(middleware); return this; }
  async start() { if (this.server) return this.server; this.server = http.createServer(this.app); await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.config.port, this.config.host, resolve); }); this.emit('started', { host: this.config.host, port: this.config.port }); logger.info(`Gateway listening on ${this.config.host}:${this.config.port}`); return this.server; }
  async stop() { if (!this.server) return; await new Promise(resolve => this.server.close(() => resolve())); this.server = null; this.emit('stopped'); }
  async close() { return this.stop(); }
  getApp() { return this.app; }
}
export default Gateway;
