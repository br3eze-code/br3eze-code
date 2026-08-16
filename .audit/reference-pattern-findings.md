# Reference pattern findings

## Gemini CLI Agent Skills

Source: https://github.com/br3eze-code/gemini-cli/blob/main/docs/cli/skills.md

The documented pattern is progressive disclosure: discover skills by lightweight metadata first, activate a matching skill only when needed, and then inject the skill body and bundled directory with explicit consent. Discovery uses precedence tiers: built-in, extension, user, and workspace; `.agents/skills/` is an interoperable alias and has precedence over `.gemini/skills/` at the same tier. This supports AgentOS’s existing persona-only loading and suggests tests should verify metadata-only discovery, deterministic precedence, and explicit activation boundaries.

Source: https://github.com/br3eze-code/gemini-cli/blob/main/docs/cli/skills-best-practices.md

The repository emphasizes narrow skill descriptions, progressive disclosure, workspace sharing, and reproducible skill management rather than eagerly loading every skill into the prompt.

## OpenClaw reference lookup

The initially guessed path `gateway/platforms/base.py` returned HTTP 404, so no OpenClaw implementation was adopted from that path. Further comparisons should use paths discovered from the repository tree rather than inferred filenames.
