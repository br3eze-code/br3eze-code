import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

const DEFAULT_ROOTS = ['agentos-pwa', 'pwa', 'public', 'dist'];

export function resolveWebRoot(config = {}, cwd = process.cwd()) {
  const configured = config.webRoot || config.web?.root || process.env.AGENTOS_WEB_ROOT;
  if (configured) {
    const root = path.resolve(cwd, configured);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Configured AgentOS web root is not a directory: ${root}`);
    }
    return fs.existsSync(path.join(root, 'index.html')) ? root : null;
  }
  for (const candidate of DEFAULT_ROOTS) {
    const root = path.resolve(cwd, candidate);
    if (fs.existsSync(path.join(root, 'index.html')) && fs.statSync(root).isDirectory()) return root;
  }
  // Deliberately do not auto-serve ./www: this repository also contains the
  // Br3eze Power Connect/Cordova application, which is not the AgentOS console.
  return null;
}

export function createLiveWebServer({ root, development = process.env.NODE_ENV !== 'production' } = {}) {
  if (!root) return { middleware: (_req, _res, next) => next(), start() {}, stop() {} };
  const webRoot = path.resolve(root);
  const clients = new Set();
  let watcher = null;
  let app = null;

  const liveScript = `<script>(()=>{const es=new EventSource('/__agentos/live');es.addEventListener('reload',()=>location.reload());es.onerror=()=>{};})();</script>`;
  const insideRoot = (file) => file === webRoot || file.startsWith(webRoot + path.sep);

  async function serveHtml(req, res, next) {
    if (req.method !== 'GET' || (!req.headers.accept?.includes('text/html') && req.path !== '/')) return next();
    if (req.path === '/__agentos/live' || req.path === '/api' || req.path.startsWith('/api/')) return next();

    let pathname;
    try { pathname = decodeURIComponent(req.path); } catch (_) { return res.status(400).end('Invalid path'); }
    const segments = pathname.split('/');
    if (segments.some((part) => part === '..')) return res.status(400).end('Invalid path');
    if (segments.some((part) => part.startsWith('.') && part !== '.' && part !== '')) return res.status(404).end('Not found');

    const hasExtension = path.posix.extname(pathname) !== '';
    let file = path.resolve(webRoot, `.${pathname}`);
    if (!insideRoot(file)) return res.status(403).end('Forbidden');
    try {
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file) && !hasExtension) file = path.join(webRoot, 'index.html');
      if (!insideRoot(file) || !fs.existsSync(file) || !fs.statSync(file).isFile() || path.extname(file).toLowerCase() !== '.html') return next();
      let html = await fs.promises.readFile(file, 'utf8');
      if (development && !html.includes("EventSource('/__agentos/live')")) {
        html = html.includes('</body>') ? html.replace('</body>', `${liveScript}</body>`) : html + liveScript;
      }
      res.set('Cache-Control', development ? 'no-store' : 'public, max-age=0, must-revalidate');
      return res.type('html').send(html);
    } catch (error) {
      return next(error);
    }
  }

  function middleware(req, res, next) {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    if (req.method === 'GET' && req.path === '/__agentos/live') {
      if (!development) return res.status(404).end();
      res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.flushHeaders?.();
      res.write('event: ready\ndata: {}\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    serveHtml(req, res, (error) => {
      if (error) return next(error);
      if (res.headersSent) return;
      const staticMiddleware = app?.locals?.agentosStatic;
      if (staticMiddleware) return staticMiddleware(req, res, next);
      return next();
    });
  }

  middleware.start = () => {
    if (app) return;
    // The owning Gateway installs the static middleware and app reference.
  };
  middleware.attach = (expressApp, expressFactory) => {
    app = expressApp;
    app.locals.agentosStatic = expressFactory.static(webRoot, {
      dotfiles: 'deny',
      fallthrough: true,
      index: false,
      etag: true,
      setHeaders(res) {
        if (development) res.setHeader('Cache-Control', 'no-store');
      }
    });
  };
  middleware.startWatching = () => {
    if (!development || watcher) return;
    try {
      watcher = fs.watch(webRoot, { recursive: true }, (eventType, filename) => {
        if (filename && String(filename).split(/[\\/]/).some((part) => part.startsWith('.'))) return;
        for (const client of clients) client.write('event: reload\ndata: {}\n\n');
      });
      watcher.on('error', (error) => {
        logger.warn(`AgentOS live reload watcher stopped: ${error.message}`);
        watcher?.close();
        watcher = null;
      });
    } catch (error) {
      logger.warn(`AgentOS live reload unavailable: ${error.message}`);
    }
  };
  middleware.stop = () => {
    watcher?.close();
    watcher = null;
    for (const client of clients) client.end();
    clients.clear();
    app = null;
  };
  middleware.root = webRoot;
  middleware.development = development;
  return middleware;
}
