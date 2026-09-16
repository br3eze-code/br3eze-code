import express from 'express';
import '../src/host/bootstrap.js';
import { handleSubmitMission, handleAbortMission, streamTaskFeed } from '../src/core/missionDispatch.js';
import { getTaskRegistry } from '../src/core/taskRegistry.js';
import { createAgentTeam, startAgentTeam, createA2AMessage, dispatchA2A, completeAgentWbsStep, getTeamTask } from '../src/core/a2a-task-protocol.js';
import { requireUser } from '../src/api/middleware/auth-provider.js';
import shopRouter from '../src/api/routes/shop.js';
import v1Router from '../src/api/routes/v1.js';
import v2Router from '../src/api/routes/v2.js';
import v3Router from '../src/api/routes/v3.js';

const app = express();

app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'agentos', protocol: 'agentos-a2a/1.0' }));

// Human/client API authentication is provider-neutral (Firebase or Supabase).
// Machine-to-machine authentication remains a separate concern and must not use req.user.
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

// Versioned APIs share the same human-auth boundary. Route modules remain focused on capabilities.
app.use('/api/v1', requireUser, v1Router);
app.use('/api/v2', requireUser, v2Router);
app.use('/api/v3', requireUser, v3Router);
app.use('/api/v1/shop', requireUser, shopRouter);

export default app;
