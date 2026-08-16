/**
 * Critical-path activity calculations for WBS and specialist charts.
 * Durations are numeric project time units (normally working days).
 * Activities must have unique ids and predecessor ids.
 */

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeActivities(activities = []) {
  if (!Array.isArray(activities)) throw new TypeError('activities must be an array');
  const ids = new Set();
  const normalized = activities.map((activity) => {
    const id = String(activity?.id || '').trim();
    if (!id) throw new Error('Activity id is required');
    if (ids.has(id)) throw new Error(`Duplicate activity id: ${id}`);
    ids.add(id);
    const predecessors = [...new Set((activity.predecessors || []).map(String))];
    return {
      ...activity,
      id,
      duration: Math.max(0, finite(activity.duration)),
      predecessors,
    };
  });
  const byId = new Map(normalized.map((activity) => [activity.id, activity]));
  for (const activity of normalized) {
    for (const predecessor of activity.predecessors) {
      if (!byId.has(predecessor)) throw new Error(`Unknown predecessor ${predecessor} for ${activity.id}`);
      if (predecessor === activity.id) throw new Error(`Activity ${activity.id} cannot depend on itself`);
    }
  }
  return normalized;
}

function topologicalOrder(activities) {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  const indegree = new Map(activities.map((activity) => [activity.id, activity.predecessors.length]));
  const successors = new Map(activities.map((activity) => [activity.id, []]));
  for (const activity of activities) for (const predecessor of activity.predecessors) successors.get(predecessor).push(activity.id);
  const queue = activities.filter((activity) => indegree.get(activity.id) === 0).map((activity) => activity.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const successor of successors.get(id)) {
      indegree.set(successor, indegree.get(successor) - 1);
      if (indegree.get(successor) === 0) queue.push(successor);
    }
  }
  if (order.length !== activities.length) throw new Error('Activity dependency cycle detected');
  return { byId, successors, order };
}

/**
 * Calculates a chart-ready activity logic table.
 * The backward pass starts at the project finish and calculates LS/LF.
 */
export function calculateActivitySchedule(input = []) {
  const activities = normalizeActivities(input);
  const { byId, successors, order } = topologicalOrder(activities);
  const values = new Map();

  for (const id of order) {
    const activity = byId.get(id);
    const earlyStart = activity.predecessors.length
      ? Math.max(...activity.predecessors.map((predecessor) => values.get(predecessor).earlyFinish))
      : 0;
    values.set(id, { earlyStart, earlyFinish: earlyStart + activity.duration });
  }

  const projectDuration = Math.max(0, ...[...values.values()].map((value) => value.earlyFinish));
  for (const id of [...order].reverse()) {
    const activity = byId.get(id);
    const nextStarts = successors.get(id).map((successor) => values.get(successor).lateStart);
    const lateFinish = nextStarts.length ? Math.min(...nextStarts) : projectDuration;
    const lateStart = lateFinish - activity.duration;
    const early = values.get(id);
    const totalFloat = lateStart - early.earlyStart;
    const successorEarlyStarts = successors.get(id).map((successor) => values.get(successor).earlyStart);
    const freeFloat = successorEarlyStarts.length
      ? Math.min(...successorEarlyStarts) - early.earlyFinish
      : projectDuration - early.earlyFinish;
    values.set(id, { ...early, lateStart, lateFinish, totalFloat, freeFloat });
  }

  const table = order.map((id, index) => {
    const activity = byId.get(id);
    const value = values.get(id);
    return {
      ...activity,
      activityNumber: activity.activityNumber || `ACT-${String(index + 1).padStart(3, '0')}`,
      earlyStart: value.earlyStart,
      earlyFinish: value.earlyFinish,
      lateStart: value.lateStart,
      lateFinish: value.lateFinish,
      totalFloat: value.totalFloat,
      freeFloat: value.freeFloat,
      critical: value.totalFloat === 0,
    };
  });

  return { projectDuration, activities: table };
}

export function activityLogicTable(schedule) {
  return (schedule?.activities || []).map((activity) => ({
    activityNumber: activity.activityNumber,
    id: activity.id,
    predecessors: activity.predecessors,
    duration: activity.duration,
    earlyStart: activity.earlyStart,
    earlyFinish: activity.earlyFinish,
    lateStart: activity.lateStart,
    lateFinish: activity.lateFinish,
    totalFloat: activity.totalFloat,
    freeFloat: activity.freeFloat,
    status: activity.status || 'planned',
    specialistRole: activity.specialistRole || null,
    critical: activity.critical,
  }));
}

export default calculateActivitySchedule;
