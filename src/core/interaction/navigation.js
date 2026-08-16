const NAVIGATION_ACTIONS = Object.freeze({
  BACK: 'back',
  CANCEL: 'cancel',
});

const BACK_INPUTS = new Set(['back', 'go back', '← back', '⬅️ back', '🔙 back', '/back']);
const CANCEL_INPUTS = new Set(['cancel', 'quit', 'exit', 'q', '/cancel', '/quit']);

function normalizeNavigation(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (BACK_INPUTS.has(value)) return NAVIGATION_ACTIONS.BACK;
  if (CANCEL_INPUTS.has(value)) return NAVIGATION_ACTIONS.CANCEL;
  return null;
}

function isBack(input) {
  return normalizeNavigation(input) === NAVIGATION_ACTIONS.BACK;
}

function isCancel(input) {
  return normalizeNavigation(input) === NAVIGATION_ACTIONS.CANCEL;
}

export { NAVIGATION_ACTIONS, normalizeNavigation, isBack, isCancel };
