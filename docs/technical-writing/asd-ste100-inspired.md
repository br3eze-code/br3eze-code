# AgentOS Technical Writing Rules

## Purpose

Use clear and consistent language in AgentOS instructions, tool descriptions, CLI help, error messages, and troubleshooting guides.

These rules are inspired by ASD-STE100. They are not a claim of formal ASD-STE100 compliance. Formal compliance requires the current controlled vocabulary and grammar rules from the official standard.

## Writing rules

1. Write one action or idea per sentence.
2. Use a direct verb. Prefer "Open the dashboard" to "The dashboard should be opened."
3. Use the same name for the same component. Use "Gateway", "AgentRuntime", "ToolRegistry", and "diagnostic event" consistently.
4. Put steps in the order that a person must follow.
5. State the condition, action, and expected result.
6. Use the exact command, path, endpoint, or interface label. Do not rename technical identifiers to simplify the prose.
7. Explain an abbreviation before its first use when the reader may not know it.
8. Keep error messages specific. State what failed and the next safe action.
9. Do not claim a capability unless the current provider supports it.
10. Keep security limits beside the instructions they affect.

## Error-message pattern

Use this pattern when a message needs user guidance:

- **What happened:** state the failed action.
- **What it means:** give the relevant condition.
- **Next step:** name one safe action.

Example:

- Avoid: "Something went wrong. Try again."
- Prefer: "The gateway is not ready. Check the gateway status, then retry the request."

## Diagnostic tool descriptions

- Start with an action verb.
- State what the tool reads or changes.
- State an important permission or availability limit.
- Do not imply that browser observation can read operating-system notifications.

## Automated checks

Run `npm run check:technical-writing` before review.

The check covers selected diagnostic documentation, diagnostic tool descriptions, and the CLI diagnostics command. It checks sentence length and a short list of vague terms. It does not validate the full ASD-STE100 vocabulary, grammar, or formal compliance. A passing result is a useful language check, not proof that every technical instruction is correct.
