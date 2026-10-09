// Vercel API gateway for the AgentOS frontend.
// The backend remains the canonical runtime (Firebase Functions / Cloud Run).
// This file only proxies HTTP API requests; it does not duplicate backend logic.

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length'
]);

function getBackendUrl(req) {
  const configured = process.env.AGENTOS_API_URL || process.env.VITE_API_URL;
  if (!configured) {
    throw new Error('AGENTOS_API_URL is not configured');
  }

  const base = new URL(configured);
  const requestHost = String(req.headers.host || '').toLowerCase();
  if (base.host.toLowerCase() === requestHost) {
    throw new Error('AGENTOS_API_URL points back to the Vercel deployment');
  }

  return base;
}

export default async function handler(req, res) {
  try {
    const base = getBackendUrl(req);
    const path = Array.isArray(req.query.path)
      ? req.query.path.join('/')
      : String(req.query.path || '');

    const target = new URL(`/api/${path}`, base);
    for (const [key, value] of Object.entries(req.query || {})) {
      if (key === 'path') continue;
      if (Array.isArray(value)) {
        for (const item of value) target.searchParams.append(key, String(item));
      } else if (value != null) {
        target.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (!HOP_BY_HOP.has(key.toLowerCase()) && value != null) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
      }
    }
    headers.set('host', target.host);

    let body;
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      if (Buffer.isBuffer(req.body)) body = req.body;
      else if (typeof req.body === 'string') body = req.body;
      else if (req.body != null) {
        body = JSON.stringify(req.body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
    }

    const upstream = await fetch(target, {
      method: req.method || 'GET',
      headers,
      body,
      redirect: 'manual'
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
    });

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    console.error('AgentOS API proxy failed:', error);
    res.status(503).json({
      error: 'backend_unavailable',
      message: 'AgentOS backend is not configured or reachable'
    });
  }
}
