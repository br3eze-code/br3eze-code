import express from 'express';
import { handleSubmitMission, handleAbortMission, streamTaskFeed } from '../src/core/missionDispatch.js';
import { getTaskRegistry } from '../src/core/taskRegistry.js';
import { createAgentTeam, startAgentTeam, createA2AMessage, dispatchA2A, completeAgentWbsStep, getTeamTask } from '../src/core/a2a-task-protocol.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'agentos', protocol: 'agentos-a2a/1.0' }));
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
app.post('/api/a2a/message', async (req, res) => {
  try {
    const message = createA2AMessage(req.body);
    const result = await dispatchA2A({ message });
    return res.status(202).json(result);
  } catch (error) { return res.status(400).json({ error: error.message, code: error.code, details: error.details }); }
});
app.post('/api/tasks/:taskId/wbs/:stepId/complete', (req, res) => {
  try { return res.json(completeAgentWbsStep({ taskId: req.params.taskId, stepId: req.params.stepId, ...req.body })); }
  catch (error) { return res.status(400).json({ error: error.message, code: error.code }); }
});

export default app;
