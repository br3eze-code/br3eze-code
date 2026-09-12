export class ExecutionPolicy {
  constructor({ maxRetries = 2, backoffMs = 100, timeoutMs = 120000, guardrails = [] } = {}) { this.maxRetries = maxRetries; this.backoffMs = backoffMs; this.timeoutMs = timeoutMs; this.guardrails = [...guardrails]; }
  async check(stage, payload) {
    for (const guardrail of this.guardrails) {
      const result = await guardrail({ stage, ...payload });
      if (result === false || result?.allowed === false) throw new Error(result?.reason || `Guardrail blocked ${stage}`);
    }
    return true;
  }
  async retry(fn, { retries = this.maxRetries, signal } = {}) {
    let attempt = 0;
    while (true) {
      if (signal?.aborted) throw signal.reason || new Error('Execution aborted');
      try { return await fn(attempt); } catch (error) {
        if (attempt >= retries) throw error;
        await new Promise(resolve => setTimeout(resolve, this.backoffMs * 2 ** attempt));
        attempt++;
      }
    }
  }
}

export function withTimeout(promise, timeoutMs, message = 'Execution timed out') {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]).finally(() => clearTimeout(timer));
}
