const TRANSITIONS = Object.freeze({
  created: ['funded', 'cancelled'],
  funded: ['working', 'cancelled'],
  working: ['verifying', 'cancelled'],
  verifying: ['released', 'human_review', 'rejected'],
  human_review: ['released', 'rejected'],
  rejected: [],
  released: [],
  cancelled: [],
});

export function canTransition(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionJob(job, to, metadata = {}) {
  if (!job?.status) throw new Error('Job status is required');
  if (!canTransition(job.status, to)) {
    throw new Error(`Invalid job transition: ${job.status} -> ${to}`);
  }

  const now = new Date().toISOString();
  return {
    ...job,
    status: to,
    updatedAt: now,
    history: [
      ...(job.history ?? []),
      {
        from: job.status,
        to,
        at: now,
        ...metadata,
      },
    ],
  };
}

export { TRANSITIONS };
