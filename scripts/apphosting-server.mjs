import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import app from '../api/index.js';

const port = Number(process.env.PORT || process.env.GATEWAY_PORT || 8080);
const host = process.env.HOSTNAME || process.env.GATEWAY_HOST || '0.0.0.0';
const root = path.dirname(fileURLToPath(import.meta.url));
const www = path.join(root, '..', 'www');

app.use(express.static(www, { extensions: ['html'], index: 'index.html' }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'agentos', runtime: 'apphosting' }));

const server = app.listen(port, host, () => {
  console.log(`[agentos] App Hosting HTTP server listening on ${host}:${port}`);
});

function shutdown(signal) {
  console.log(`[agentos] ${signal} received; closing HTTP server`);
  server.close(() => process.exit(0));
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
