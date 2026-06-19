/**
 * AgentOS Hermes — agent.js
 * ReAct Loop: Thought → Action → Observation → Answer
 * Pico/Hermes-equivalent client-side agent harness
 */
'use strict';

const Agent = (() => {

  // ── State ──────────────────────────────────────────────────────
  let _history    = [];   // {role, content}[]
  let _sessionId  = null;
  let _running    = false;

  // ── DOM refs (lazy) ───────────────────────────────────────────
  const el = () => ({
    thread:   document.getElementById('agent-thread'),
    thinking: document.getElementById('agent-thinking'),
    thLabel:  document.getElementById('thinking-label'),
    thSteps:  document.getElementById('thinking-steps'),
    input:    document.getElementById('agent-input'),
    sendBtn:  document.getElementById('send-btn'),
    model:    document.getElementById('agent-model'),
  });

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    _sessionId = 'ses-' + Date.now();
    const saved = Store.get(KEYS.HISTORY, []);
    if (saved.length) {
      _history = saved;
      saved.forEach(m => {
        if (m.role === 'user')      _appendUser(m.content);
        else if (m.role === 'assistant') _appendAgent(m.content);
      });
      _removeWelcome();
    }
  }

  // ── Entry ──────────────────────────────────────────────────────
  async function send() {
    const e = el();
    const text = e.input.value.trim();
    if (!text || _running) return;

    if (!Client.hasConfig()) {
      UI.toast('Configure gateway URL in Settings first', 'wrn');
      App.switchTab('settings');
      return;
    }

    _removeWelcome();
    e.input.value = '';
    _autoResize(e.input);

    _appendUser(text);
    _history.push({ role: 'user', content: text });
    _save();

    await _reactLoop(text);
  }

  function sendHint(btn) {
    const e = el();
    e.input.value = btn.textContent.trim();
    send();
  }

  function onKey(ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
    _autoResize(ev.target);
  }

  function clearHistory() {
    _history = [];
    Store.del(KEYS.HISTORY);
    const e = el();
    e.thread.innerHTML = '';
    _appendWelcome();
  }

  // ── ReAct loop ─────────────────────────────────────────────────
  async function _reactLoop(userPrompt) {
    const e       = el();
    const maxTurns = parseInt(Store.get(KEYS.TURNS, CFG.REACT_MAX_TURNS)) || CFG.REACT_MAX_TURNS;
    _setRunning(true);

    let turnCount = 0;
    let lastThought = '';
    let finalAnswer = '';

    try {
      while (turnCount < maxTurns) {
        turnCount++;
        _setThinking(`Turn ${turnCount}/${maxTurns} — Reasoning…`, e);

        // ── Ask the backend AI ──────────────────────────────────
        let aiReply;
        try {
          const res = await Client.v2.ask(
            _buildReActPrompt(userPrompt, lastThought),
            _sessionId
          );
          aiReply = res.data?.response || res.data?.text || res.data || '';
          if (typeof aiReply === 'object') aiReply = JSON.stringify(aiReply, null, 2);
        } catch (err) {
          // If no AI backend, use local intent parser
          aiReply = _localFallback(userPrompt);
        }

        // ── Parse ReAct output ──────────────────────────────────
        const parsed = _parseReAct(aiReply);

        if (parsed.thought) {
          lastThought = parsed.thought;
          _addThinkStep(parsed.thought, turnCount, e);
        }

        // ── Execute tool action ─────────────────────────────────
        if (parsed.action && parsed.action !== 'FINAL_ANSWER') {
          _setThinking(`Calling ${parsed.action}…`, e);
          _appendToolCall(parsed.action, parsed.actionInput);

          let observation;
          try {
            const result = await Tools.run(parsed.action, parsed.actionInput || {});
            observation = result.text;
            _appendToolResult(observation);
          } catch (toolErr) {
            observation = `ERROR: ${toolErr.message}`;
            _appendToolResult(observation, true);
          }

          // Feed observation back as context
          lastThought = `${parsed.thought}\nObservation: ${observation}`;
          _history.push({ role: 'tool', tool: parsed.action, content: observation });
          continue; // next turn
        }

        // ── Final answer ────────────────────────────────────────
        finalAnswer = parsed.finalAnswer || parsed.answer || aiReply;
        break;
      }

      if (!finalAnswer) finalAnswer = lastThought || '(No answer generated)';

    } catch (err) {
      finalAnswer = `Agent error: ${err.message}`;
    }

    _setRunning(false);
    _clearThinking(e);
    _appendAgent(finalAnswer);
    _history.push({ role: 'assistant', content: finalAnswer });
    _save();
    App.addActivity(finalAnswer.slice(0, 80) + (finalAnswer.length > 80 ? '…' : ''), 'ok');
  }

  // ── Prompt builder ─────────────────────────────────────────────
  function _buildReActPrompt(userPrompt, context) {
    return [
      `You are AgentOS Hermes, an AI agent for MikroTik hotspot network management in Zimbabwe.`,
      `You run a ReAct loop: think step by step, then call ONE tool if needed, then answer.`,
      ``,
      `FORMAT (strict):`,
      `Thought: <your reasoning>`,
      `Action: <tool_id>  [or FINAL_ANSWER if no tool needed]`,
      `Action Input: {"key":"value"}`,
      `  -- after seeing the Observation, continue --`,
      `Final Answer: <your natural language response>`,
      ``,
      `AVAILABLE TOOLS:\n${Tools.getAgentSpec()}`,
      ``,
      context ? `CONTEXT FROM PREVIOUS STEPS:\n${context}\n` : '',
      `USER REQUEST: ${userPrompt}`,
    ].filter(Boolean).join('\n');
  }

  // ── Local intent fallback (no backend AI) ─────────────────────
  function _localFallback(prompt) {
    const p = prompt.toLowerCase();
    if (p.includes('voucher') && (p.includes('create') || p.includes('make') || p.includes('generate'))) {
      const m = p.match(/(\d+)/);
      const n = m ? m[1] : '1';
      return `Thought: User wants to create vouchers.\nAction: voucher.stats\nAction Input: {}\n`;
    }
    if (p.includes('active') || p.includes('online') || p.includes('connected')) {
      return `Thought: Checking active users.\nAction: router.active\nAction Input: {}\n`;
    }
    if (p.includes('reboot') || p.includes('restart')) {
      return `Thought: User wants to reboot router.\nAction: router.reboot\nAction Input: {}\n`;
    }
    if (p.includes('revenue') || p.includes('money') || p.includes('financial')) {
      return `Thought: Checking financial summary.\nAction: financial.summary\nAction Input: {}\n`;
    }
    if (p.includes('resource') || p.includes('cpu') || p.includes('memory') || p.includes('stats')) {
      return `Thought: Checking router resources.\nAction: system.stats\nAction Input: {}\n`;
    }
    if (p.includes('ping')) {
      const h = prompt.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/)?.[1] || '8.8.8.8';
      return `Thought: Pinging host.\nAction: network.ping\nAction Input: {"host":"${h}"}\n`;
    }
    if (p.includes('plan') || p.includes('profile')) {
      return `Thought: Listing available plans.\nAction: voucher.plans\nAction Input: {}\n`;
    }
    if (p.includes('health') || p.includes('diagnos')) {
      return `Thought: Running health check.\nAction: system.health\nAction Input: {}\n`;
    }
    // Default: answer directly
    return `Thought: This is a general question I can answer directly.\nAction: FINAL_ANSWER\nFinal Answer: I'm AgentOS Hermes. I can manage your MikroTik router, vouchers, users, and network. Try asking me to show active users, create vouchers, or check system stats. Configure your gateway URL in Settings to connect.`;
  }

  // ── ReAct output parser ────────────────────────────────────────
  function _parseReAct(text) {
    const out = { thought: '', action: '', actionInput: {}, finalAnswer: '', answer: '' };

    const thought = text.match(/^Thought:\s*(.+?)(?=\nAction:|$)/ms);
    if (thought) out.thought = thought[1].trim();

    const action = text.match(/^Action:\s*(\S+)/m);
    if (action) out.action = action[1].trim();

    const actionInput = text.match(/^Action Input:\s*(.+?)(?=\n(?:Thought|Observation|Final Answer)|$)/ms);
    if (actionInput) {
      try { out.actionInput = JSON.parse(actionInput[1].trim()); } catch(_) {}
    }

    const fa = text.match(/^Final Answer:\s*([\s\S]+?)$/m);
    if (fa) out.finalAnswer = fa[1].trim();

    // Plain answer fallback
    if (!out.action && !out.finalAnswer) {
      out.finalAnswer = text.trim();
    }

    return out;
  }

  // ── DOM helpers ────────────────────────────────────────────────
  function _appendUser(text) {
    const e = el();
    const div = document.createElement('div');
    div.className = 'msg-user';
    div.textContent = text;
    e.thread.appendChild(div);
    _scroll(e.thread);
  }

  function _appendAgent(text) {
    const e = el();
    const div = document.createElement('div');
    div.className = 'msg-agent';
    div.innerHTML = `<div class="msg-role">◈ HERMES</div>${_escHtml(text)}`;
    e.thread.appendChild(div);
    _scroll(e.thread);
  }

  function _appendToolCall(toolId, input) {
    const e = el();
    const div = document.createElement('div');
    div.className = 'msg-tool-call';
    div.innerHTML = `<div class="tool-name">▶ ${toolId}</div>${input && Object.keys(input).length ? _escHtml(JSON.stringify(input)) : ''}`;
    e.thread.appendChild(div);
    _scroll(e.thread);
  }

  function _appendToolResult(text, isError) {
    const e = el();
    const div = document.createElement('div');
    div.className = isError ? 'msg-error' : 'msg-tool-result';
    div.textContent = text;
    e.thread.appendChild(div);
    _scroll(e.thread);
  }

  function _appendWelcome() {
    const e = el();
    const div = document.createElement('div');
    div.className = 'agent-welcome';
    div.id = 'agent-welcome';
    div.innerHTML = `
      <div class="welcome-sigil">⬡</div>
      <p>AgentOS Hermes is ready. I can manage your MikroTik router, create vouchers, check users, run network diagnostics, and execute multi-step plans.</p>
      <div class="welcome-hints">
        <button class="hint-chip" onclick="Agent.sendHint(this)">Create 5 vouchers for 1Day plan</button>
        <button class="hint-chip" onclick="Agent.sendHint(this)">Show active users and disconnect idle ones</button>
        <button class="hint-chip" onclick="Agent.sendHint(this)">Revenue report for today</button>
        <button class="hint-chip" onclick="Agent.sendHint(this)">Router resource usage</button>
      </div>`;
    e.thread.appendChild(div);
  }

  function _removeWelcome() {
    const w = document.getElementById('agent-welcome');
    if (w) w.remove();
  }

  function _setThinking(label, e) {
    e = e || el();
    e.thinking.hidden = false;
    e.thLabel.textContent = label;
  }

  function _addThinkStep(thought, turn, e) {
    e = e || el();
    const div = document.createElement('div');
    div.className = 'think-step';
    div.innerHTML = `<span class="step-idx">[${turn}]</span><span>${_escHtml(thought.slice(0, 120))}${thought.length > 120 ? '…' : ''}</span>`;
    e.thSteps.appendChild(div);
  }

  function _clearThinking(e) {
    e = e || el();
    e.thinking.hidden = true;
    e.thSteps.innerHTML = '';
    e.thLabel.textContent = 'Reasoning…';
  }

  function _setRunning(v) {
    _running = v;
    const e = el();
    e.sendBtn.disabled = v;
    e.input.disabled   = v;
  }

  function _scroll(el) {
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  function _save() {
    // Only save user/assistant turns (not tool results)
    const toSave = _history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-40);
    Store.set(KEYS.HISTORY, toSave);
  }

  function _escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/\n/g,'<br>');
  }

  function _autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  return { init, send, sendHint, onKey, clearHistory };
})();
