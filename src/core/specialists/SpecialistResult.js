export function specialistResult({ status = 'success', output = null, execution = null, error = null } = {}) {
  const structured = execution?.result || null;
  return Object.freeze({
    status,
    success: status === 'success' || status === 'replayed',
    tool: structured?.tool || execution?.tool || null,
    executionId: structured?.executionId || execution?.executionId || null,
    output,
    data: structured?.data ?? (status === 'success' || status === 'replayed' ? output : undefined),
    evidence: Object.freeze([...(structured?.evidence || execution?.evidence || [])]),
    warnings: Object.freeze([...(structured?.warnings || execution?.warnings || [])]),
    execution,
    error,
  });
}

export default specialistResult;
