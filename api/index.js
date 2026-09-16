import express from 'express';
import '../src/host/bootstrap.js';
import { handleSubmitMission, handleAbortMission, streamTaskFeed } from '../src/core/missionDispatch.js';
import { getTaskRegistry } from '../src/core/taskRegistry.js';
import { createAgentTeam, startAgentTeam, createA2AMessage, dispatchA2A, completeAgentWbsStep, getTeamTask } from '../src/core/a2a-task-protocol.js';
import { verifyFirebaseIdToken } from '../src/core/firebase-auth.js';
import { resolveSupabaseUser } from '../src/api/middleware/supabase-auth.js';
import shopRouter from '../src/api/routes/shop.js';

const app = express();

async function requireFirebaseUser(req, res, next) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Bearer token required' });
  const user = await verifyFirebaseIdToken(match[1]);
  if (!user) return res.status(401).json({ error: 'Invalid or expired Firebase token' });
  req.firebaseUser = user;
  req.user = user;
  return next();
}

async function requireUser(req, res, next) {
  const header = String(req.get('authorization') || '');
  if (!/^Bearer\s+/i.test(header)) return res.status(401).json({ error: 'Bearer token required' });
  const supabaseUser = await resolveSupabaseUser(req);
  if (supabaseUser) {
    req.user = supabaseUser;
    req.firebaseUser = supabaseUser;
    req.supabaseUser = supabaseUser;
    return next();
  }
  return requireFirebaseUser(req, res, next);
}

app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'agentos', protocol: 'agentos-a2a/1.0' }));

app.use('/api/tasks', requireUser);
app.post('/api/tasks', handleSubmitMission);
app.get('/api/tasks/:taskId', (req, res) => {
  const task = getTaskRegistry().get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.json(task);
});
app.get('/api/tasks/:taskId/team', (req, res) => {
  try { return res.json(getTeamTask(req.params.taskId)); }
  catch (error) { return res.status(error.code === 'A2A_TASK_NOT_FOUND' ? 404 : 400).json({ error: error.message, code: error.code }); }
});
app.get('/api/tasks/:taskId/stream', streamTaskFeed);
app.post('/api/tasks/:taskId/cancel', handleAbortMission);
app.post('/api/tasks/:taskId/team', (req, res) => {
  try { return res.status(201).json(createAgentTeam({ taskId: req.params.taskId, ...req.body })); }
  catch (error) { return res.status(400).json({ error: error.message, code: error.code }); }
});
app.post('/api/tasks/:taskId/team/start', (req, res) => {
  try { return res.json(startAgentTeam(req.params.taskId)); }
  catch (error) { return res.status(400).json({ error: error.message, code: error.code }); }
});

app.use('/api/a2a', requireUser);
app.post('/api/a2a/message', async (req, res) => {
  try {
    const message = createA2AMessage(req.body);
    const result = await dispatchA2A({ message });
    return res.status(202).json(result);
  } catch (error) { return res.status(400).json({ error: error.message, code: error.code, details: error.details }); }
});

app.post('/api/tasks/:taskId/wbs/:stepId/complete', requireUser, (req, res) => {
  try { return res.json(completeAgentWbsStep({ taskId: req.params.taskId, stepId: req.params.stepId, ...req.body })); }
  catch (error) { return res.status(400).json({ error: error.message, code: error.code }); }
});

app.use('/api/v1/shop', requireUser, shopRouter);

export default app;
