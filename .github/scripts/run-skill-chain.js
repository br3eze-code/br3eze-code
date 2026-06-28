#!/usr/bin/env node
/**
 * AgentOS Autonomous Audit Orchestrator — Model-Agnostic Edition
 *
 * Supports:
 *   - Anthropic (Claude)  → ANTHROPIC_API_KEY
 *   - Google Gemini       → GEMINI_API_KEY
 *   - OpenAI              → OPENAI_API_KEY
 *
 * Provider is selected automatically from env vars (first found wins).
 * Override with: AGENTOS_LLM_PROVIDER=anthropic|gemini|openai
 *
 * Advanced features (extended thinking, batch, streaming) are used
 * when the provider supports them and fall back gracefully otherwise.
 *
 * Run:  node .github/scripts/run-skill-chain.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const SKILLS_DIR  = path.resolve('.github/skills');
const REPORT_DIR  = path.resolve('docs/audit');
const TODAY       = new Date().toISOString().slice(0, 10);
const REPORT_FILE = path.join(REPORT_DIR, `${TODAY}.md`);

const CHAR_LIMIT = 140_000;
const FILE_CAP   = 12_000;

const THINKING_BUDGETS = {
  security: 8000,
  bugs:     6000,
  patch:    10000,
};

// ── Logging ──────────────────────────────────────────────────────────────────
const log  = msg  => console.log(`[audit] ${msg}`);
const die  = msg  => { console.error(`[audit:FATAL] ${msg}`); process.exit(1); };
const time = label => { const t = Date.now(); return () => `${label} (${Date.now()-t}ms)`; };

// ═══════════════════════════════════════════════════════════════════════════════
// ── Provider Detection ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect which LLM provider to use.
 * Priority: explicit env var → first available API key.
 */
function detectProvider() {
  const explicit = (process.env.AGENTOS_LLM_PROVIDER || '').toLowerCase();
  if (explicit === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (explicit === 'gemini'    && process.env.GEMINI_API_KEY)    return 'gemini';
  if (explicit === 'openai'    && process.env.OPENAI_API_KEY)    return 'openai';
  if (explicit) die(`Provider "${explicit}" requested but no API key found for it.`);

  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.GEMINI_API_KEY)    return 'gemini';
  if (process.env.OPENAI_API_KEY)    return 'openai';

  die('No LLM API key found. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY.');
}

/**
 * Return default model IDs and capability flags for the selected provider.
 */
function providerConfig(provider) {
  switch (provider) {
    case 'anthropic':
      return {
        provider,
        model:            process.env.AGENTOS_LLM_MODEL || 'claude-sonnet-4-20250514',
        thinkingModel:    process.env.AGENTOS_LLM_MODEL || 'claude-sonnet-4-20250514',
        supportsThinking: true,
        supportsBatch:    true,
        supportsStream:   true,
        apiKey:           process.env.ANTHROPIC_API_KEY,
      };
    case 'gemini':
      return {
        provider,
        model:            process.env.AGENTOS_LLM_MODEL || 'gemini-2.5-pro',
        thinkingModel:    process.env.AGENTOS_LLM_MODEL || 'gemini-2.5-pro',
        supportsThinking: true,   // via thinkingConfig
        supportsBatch:    false,  // not available via REST yet
        supportsStream:   true,
        apiKey:           process.env.GEMINI_API_KEY,
      };
    case 'openai':
      return {
        provider,
        model:            process.env.AGENTOS_LLM_MODEL || 'gpt-4o',
        thinkingModel:    process.env.AGENTOS_LLM_MODEL || 'o3',
        supportsThinking: false,  // o3 reasoning is implicit; no explicit budget
        supportsBatch:    true,   // OpenAI Batch API
        supportsStream:   true,
        apiKey:           process.env.OPENAI_API_KEY,
      };
    default:
      die(`Unknown provider: ${provider}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Unified LLM call — standard ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function callLLM(cfg, system, user, opts = {}) {
  switch (cfg.provider) {
    case 'anthropic': return callAnthropic(cfg, system, user, opts);
    case 'gemini':    return callGemini(cfg, system, user, opts);
    case 'openai':    return callOpenAI(cfg, system, user, opts);
  }
}

// ── Unified LLM call — extended thinking / deep reasoning ────────────────────

async function callLLMThinking(cfg, system, user, budget) {
  if (!cfg.supportsThinking) {
    log(`WARN: ${cfg.provider} does not support explicit thinking budgets — using standard call`);
    return callLLM(cfg, system, user, { maxTokens: 8192 });
  }
  switch (cfg.provider) {
    case 'anthropic': return callAnthropicThinking(cfg, system, user, budget);
    case 'gemini':    return callGeminiThinking(cfg, system, user, budget);
    case 'openai':    return callLLM(cfg, system, user, { maxTokens: 8192, model: cfg.thinkingModel });
  }
}

// ── Unified LLM call — streaming ─────────────────────────────────────────────

async function callLLMStreaming(cfg, system, user, outputPath) {
  if (!cfg.supportsStream) {
    log(`WARN: ${cfg.provider} streaming not implemented — writing full response to file`);
    const result = await callLLM(cfg, system, user, { maxTokens: 8192 });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result, 'utf8');
    return result;
  }
  switch (cfg.provider) {
    case 'anthropic': return callAnthropicStreaming(cfg, system, user, outputPath);
    case 'gemini':    return callGeminiStreaming(cfg, system, user, outputPath);
    case 'openai':    return callOpenAIStreaming(cfg, system, user, outputPath);
  }
}

// ── Unified batch ─────────────────────────────────────────────────────────────

async function runBatch(cfg, requests) {
  if (!cfg.supportsBatch) {
    log(`INFO: ${cfg.provider} batch not supported — running sequentially`);
    return null;
  }
  switch (cfg.provider) {
    case 'anthropic': return runAnthropicBatch(cfg, requests);
    case 'openai':    return runOpenAIBatch(cfg, requests);
    default:          return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── ANTHROPIC implementation ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

function anthropicHeaders(cfg, extra = {}) {
  return {
    'Content-Type':      'application/json',
    'x-api-key':         cfg.apiKey,
    'anthropic-version': '2023-06-01',
    ...extra,
  };
}

async function callAnthropic(cfg, system, user, opts = {}) {
  const body = {
    model:      opts.model ?? cfg.model,
    max_tokens: opts.maxTokens ?? 8192,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (opts.tools) body.tools = opts.tools;

  const headers = anthropicHeaders(cfg,
    opts.tools ? { 'anthropic-beta': 'web-search-2025-03-05' } : {}
  );

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });

  if (!res.ok) {
    const b = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${b.slice(0, 400)}`);
  }
  const data = await res.json();

  if ((data.stop_reason === 'tool_use' || data.stop_reason === 'pause_turn') && opts.tools) {
    return handleAnthropicToolUse(cfg, data, system, user, opts);
  }

  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function callAnthropicThinking(cfg, system, user, budget) {
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: anthropicHeaders(cfg, { 'anthropic-beta': 'interleaved-thinking-2025-05-14' }),
    body: JSON.stringify({
      model:      cfg.thinkingModel,
      max_tokens: budget + 8192,
      thinking:   { type: 'enabled', budget_tokens: budget },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    log(`WARN: Extended thinking unavailable (${res.status}), falling back to standard`);
    return callAnthropic(cfg, system, user, { maxTokens: 8192 });
  }

  const data = await res.json();
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function callAnthropicStreaming(cfg, system, user, outputPath) {
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: anthropicHeaders(cfg),
    body: JSON.stringify({
      model:      cfg.model,
      max_tokens: 8192,
      stream:     true,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const b = await res.text();
    throw new Error(`Anthropic streaming ${res.status}: ${b.slice(0, 400)}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  let full = '';
  const decoder = new TextDecoder();
  const reader  = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          full += ev.delta.text;
          stream.write(ev.delta.text);
        }
      } catch {}
    }
  }
  stream.end();
  log(`Streaming complete → ${outputPath} (${Math.round(full.length/1000)}k chars)`);
  return full;
}

async function handleAnthropicToolUse(cfg, data, system, _user, opts) {
  const messages = [
    { role: 'user',      content: _user        },
    { role: 'assistant', content: data.content  },
  ];
  let iterations = 0;
  const MAX_ITER = 8;

  while ((data.stop_reason === 'tool_use' || data.stop_reason === 'pause_turn') && iterations < MAX_ITER) {
    iterations++;
    if (data.stop_reason === 'tool_use') {
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(tu => {
          log(`  Tool call: ${tu.name}(${JSON.stringify(tu.input).slice(0, 60)})`);
          return {
            type:        'tool_result',
            tool_use_id: tu.id,
            content:     `[Tool ${tu.name} executed by API — results in next turn]`,
          };
        });
      messages.push({ role: 'user', content: toolResults });
    } else {
      log('  Pause turn — resuming...');
    }

    const body = {
      model:      opts.model ?? cfg.model,
      max_tokens: opts.maxTokens ?? 8192,
      system, messages, tools: opts.tools,
    };
    if (data.container) body.container = data.container;

    const res2 = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method: 'POST',
      headers: anthropicHeaders(cfg, opts.tools ? { 'anthropic-beta': 'web-search-2025-03-05' } : {}),
      body: JSON.stringify(body),
    });

    if (!res2.ok) {
      log(`  Error in continuation: ${res2.status}`);
      break;
    }
    data = await res2.json();
    messages.push({ role: 'assistant', content: data.content });
  }
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

async function runAnthropicBatch(cfg, requests) {
  log(`Submitting Anthropic batch of ${requests.length} requests...`);

  // Translate unified requests → Anthropic batch format
  const batchRequests = requests.map(r => ({
    custom_id: r.id,
    params: {
      model:      cfg.thinkingModel,
      max_tokens: r.budget + 8192,
      thinking:   { type: 'enabled', budget_tokens: r.budget },
      system:     r.system,
      messages:   [{ role: 'user', content: r.user }],
    },
  }));

  const res = await fetch(`${ANTHROPIC_BASE}/messages/batches`, {
    method: 'POST',
    headers: anthropicHeaders(cfg, { 'anthropic-beta': 'message-batches-2024-09-24' }),
    body: JSON.stringify({ requests: batchRequests }),
  });

  if (!res.ok) {
    const b = await res.text();
    log(`WARN: Anthropic batch failed (${res.status}): ${b.slice(0, 200)} — falling back to sequential`);
    return null;
  }

  const batch = await res.json();
  const batchId = batch.id;
  log(`Batch submitted: ${batchId}`);

  let attempts = 0;
  while (attempts < 60) {
    await new Promise(r => setTimeout(r, 10_000));
    attempts++;

    const poll = await fetch(`${ANTHROPIC_BASE}/messages/batches/${batchId}`, {
      headers: anthropicHeaders(cfg, { 'anthropic-beta': 'message-batches-2024-09-24' }),
    });
    const status = await poll.json();
    const c = status.request_counts;
    log(`  Batch poll [${attempts}]: processing=${c.processing} succeeded=${c.succeeded} errored=${c.errored}`);

    if (status.processing_status === 'ended') {
      const resultsRes = await fetch(`${ANTHROPIC_BASE}/messages/batches/${batchId}/results`, {
        headers: anthropicHeaders(cfg, { 'anthropic-beta': 'message-batches-2024-09-24' }),
      });
      const text    = await resultsRes.text();
      const results = {};
      for (const line of text.trim().split('\n').filter(Boolean)) {
        const r = JSON.parse(line);
        if (r.result?.type === 'succeeded') {
          results[r.custom_id] = r.result.message.content
            .filter(b => b.type === 'text').map(b => b.text).join('');
        } else {
          log(`  WARN batch item ${r.custom_id} failed: ${JSON.stringify(r.result)}`);
          results[r.custom_id] = null;
        }
      }
      log(`Batch complete: ${Object.keys(results).length} results`);
      return results;
    }
  }
  log('WARN: Batch timed out — falling back to sequential');
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── GEMINI implementation ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function geminiUrl(cfg, stream = false) {
  const action = stream ? 'streamGenerateContent' : 'generateContent';
  return `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:${action}?key=${cfg.apiKey}`;
}

function geminiBody(system, user, opts = {}) {
  const body = {
    contents: [
      { role: 'user', parts: [{ text: `${system}\n\n${user}` }] }
    ],
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 8192,
      temperature: opts.temperature ?? 0.2,
    },
  };
  // Grounding / search (Gemini 2.0+)
  if (opts.tools) {
    body.tools = [{ googleSearch: {} }];
  }
  return body;
}

async function callGemini(cfg, system, user, opts = {}) {
  const res = await fetch(geminiUrl(cfg), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(geminiBody(system, user, opts)),
  });

  if (!res.ok) {
    const b = await res.text();
    throw new Error(`Gemini API ${res.status}: ${b.slice(0, 400)}`);
  }
  const data = await res.json();
  return extractGeminiText(data);
}

async function callGeminiThinking(cfg, system, user, budget) {
  // Gemini 2.5 supports thinking via thinkingConfig
  const body = geminiBody(system, user, { maxTokens: budget + 8192 });
  body.generationConfig.thinkingConfig = {
    thinkingBudget: budget,
    includeThoughts: false,  // omit thinking blocks from output
  };

  const res = await fetch(geminiUrl(cfg), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    log(`WARN: Gemini thinking unavailable (${res.status}) — falling back to standard`);
    return callGemini(cfg, system, user, { maxTokens: 8192 });
  }
  const data = await res.json();
  return extractGeminiText(data);
}

async function callGeminiStreaming(cfg, system, user, outputPath) {
  // Use streamGenerateContent with alt=sse
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:streamGenerateContent?alt=sse&key=${cfg.apiKey}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(geminiBody(system, user, { maxTokens: 8192 })),
  });

  if (!res.ok) {
    log(`WARN: Gemini streaming unavailable (${res.status}) — falling back to standard`);
    const result = await callGemini(cfg, system, user, { maxTokens: 8192 });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result, 'utf8');
    return result;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const stream  = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  let full      = '';
  const decoder = new TextDecoder();
  const reader  = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const ev   = JSON.parse(raw);
        const text = extractGeminiText(ev);
        full += text;
        stream.write(text);
      } catch {}
    }
  }
  stream.end();
  log(`Gemini streaming complete → ${outputPath} (${Math.round(full.length/1000)}k chars)`);
  return full;
}

function extractGeminiText(data) {
  try {
    return (data.candidates ?? [])
      .flatMap(c => (c.content?.parts ?? []))
      .filter(p => p.text)
      .map(p => p.text)
      .join('');
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── OPENAI implementation ─────────────────────────────────────────════════────
// ═══════════════════════════════════════════════════════════════════════════════

const OPENAI_BASE = 'https://api.openai.com/v1';

function openaiHeaders(cfg) {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
  };
}

async function callOpenAI(cfg, system, user, opts = {}) {
  const model = opts.model ?? cfg.model;
  const body = {
    model,
    max_completion_tokens: opts.maxTokens ?? 8192,
    messages: [
      { role: 'system', content: system },
      { role: 'user',   content: user   },
    ],
  };

  // Web search grounding (OpenAI responses API, gpt-4o class)
  if (opts.tools) {
    body.tools = [{ type: 'web_search_preview' }];
  }

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: openaiHeaders(cfg),
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const b = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${b.slice(0, 400)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callOpenAIStreaming(cfg, system, user, outputPath) {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: openaiHeaders(cfg),
    body: JSON.stringify({
      model:  cfg.model,
      stream: true,
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });

  if (!res.ok) {
    const b = await res.text();
    throw new Error(`OpenAI streaming ${res.status}: ${b.slice(0, 400)}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const stream  = fs.createWriteStream(outputPath, { encoding: 'utf8' });
  let full      = '';
  const decoder = new TextDecoder();
  const reader  = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const ev   = JSON.parse(raw);
        const text = ev.choices?.[0]?.delta?.content ?? '';
        if (text) { full += text; stream.write(text); }
      } catch {}
    }
  }
  stream.end();
  log(`OpenAI streaming complete → ${outputPath} (${Math.round(full.length/1000)}k chars)`);
  return full;
}

async function runOpenAIBatch(cfg, requests) {
  log(`Submitting OpenAI batch of ${requests.length} requests...`);

  // Build JSONL
  const lines = requests.map(r => JSON.stringify({
    custom_id: r.id,
    method:    'POST',
    url:       '/v1/chat/completions',
    body: {
      model:                 cfg.thinkingModel,
      max_completion_tokens: r.budget + 8192,
      messages: [
        { role: 'system', content: r.system },
        { role: 'user',   content: r.user   },
      ],
    },
  })).join('\n');

  // Upload file
  const blob = new Blob([lines], { type: 'text/plain' });
  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', blob, 'batch_input.jsonl');

  const uploadRes = await fetch(`${OPENAI_BASE}/files`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
    body:    form,
  });
  if (!uploadRes.ok) {
    const b = await uploadRes.text();
    log(`WARN: OpenAI file upload failed: ${b.slice(0, 200)} — falling back to sequential`);
    return null;
  }
  const file = await uploadRes.json();

  // Create batch
  const batchRes = await fetch(`${OPENAI_BASE}/batches`, {
    method:  'POST',
    headers: { ...openaiHeaders(cfg) },
    body:    JSON.stringify({
      input_file_id:     file.id,
      endpoint:          '/v1/chat/completions',
      completion_window: '24h',
    }),
  });
  if (!batchRes.ok) {
    log(`WARN: OpenAI batch creation failed — falling back to sequential`);
    return null;
  }
  const batch = await batchRes.json();
  log(`OpenAI batch submitted: ${batch.id}`);

  // Poll
  let attempts = 0;
  while (attempts < 60) {
    await new Promise(r => setTimeout(r, 10_000));
    attempts++;
    const poll    = await fetch(`${OPENAI_BASE}/batches/${batch.id}`, { headers: openaiHeaders(cfg) });
    const status  = await poll.json();
    log(`  OpenAI batch poll [${attempts}]: status=${status.status} completed=${status.request_counts?.completed}`);

    if (status.status === 'completed') {
      const outRes  = await fetch(`${OPENAI_BASE}/files/${status.output_file_id}/content`, { headers: openaiHeaders(cfg) });
      const text    = await outRes.text();
      const results = {};
      for (const line of text.trim().split('\n').filter(Boolean)) {
        const r = JSON.parse(line);
        results[r.custom_id] = r.response?.body?.choices?.[0]?.message?.content ?? null;
      }
      log(`OpenAI batch complete: ${Object.keys(results).length} results`);
      return results;
    }
    if (['failed', 'expired', 'cancelled'].includes(status.status)) {
      log(`WARN: OpenAI batch ${status.status} — falling back to sequential`);
      return null;
    }
  }
  log('WARN: OpenAI batch timed out — falling back to sequential');
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Skill & source helpers ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

function loadSkill(filename) {
  const p = path.join(SKILLS_DIR, filename);
  if (!fs.existsSync(p)) die(`Skill not found: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

function parsePhase(skillContent, phaseLabel) {
  const rx    = new RegExp(`^## ${phaseLabel}$`, 'm');
  const match = rx.exec(skillContent);
  if (!match) die(`Phase "${phaseLabel}" not found in skill`);
  const start       = match.index + match[0].length;
  const nextHeading = /^## /m.exec(skillContent.slice(start));
  const end         = nextHeading ? start + nextHeading.index : skillContent.length;
  return skillContent.slice(start, end).replace(/^> .+\n/gm, '').trim();
}

function collectSourceFiles() {
  const rootFiles = [
    'agentos.js', 'agentos.mjs', 'package.json', 'SKILL.md', 'SPEC.md',
    'START_HERE.md', 'firestore.rules', 'firestore.indexes.json', 'firebase.json',
    'agentos-sentinel.rsc', 'mikro.rsc', 'deploy.sh', 'deploy.yml',
    'agentos.yaml', 'docker-compose.yml', 'config.xml', 'jsconfig.json',
    'tsconfig.json', 'flake.nix', 'install.sh', 'migration.js',
    'test-firebase.js', 'test-mikrotik.js', 'test.br3eze.js', '.env.example',
    'scripts/security-check.js', 'scripts/postinstall.js', 'scripts/preuninstall.js',
  ];
  const sourceDirs = [
    'src', 'adapters', 'agents', 'tools', 'services', 'server',
    'skills', 'bin', 'config', 'scripts', 'tests', 'typings',
    'www', 'apps/shared/AgentOSkit', 'vscode-extension/src',
    'custom-plugins/cordova-plugin-aicore', 'test-planner',
  ];
  const allowedExts = new Set([
    '.js', '.mjs', '.ts', '.tsx', '.json', '.md', '.yaml', '.yml',
    '.rsc', '.sh', '.ps1', '.nix', '.html', '.css', '.xml', '.rules',
  ]);
  const skipDirs = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage',
    '.cordova', 'platforms', 'plugins',
  ]);

  const files = {};
  let totalChars = 0;

  const addFile = fp => {
    if (totalChars >= CHAR_LIMIT || !fs.existsSync(fp)) return;
    try {
      if (fs.statSync(fp).size > 200_000) return;
      const c = fs.readFileSync(fp, 'utf8').slice(0, FILE_CAP);
      files[fp] = c;
      totalChars += c.length;
    } catch {}
  };

  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || skipDirs.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (allowedExts.has(path.extname(e.name))) addFile(full);
      }
    } catch {}
  };

  for (const f of rootFiles) addFile(f);
  for (const d of sourceDirs) walk(d);

  log(`Source: ${Object.keys(files).length} files, ${Math.round(totalChars/1000)}k chars`);
  return files;
}

function parseJSON(raw, label) {
  if (!raw) { log(`WARN ${label}: null response`); return null; }
  const clean = raw
    .replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/```$/m, '').trim();
  try   { return JSON.parse(clean); }
  catch (e) {
    log(`WARN ${label}: JSON parse failed — ${e.message}`);
    log(`Snippet: ${clean.slice(0, 300)}`);
    return null;
  }
}

function applyPatch(patch) {
  if (!fs.existsSync(patch.file)) {
    log(`  SKIP ${patch.finding_id}: file not found`); return false;
  }
  let src = fs.readFileSync(patch.file, 'utf8');
  const n = src.split(patch.search).length - 1;
  if (n === 0) { log(`  SKIP ${patch.finding_id}: search not found in ${patch.file}`); return false; }
  if (n  > 1)  { log(`  SKIP ${patch.finding_id}: not unique (${n} hits)`);            return false; }
  fs.writeFileSync(patch.file, src.replace(patch.search, patch.replace), 'utf8');
  log(`  PATCHED ${patch.finding_id}: ${patch.file} — ${patch.description}`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM = `You are an autonomous AI agent performing a weekly security and quality audit of the AgentOS repository for Brighton Mzacana / Br3eze Africa.
AgentOS: AI-powered MikroTik community WiFi billing platform for Zimbabwe.
Stack: Node.js CJS ≥22, Firebase/Firestore, routeros-client v1.1.1, Telegram, WhatsApp (Baileys optional), Mastercard A2A, Gemini 2.5/Anthropic/OpenAI ReAct agents.
Sub-projects: apps/shared/AgentOSkit, vscode-extension, custom-plugins/cordova-plugin-aicore, www (captive portal), scripts/.
Follow each instruction exactly. Output only what is specified.`;

// ── Web-search tool definition — provider-normalised ─────────────────────────
function webSearchTool(provider) {
  switch (provider) {
    case 'anthropic': return { type: 'web_search_20250305', name: 'web_search' };
    case 'gemini':    return { type: 'googleSearch' };        // passed via opts.tools
    case 'openai':    return { type: 'web_search_preview' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── Main ──────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  const provider = detectProvider();
  const cfg      = providerConfig(provider);

  log(`=== AgentOS Autonomous Audit ===`);
  log(`Date:     ${TODAY}`);
  log(`Provider: ${cfg.provider}`);
  log(`Model:    ${cfg.model}${cfg.supportsThinking ? ` (thinking: ${cfg.thinkingModel})` : ''}`);
  log(`Features: thinking=${cfg.supportsThinking} batch=${cfg.supportsBatch} stream=${cfg.supportsStream}`);

  const skills = {
    audit:    loadSkill('audit.skill.md'),
    security: loadSkill('security.skill.md'),
    bugfix:   loadSkill('bugfix.skill.md'),
    research: loadSkill('research.skill.md'),
    patch:    loadSkill('patch.skill.md'),
  };
  log(`Skills loaded: ${Object.keys(skills).join(', ')}`);

  const source   = collectSourceFiles();
  const srcBlock = Object.entries(source)
    .map(([p, c]) => `### FILE: ${p}\n\`\`\`\n${c}\n\`\`\``)
    .join('\n\n');

  const ctx = {};

  // ── PHASE 1: RECON ──────────────────────────────────────────────────────────
  log('\n[PHASE 1: RECON — standard]');
  const t1 = time('PHASE 1');
  const p1prompt = parsePhase(skills.audit, 'PHASE 1');
  const r1 = await callLLM(cfg, SYSTEM,
    `${p1prompt}\n\n<codebase>\n${srcBlock}\n</codebase>`);
  ctx.recon = parseJSON(r1, 'PHASE 1');
  log(t1());
  log(`Files mapped:  ${Object.keys(ctx.recon?.file_map ?? {}).length}`);
  log(`Version drift: ${ctx.recon?.version?.drift ? '⚠️  YES' : 'no'}`);
  log(`Wildcard deps: ${(ctx.recon?.wildcard_deps ?? []).join(', ') || 'none'}`);

  // ── PHASES 2+3: SECURITY + BUGS — Batch (if supported) ─────────────────────
  log('\n[PHASE 2+3: SECURITY + BUGS — deep reasoning + batch if available]');
  const t23 = time('PHASE 2+3');

  const secPrompt = parsePhase(skills.security, 'SECURITY_AUDIT');
  const bugPrompt = parsePhase(skills.bugfix,   'BUG_HUNT');

  const batchInputs = [
    {
      id:     'security',
      system: SYSTEM,
      user:   `${secPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<codebase>${srcBlock}</codebase>`,
      budget: THINKING_BUDGETS.security,
    },
    {
      id:     'bugs',
      system: SYSTEM,
      user:   `${bugPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<codebase>${srcBlock}</codebase>`,
      budget: THINKING_BUDGETS.bugs,
    },
  ];

  const batchResults = await runBatch(cfg, batchInputs);

  if (batchResults) {
    ctx.security = parseJSON(batchResults['security'], 'PHASE 2 (batch)');
    ctx.bugs     = parseJSON(batchResults['bugs'],     'PHASE 3 (batch)');
  } else {
    log('Fallback: running PHASE 2 + 3 sequentially with deep reasoning...');
    const r2 = await callLLMThinking(cfg, SYSTEM,
      `${secPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<codebase>${srcBlock}</codebase>`,
      THINKING_BUDGETS.security);
    ctx.security = parseJSON(r2, 'PHASE 2');

    const r3 = await callLLMThinking(cfg, SYSTEM,
      `${bugPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<security>${JSON.stringify(ctx.security)}</security>\n<codebase>${srcBlock}</codebase>`,
      THINKING_BUDGETS.bugs);
    ctx.bugs = parseJSON(r3, 'PHASE 3');
  }

  log(t23());
  const ss = ctx.security?.summary ?? {};
  const bs = ctx.bugs?.summary     ?? {};
  log(`Security: CRITICAL=${ss.CRITICAL} HIGH=${ss.HIGH} MEDIUM=${ss.MEDIUM} LOW=${ss.LOW}`);
  log(`Bugs:     CRASH=${bs.CRASH}     HIGH=${bs.HIGH} MEDIUM=${bs.MEDIUM} LOW=${bs.LOW}`);

  // ── PHASE 4: RESEARCH with web search ───────────────────────────────────────
  log('\n[PHASE 4: RESEARCH — web search]');
  const t4 = time('PHASE 4');
  const resPrompt = parsePhase(skills.research, 'RESEARCH');
  const r4 = await callLLM(cfg, SYSTEM,
    `${resPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<security>${JSON.stringify(ctx.security)}</security>\n<bugs>${JSON.stringify(ctx.bugs)}</bugs>`,
    { tools: [webSearchTool(cfg.provider)], maxTokens: 8192 }
  );
  ctx.research = parseJSON(r4, 'PHASE 4');
  log(t4());
  log(`Research items: ${ctx.research?.research?.length ?? 0}`);

  // ── PHASE 5: PATCH — deep reasoning ─────────────────────────────────────────
  log('\n[PHASE 5: PATCH — deep reasoning]');
  const t5 = time('PHASE 5');
  const patchPrompt = parsePhase(skills.patch, 'PATCH_GENERATION');
  const r5 = await callLLMThinking(cfg, SYSTEM,
    `${patchPrompt}\n\n<security>${JSON.stringify(ctx.security)}</security>\n<bugs>${JSON.stringify(ctx.bugs)}</bugs>\n<research>${JSON.stringify(ctx.research)}</research>\n<codebase>${srcBlock}</codebase>`,
    THINKING_BUDGETS.patch
  );
  ctx.patches = parseJSON(r5, 'PHASE 5') ?? { patches: [], skipped: [] };

  const applied = [];
  const failed  = [];
  const sorted  = (ctx.patches.patches ?? []).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  for (const patch of sorted) {
    (applyPatch(patch) ? applied : failed).push(patch.finding_id);
  }
  ctx.patches._applied = applied;
  ctx.patches._failed  = failed;
  log(t5());
  log(`Patches applied: [${applied.join(', ') || 'none'}]`);
  log(`Patches skipped: [${[...failed, ...(ctx.patches.skipped?.map(s=>s.finding_id)??[])].join(', ') || 'none'}]`);

  // ── PHASE 6: REPORT — streaming ─────────────────────────────────────────────
  log('\n[PHASE 6: REPORT — streaming]');
  const t6 = time('PHASE 6');
  const reportPrompt = parsePhase(skills.audit, 'PHASE 6').replace('{{ DATE }}', TODAY);
  ctx.report = await callLLMStreaming(cfg, SYSTEM,
    `${reportPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<security>${JSON.stringify(ctx.security)}</security>\n<bugs>${JSON.stringify(ctx.bugs)}</bugs>\n<research>${JSON.stringify(ctx.research)}</research>\n<patches>${JSON.stringify(ctx.patches)}</patches>`,
    REPORT_FILE
  );
  log(t6());

  // ── Summary ──────────────────────────────────────────────────────────────────
  const summary = {
    date:            TODAY,
    provider:        cfg.provider,
    model:           cfg.model,
    features_used:   [
      cfg.supportsThinking && 'deep_reasoning',
      cfg.supportsBatch    && 'batch_api',
      'web_search',
      cfg.supportsStream   && 'streaming',
    ].filter(Boolean),
    source_files:    Object.keys(source).length,
    security:        ctx.security?.summary  ?? {},
    bugs:            ctx.bugs?.summary      ?? {},
    research_count:  ctx.research?.research?.length ?? 0,
    patches_applied: applied,
    patches_skipped: failed,
    version_drift:   ctx.recon?.version?.drift ?? false,
    wildcard_deps:   ctx.recon?.wildcard_deps  ?? [],
    report:          REPORT_FILE,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'latest.json'), JSON.stringify(summary, null, 2), 'utf8');

  log('\n=== Done ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => die(e.stack ?? e.message));
