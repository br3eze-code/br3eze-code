# Terminal Agent UX Research

## Findings

Claude Code’s documented terminal configuration emphasizes explicit multiline controls, terminal signal handling, notification behavior, tmux passthrough, fullscreen rendering, screen-reader fallback, and configurable status lines. Enter submits by default; Ctrl+J or terminal-specific Shift+Enter inserts a newline. Terminal setup should preserve existing bindings and adapt to the host terminal rather than assume one emulator.

Kiro CLI’s terminal UI documents a useful interaction model for AgentOS: streamed markdown and tool output, per-tool progress indicators, success/error/approval states, collapsible output, queued prompts, session history, overlay panels dismissed with Escape, explicit cancellation shortcuts, a NO_COLOR fallback, and a classic/plain-text mode for constrained or non-interactive terminals.

A reverse-engineering overview of Claude Code describes a declarative component model for terminal rendering, where the UI is state-driven rather than a collection of ad hoc cursor escape sequences. AgentOS should therefore centralize terminal state transitions and render them through a small reusable status/progress layer.

## Implementation implications

1. Use a shared terminal interaction state machine for idle, thinking, streaming, awaiting approval, cancelled, success, and error states.
2. Render animation only when stdout is a TTY and color is enabled; use line-oriented status output for CI, pipes, Windows compatibility, and screen readers.
3. Add Ctrl+C cancellation with an AbortSignal, Escape/back handling for prompts and menus, and Ctrl+J or Shift+Enter multiline input where the prompt implementation supports raw input.
4. Provide compact and expanded tool output modes, with head/tail truncation for long command output.
5. Keep all mutation tools behind visible approval states and show the scope of the pending action.

## Sources

- https://code.claude.com/docs/en/terminal-config — Claude Code terminal configuration.
- https://kiro.dev/docs/cli/terminal-ui/ — Kiro CLI terminal UI behavior and shortcuts.
- https://kotrotsos.medium.com/claude-code-internals-part-11-terminal-ui-542fe17db016 — terminal rendering architecture overview.
