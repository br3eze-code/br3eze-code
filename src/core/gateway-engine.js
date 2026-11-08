import express from 'express';
import http from 'node:http';
import EventEmitter from 'node:events';
import { logger } from './logger.js';
import { createLiveWebServer, resolveWebRoot } from './live-web-server.js';

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>AgentOS Gateway</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0b1020;color:#e8edf8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top,#172747,#0b1020 60%);padding:clamp(20px,5vw,64px)}
main{max-width:920px;margin:auto}.eyebrow{color:#7dd3fc;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;font-weight:700}
h1{font-size:clamp(2.2rem,6vw,4rem);margin:.5rem 0}.muted{color:#a8b4cb;line-height:1.6}
.panel{margin-top:28px;border:1px solid #293956;background:#111a2d;border-radius:18px;padding:24px}
.status{display:flex;align-items:center;gap:12px;font-weight:700;font-size:1.15rem}.dot{width:11px;height:11px;border-radius:50%;background:#fbbf24}.dot.ok{background:#34d399;box-shadow:0 0 16px #34d39988}.dot.bad{background:#fb7185}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:22px}.item{padding:16px;border-radius:12px;background:#0b1222;border:1px solid #25324b}.label{font-size:.78rem;color:#9baac3}.value{margin-top:8px;font-size:1rem;overflow-wrap:anywhere}
a{color:#7dd3fc}button{border:0;border-radius:9px;padding:10px 14px;background:#2563eb;color:white;font-weight:700;cursor:pointer;margin-top:18px}
code{color:#bae6fd}footer{margin-top:28px;color:#8090aa;font-size:.85rem}
</style></head><body><main>
<div class="eyebrow">Br3eze · Local runtime</div><h1>AgentOS Gateway</h1>
<p class="muted">Your local gateway dashboard. This page is served by the same process as the gateway API.</p>
<section class="panel"><div class="status"><span id="dot" class="dot"></span><span id="state">Checking gateway…</span></div>
<div class="grid"><div class="item"><div class="label">Dashboard</div><div class="value" id="page">Loading…</div></div>
<div class="item"><div class="label">Health endpoint</div><div class="value"><a href="/health" target="_blank" rel="noreferrer">/health</a></div></div>
<div class="item"><div class="label">Readiness</div><div class="value"><a href="/health/ready" target="_blank" rel="noreferrer">/health/ready</a></div></div>
<div class="item"><div class="label">Live check</div><div class="value"><a href="/health/live" target="_blank" rel="noreferrer">/health/live</a></div></div></div>
<button id="refresh" type="button">Refresh status</button><p id="detail" class="muted" role="status"></p></section>
<footer>Local-first by default. This dashboard does not expose gateway credentials.</footer>
</main><script>
const state=document.querySelector('#state'),dot=document.querySelector('#dot'),detail=document.querySelector('#detail');
document.querySelector('#page').textContent=location.origin;
async function refresh(){state.textContent='Checking gateway…';dot.className='dot';try{const r=await fetch('/health/ready',{cache:'no-store'});const data=await r.json();if(!r.ok||data.ok===false)throw new Error(data.error||'Gateway is not ready');state.textContent='Gateway ready';dot.className='dot ok';detail.textContent='Health check passed · '+new Date().toLocaleTimeString()}catch(e){state.textContent='Gateway check failed';dot.className='dot bad';detail.textContent=e.message}}
document.querySelector('#refresh').addEventListener('click',refresh);refresh();setInterval(refresh,15000);
</script></body></html>`;

 /**
 * Domain-neutral HTTP gateway. Routes, authentication, channels, tools and
 * external services are injected by the host application.
 */
export class Gateway extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { host: config.host || '0.0.0.0', port: config.port ?? 3000, cors: config.cors, routes: config.routes || [], middleware: config.middleware || [], health: config.health || (() => ({ ok: true })), webRoot: config.webRoot || config.gateway?.webRoot, web: config.web || config.gateway?.web };
    this.app = express();
    this.server = null;
    const webRoot = resolveWebRoot(this.config);
    this.webServer = createLiveWebServer({ root: webRoot, development: this.config.web?.development ?? process.env.NODE_ENV !== 'production' });
    this._configure();
  }
  _configure() {
    this.app.disable('x-powered-by');
    this.app.use(express.json({ limit: this.config.bodyLimit || '1mb' }));
    for (const middleware of this.config.middleware) this.app.use(middleware);

    this.app.get('/health', async (req, res) => {
      try { res.json(await this.config.health(req)); }
      catch (error) { res.status(503).json({ ok: false, error: error.message }); }
    });
    this.app.get('/health/live', (_req, res) => res.json({ ok: true, live: true }));
    this.app.get('/health/ready', async (req, res) => {
      try {
        const value = await this.config.health(req);
        res.status(value?.ok === false ? 503 : 200).json(value);
      } catch (error) {
        res.status(503).json({ ok: false, error: error.message });
      }
    });

    // API and injected application routes own their paths before static fallback.
    for (const route of this.config.routes) {
      if (route?.path && route.router) this.app.use(route.path, route.router);
    }

    if (this.webServer.root) {
      this.webServer.attach(this.app, express);
      this.app.use(this.webServer);
      this.app.use((req, res) => {
        if (req.method === 'GET' && (req.path === '/api' || req.path.startsWith('/api/'))) return res.status(404).json({ error: 'API route not found' });
        return res.status(404).type('text').send('Not found');
      });
    } else {
      this.app.get('/', (_req, res) => res.type('html').send(DASHBOARD_HTML));
      this.app.get('/index.html', (_req, res) => res.type('html').send(DASHBOARD_HTML));
      this.app.use((req, res) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found' });
        return res.status(404).type('text').send('Not found');
      });
    }
  }
  addRoute(path, router) { if (!path || !router) throw new TypeError('path and router are required'); this.app.use(path, router); return this; }
  addMiddleware(middleware) { this.app.use(middleware); return this; }
  async start() { if (this.server) return this.server; this.server = http.createServer(this.app); await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.config.port, this.config.host, resolve); }); this.webServer.startWatching?.(); this.emit('started', { host: this.config.host, port: this.config.port, webRoot: this.webServer.root || null }); logger.info(`Gateway listening on ${this.config.host}:${this.config.port}`); return this.server; }
  async stop() { if (!this.server) return; this.webServer.stop?.(); await new Promise(resolve => this.server.close(() => resolve())); this.server = null; this.emit('stopped'); }
  async close() { return this.stop(); }
  getApp() { return this.app; }
}
let sharedGateway = null;

export function getGateway() {
  if (!sharedGateway) {
    sharedGateway = {
      config: {},
      logger,
      workspace: process.cwd(),
    };
  }
  return sharedGateway;
}

export default Gateway;
