export function specialistResult({ status = 'success', output = null, execution = null, error = null } = {}) {
  return Object.freeze({
    status,
    output,
    execution,
    error,
  });
}

export default specialistResult;
