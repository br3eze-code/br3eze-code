// Phase 9 reference boundary: terminal commands must call the gateway/AskEngine boundary,
// never construct domain services or tools directly.
export const PHASE9_TERMINAL_BOUNDARY = Object.freeze({ client: 'AskClient', orchestration: 'AskEngine', ui: 'Terminal' });
