#!/usr/bin/env node
/**
 * One local HTTP entry point for the PWA/static pages and the existing API app.
 * Development binds to loopback by default; network exposure must be explicit.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app as apiApp } from '../api/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const mode = args.has('--mode=prod') ? 'production' : 'development';
const requestedSource = process.env.SERVE_SOURCE;
const defaultSource = mode === 'production' ? 'dist-web' : 'www';
const sourceDir = path.resolve(root, requestedSource || defaultSource);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'].includes(host)) {
  throw new Error('HOST must be a loopback address or an explicit wildcard bind (0.0.0.0/::).');
}
if (!fs.existsSync(path.join(sourceDir, mode === 'production' ? 'index.html' : 'home.html'))) {
  throw new Error(`Missing expected homepage in ${sourceDir}. Run npm run vercel:build for production serving.`);
}

const server = express();
server.disable('x-powered-by');
server.use(apiApp);
server.get('/_serve/health', (_req, res) => {
  res.json({ ok: true, mode, host, port, staticRoot: path.relative(root, sourceDir) });
});
server.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'No API route matches this request.' });
});
server.get('/', (_req, res) => {
  res.sendFile(path.join(sourceDir, mode === 'production' ? 'index.html' : 'home.html'));
});
server.get('/connect.html', (_req, res, next) => {
  const target = path.join(sourceDir, 'connect.html');
  if (fs.existsSync(target)) return res.sendFile(target);
  if (mode !== 'production') return res.sendFile(path.join(sourceDir, 'index.html'));
  return next();
});
server.use(express.static(sourceDir, {
  index: false,
  dotfiles: 'deny',
  fallthrough: true,
  setHeaders(res, filePath) {
    if (/\.(?:html?|js|css|json)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));
server.use((req, res) => {
  if (req.method === 'GET' && req.path.endsWith('.html')) {
    return res.status(404).type('text/plain').send('HTML page not found');
  }
  return res.status(404).json({ error: 'not_found', path: req.path });
});

const listener = server.listen(port, host, () => {
  console.log(`[serve] mode=${mode} url=http://${host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host}:${port} staticRoot=${path.relative(root, sourceDir)}`);
  if (host === '0.0.0.0' || host === '::') console.warn('[serve] WARNING: listening on network interfaces; ensure firewall/authentication are configured.');
});
function shutdown(signal) {
  console.log(`[serve] ${signal}; shutting down`);
  listener.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
