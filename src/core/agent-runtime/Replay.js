import { randomUUID } from 'node:crypto';

export class TrajectoryRecorder {
  constructor({ sink = null } = {}) { this.sink = sink; this.events = new Map(); }
  record(event) {
    const executionId = event.executionId || 'unknown';
    const list = this.events.get(executionId) || [];
    list.push({ ...structuredClone(event), recordedAt: new Date().toISOString() });
    this.events.set(executionId, list);
    return list.at(-1);
  }
  get(executionId) { return structuredClone(this.events.get(executionId) || []); }
  async flush(executionId) {
    const trajectory = this.get(executionId);
    if (this.sink && trajectory.length) await this.sink({ replayId: randomUUID(), executionId, trajectory });
    return trajectory;
  }
  clear(executionId) { this.events.delete(executionId); }
}

export function replayTrajectory(trajectory, { onEvent = null, fromStep = 0 } = {}) {
  if (!Array.isArray(trajectory)) throw new TypeError('trajectory must be an array');
  const selected = trajectory.filter((event) => (event.step ?? 0) >= fromStep);
  for (const event of selected) onEvent?.(structuredClone(event));
  return { count: selected.length, executionId: selected[0]?.executionId || null, events: structuredClone(selected) };
}

export default TrajectoryRecorder;
