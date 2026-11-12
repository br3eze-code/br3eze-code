import express from 'express';

const router = express.Router();

function authenticatedUserId(req) {
  const user = req.user || {};
  const id = user.id || user.userId || user.sub;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function getObserver(res) {
  const observer = global.projectObserver;
  if (!observer || typeof observer.getEvents !== 'function' || typeof observer.getStatus !== 'function') {
    res.status(503).json({ error: 'Runtime observer is unavailable in this process', source: 'agent-runtime', connected: false });
    return null;
  }
  return observer;
}

router.get('/status', (req, res) => {
  const userId = authenticatedUserId(req);
  if (!userId) return res.status(403).json({ error: 'Authenticated user scope is required' });
  const observer = getObserver(res);
  if (!observer) return;
  const status = observer.getStatus();
  return res.json({ ...status, userScoped: true, mode: 'read-only' });
});

router.get('/events', (req, res) => {
  const userId = authenticatedUserId(req);
  if (!userId) return res.status(403).json({ error: 'Authenticated user scope is required' });
  const observer = getObserver(res);
  if (!observer) return;
  const rawLimit = Number.parseInt(String(req.query.limit || '50'), 10);
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
  const since = typeof req.query.since === 'string' ? req.query.since : null;
  return res.json({
    source: 'agent-runtime',
    mode: 'read-only',
    userScoped: true,
    events: observer.getEvents({ userId, since, limit }),
  });
});

router.get('/stream', (req, res) => {
  const userId = authenticatedUserId(req);
  if (!userId) return res.status(403).json({ error: 'Authenticated user scope is required' });
  const observer = getObserver(res);
  if (!observer) return;

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('event: ready\ndata: ' + JSON.stringify({ source: 'agent-runtime', mode: 'read-only', userScoped: true }) + '\n\n');

  const onEvent = (event) => {
    if (event.userId !== userId || res.writableEnded || res.destroyed) return;
    res.write('id: ' + event.eventId + '\nevent: runtime\ndata: ' + JSON.stringify(event) + '\n\n');
  };
  observer.on('event', onEvent);
  const cleanup = () => observer.removeListener('event', onEvent);
  req.once('close', cleanup);
  res.once('close', cleanup);
});

export default router;
