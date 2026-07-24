# Path to a domain-agnostic agent

This is the honest state of the "AI brain" in AgentOS as of the Dahua integration work,
and the concrete plan to stop hand-coding every new capability and make the agent
actually reason across whatever domains exist — cameras, routers, a shop, or anything
added after this document was written.

## The pattern that doesn't scale

Every time a new kind of question came up this session — "snapshot shop2", "summarize
what happened at shop1", "describe shop2" — the fix was the same: add another
hand-written regex rule to `src/core/ask-engine.js`'s Tier 2. That works, but it's a
treadmill. It means:

- Every new skill needs its own hand-written shortcuts, forever.
- Phrasing the AI didn't anticipate ("what's up at the store" instead of "what happened
  at shop1") just fails, because there's no real reasoning behind it — only pattern
  matching.
- The actual reasoning tier (Tier 3, the LLM) doesn't even have Dahua in its toolset,
  so fixing the API keys alone wouldn't make natural-language Dahua questions work
  through `agentos ask` — only the regex shortcuts I added would.

## Root cause: two AI implementations that don't share a brain

This is explicitly called out in `CLAUDE.md`, and it's the real blocker:

1. **`src/core/ask-engine.js`** (`AskEngine`) — used by `agentos ask` and the gateway's
   `/api/v1/ask`. Its Tier 3 (Gemini function-calling) uses a hand-written, hardcoded
   `FUNCTION_DECLARATIONS` array covering only MikroTik/vouchers/users/finance. Dahua
   isn't in it. Nothing auto-populates it from the skills that actually exist.
2. **`src/ai/coordinator.js`** (`AICoordinator`) — used by Telegram/WhatsApp chat. It
   *does* dynamically load every skill from `src/skills/*/manifest.yaml` via
   `SkillRegistry`, so it already "knows about" Dahua (and anything else with a
   manifest) with zero hand-written glue.

Two brains, one wired generically, one hardcoded, neither aware of the other. Every
fix has to be made twice or one path silently lags — which is exactly what happened:
Dahua worked in Telegram chat weeks before it worked at all in `agentos ask`.

## Orphaned domain: the shop

`src/core/shop.js` is a real, complete e-commerce backend — product catalog, per-chat
cart, atomic checkout with stock decrement, invoices, Firebase-backed. It is currently:

- Written in ES module syntax (`import` / `export default`) in a project declared
  `"type": "commonjs"` — it throws `SyntaxError: Cannot use import statement outside
  a module` the moment anything tries to `require()` it.
- Required by **nothing**. No skill, no tool map, no command references it.

It's a fully-built domain sitting completely dead — can't load, can't be reached. This
is the same class of problem `CLAUDE.md` already warns about elsewhere in the repo
("many near-duplicate files coexist... rewritten multiple times in place").

## What "domain agnostic" actually requires

Stop adding regex rules as the mechanism. Make the reasoning tier generically aware of
every skill that exists, the way `AICoordinator` already is:

1. **Generate Tier 3's function declarations from `SkillRegistry`, not by hand.**
   Every skill already declares its tools via `manifest.yaml` / `getTools()` — that's
   the single source of truth. Build Gemini function-calling schemas from it at
   startup instead of maintaining a parallel hardcoded list. The moment a new skill
   drops a `manifest.yaml` into `src/skills/`, it becomes reasoning-accessible
   everywhere, with no code change.
2. **Demote Tier 2 regex rules to an optional fast path, not the only path.** Keep a
   handful for latency-sensitive, extremely common phrasings — but once Tier 3 is
   properly skill-aware, arbitrary phrasing should fall through to real reasoning
   instead of failing outright.
3. **Fix or retire `shop.js`.** Either convert it to CommonJS and wire it as a proper
   skill (`src/skills/shop/manifest.yaml` + `index.js`, same shape as Dahua) so both
   AI paths pick it up automatically — or confirm it's abandoned and delete it. Right
   now it's neither usable nor gone.
4. **Long-term: pick one brain.** Either make `ask-engine.js`'s CLI/REST path delegate
   to the same `AICoordinator` instance the chat channels use, or keep them
   architecturally separate but force both to read tool definitions from the same
   `SkillRegistry`-driven source, so they structurally cannot diverge again.

## What's actually blocking progress right now (not code — inputs I need from you)

- **Gemini quota or the Anthropic key.** Every AI-dependent feature built this session
  (event summaries, scene descriptions, and the Tier-3 unification above) is written
  and tested except for the actual model call succeeding.
- **ONVIF credentials/permission on the NVR.** Confirmed the device exposes the
  correct standard protocol (Recording/Search/Replay services) for real video clip
  retrieval — current admin credentials are rejected specifically for ONVIF, which
  is typically a separate toggle/account under Setup → Network → ONVIF.
- **A decision on `shop.js`** — finish wiring it as a real skill, or delete it.

## Progress

- [x] **Step 1 done.** `ask-engine.js` Tier 3 now generates function declarations from
  every loaded skill's manifest (`_skillFunctionDeclarations()` / `_skillRegistry()`),
  in addition to the original hardcoded `FUNCTION_DECLARATIONS`. Dispatch checks the
  generic skill-tool map first, before falling through to the hand-written `manage_X`
  branches. Verified live: `_dispatchFunctionCall` correctly routes a generated
  `dahua__snapshot__get` call to the real skill against actual hardware, with zero
  Dahua-specific code added to this mechanism. A brand-new skill with a
  `manifest.yaml` is reasoning-accessible here automatically, the moment it's added
  — this was the actual point.
  - Known limitation carried over from the SkillRegistry design: all skills share
    one `workspace` config value (currently `adapters.cctv`), not a per-skill slice.
    Fine while Dahua is the only skill actually consuming it; would need addressing
    before a second workspace-dependent skill (e.g. a repaired `shop.js`) is wired in.
  - This is *additive* — the Tier-2 Dahua regex shortcuts from earlier in this session
    were deliberately left in place, since they're still the only thing that works
    while the LLM keys are down. Once a key is fixed and this path is confirmed
    working end-to-end with a real model call, those shortcuts become redundant and
    can be removed.

## Remaining next steps, in order

1. Once a Gemini or Anthropic key works, confirm this path end-to-end with a real
   model call (everything up to the model call itself is tested; the actual
   generate-with-tools round trip isn't, since both keys are currently down).
2. Remove the Dahua-specific Tier 2 regexes once step 1 is confirmed — they're
   redundant once Tier 3 covers the same ground for real, for any domain.
3. Resolve `shop.js`'s fate (wire it in, or remove it) so it's no longer a landmine
   for the next person who greps for "shop" and assumes it works.
