/**
 * AgentOS Hermes — agent.js
 * ReAct Loop: Thought → Action → Observation → Answer
 */
'use strict';

const Agent = (() => {
  let _history = [];
  let _sessionId = null;
  let _running = false;

  const el = () => ({
    thread: document.getElementById('agent-thread'), thinking: document.getElementById('agent-thinking'),
    thLabel: document.getElementById('thinking-label'), thSteps: document.getElementById('thinking-steps'),
    input: document.getElementById('agent-input'), sendBtn: document.getElementById('send-btn'), model: document.getElementById('agent-model')
  });

  function init() {
    _sessionId = 'ses-' + Date.now();
    const saved = Store.get(KEYS.HISTORY, []);
    if (saved.length) { _history = saved; saved.forEach(m => m.role === 'user' ? _appendUser(m.content) : m.role === 'assistant' && _appendAgent(m.content)); _removeWelcome(); }
  }

  async function send() {
    const e = el(); const text = e.input.value.trim(); if (!text || _running) return;
    if (!Client.hasConfig()) { UI.toast('Configure gateway URL in Settings first', 'wrn'); App.switchTab('settings'); return; }
    _removeWelcome(); e.input.value = ''; _autoResize(e.input); _appendUser(text); _history.push({ role: 'user', content: text }); _save(); await _reactLoop(text);
  }
  function sendHint(btn) { const e = el(); e.input.value = btn.textContent.trim(); send(); }
  function onKey(ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(); } _autoResize(ev.target); }
  function clearHistory() { _history = []; Store.del(KEYS.HISTORY); const e = el(); e.thread.replaceChildren(); _appendWelcome(); }

  async function _reactLoop(userPrompt) {
    const e = el(); const maxTurns = parseInt(Store.get(KEYS.TURNS, CFG.REACT_MAX_TURNS)) || CFG.REACT_MAX_TURNS; _setRunning(true);
    let turnCount = 0, lastThought = '', finalAnswer = '';
    try {
      while (turnCount < maxTurns) {
        turnCount++; _setThinking(`Turn ${turnCount}/${maxTurns} — Reasoning…`, e); let aiReply;
        try { const res = await Client.v2.ask(_buildReActPrompt(userPrompt, lastThought), _sessionId); aiReply = res.data?.response || res.data?.text || res.data || ''; if (typeof aiReply === 'object') aiReply = JSON.stringify(aiReply, null, 2); }
        catch (err) { aiReply = _localFallback(userPrompt); }
        const parsed = _parseReAct(aiReply);
        if (parsed.thought) { lastThought = parsed.thought; _addThinkStep(parsed.thought, turnCount, e); }
        if (parsed.action && parsed.action !== 'FINAL_ANSWER') {
          _setThinking(`Calling ${parsed.action}…`, e); _appendToolCall(parsed.action, parsed.actionInput); let observation;
          try { const result = await Tools.run(parsed.action, parsed.actionInput || {}); observation = result.text; _appendToolResult(observation); }
          catch (toolErr) { observation = `ERROR: ${toolErr.message}`; _appendToolResult(observation, true); }
          lastThought = `${parsed.thought}\nObservation: ${observation}`; _history.push({ role: 'tool', tool: parsed.action, content: observation }); continue;
        }
        finalAnswer = parsed.finalAnswer || parsed.answer || aiReply; break;
      }
      if (!finalAnswer) finalAnswer = lastThought || '(No answer generated)';
    } catch (err) { finalAnswer = `Agent error: ${err.message}`; }
    _setRunning(false); _clearThinking(e); _appendAgent(finalAnswer); _history.push({ role: 'assistant', content: finalAnswer }); _save(); App.addActivity(finalAnswer.slice(0, 80) + (finalAnswer.length > 80 ? '…' : ''), 'ok');
  }

  function _buildReActPrompt(userPrompt, context) {
    return [`You are AgentOS Hermes, an AI agent for MikroTik hotspot network management in Zimbabwe.`, `You run a ReAct loop: think step by step, then call ONE tool if needed, then answer.`, ``, `FORMAT (strict):`, `Thought: <your reasoning>`, `Action: <tool_id>  [or FINAL_ANSWER if no tool needed]`, `Action Input: {"key":"value"}`, `  -- after seeing the Observation, continue --`, `Final Answer: <your natural language response>`, ``, `AVAILABLE TOOLS:\n${Tools.getAgentSpec()}`, ``, context ? `CONTEXT FROM PREVIOUS STEPS:\n${context}\n` : '', `USER REQUEST: ${userPrompt}`].filter(Boolean).join('\n');
  }
  function _localFallback(prompt) {
    const p = prompt.toLowerCase();
    if (p.includes('voucher') && (p.includes('create') || p.includes('make') || p.includes('generate'))) return `Thought: User wants to create vouchers.\nAction: voucher.stats\nAction Input: {}\n`;
    if (p.includes('active') || p.includes('online') || p.includes('connected')) return `Thought: Checking active users.\nAction: router.active\nAction Input: {}\n`;
    if (p.includes('reboot') || p.includes('restart')) return `Thought: User wants to reboot router.\nAction: router.reboot\nAction Input: {}\n`;
    if (p.includes('revenue') || p.includes('money') || p.includes('financial')) return `Thought: Checking financial summary.\nAction: financial.summary\nAction Input: {}\n`;
    if (p.includes('resource') || p.includes('cpu') || p.includes('memory') || p.includes('stats')) return `Thought: Checking router resources.\nAction: system.stats\nAction Input: {}\n`;
    if (p.includes('ping')) { const h = prompt.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/)?.[1] || '8.8.8.8'; return `Thought: Pinging host.\nAction: network.ping\nAction Input: {"host":"${h}"}\n`; }
    if (p.includes('plan') || p.includes('profile')) return `Thought: Listing available plans.\nAction: voucher.plans\nAction Input: {}\n`;
    if (p.includes('health') || p.includes('diagnos')) return `Thought: Running health check.\nAction: system.health\nAction Input: {}\n`;
    return `Thought: This is a general question I can answer directly.\nAction: FINAL_ANSWER\nFinal Answer: I'm AgentOS Hermes. I can manage your router, vouchers, users, and network. Configure your gateway URL in Settings to connect.`;
  }
  function _parseReAct(text) {
    const out = { thought: '', action: '', actionInput: {}, finalAnswer: '', answer: '' }; const thought = text.match(/^Thought:\s*(.+?)(?=\nAction:|$)/ms); if (thought) out.thought = thought[1].trim(); const action = text.match(/^Action:\s*(\S+)/m); if (action) out.action = action[1].trim(); const actionInput = text.match(/^Action Input:\s*(.+?)(?=\n(?:Thought|Observation|Final Answer)|$)/ms); if (actionInput) { try { out.actionInput = JSON.parse(actionInput[1].trim()); } catch (_) {} } const fa = text.match(/^Final Answer:\s*([\s\S]+?)$/m); if (fa) out.finalAnswer = fa[1].trim(); if (!out.action && !out.finalAnswer) out.finalAnswer = text.trim(); return out;
  }

  function _appendUser(text) { const e = el(); const div = document.createElement('div'); div.className = 'msg-user'; div.textContent = text; e.thread.appendChild(div); _scroll(e.thread); }
  function _appendAgent(text) { const e = el(); const div = document.createElement('div'); div.className = 'msg-agent'; const role = document.createElement('div'); role.className = 'msg-role'; role.textContent = '◈ HERMES'; const body = document.createElement('div'); body.textContent = String(text == null ? '' : text); div.append(role, body); e.thread.appendChild(div); _scroll(e.thread); }
  function _appendToolCall(toolId, input) { const e = el(); const div = document.createElement('div'); div.className = 'msg-tool-call'; const name = document.createElement('div'); name.className = 'tool-name'; name.textContent = `▶ ${String(toolId)}`; div.appendChild(name); if (input && Object.keys(input).length) { const body = document.createElement('div'); body.textContent = JSON.stringify(input); div.appendChild(body); } e.thread.appendChild(div); _scroll(e.thread); }
  function _appendToolResult(text, isError) { const e = el(); const div = document.createElement('div'); div.className = isError ? 'msg-error' : 'msg-tool-result'; div.textContent = String(text == null ? '' : text); e.thread.appendChild(div); _scroll(e.thread); }
  function _appendWelcome() { const e = el(); const div = document.createElement('div'); div.className = 'agent-welcome'; div.id = 'agent-welcome'; const sigil = document.createElement('div'); sigil.className = 'welcome-sigil'; sigil.textContent = '⬡'; const p = document.createElement('p'); p.textContent = 'AgentOS Hermes is ready. I can manage your router, create vouchers, check users, run network diagnostics, and execute multi-step plans.'; const hints = document.createElement('div'); hints.className = 'welcome-hints'; ['Create 5 vouchers for 1Day plan','Show active users and disconnect idle ones','Revenue report for today','Router resource usage'].forEach(text => { const b = document.createElement('button'); b.className = 'hint-chip'; b.type = 'button'; b.textContent = text; b.addEventListener('click', () => sendHint(b)); hints.appendChild(b); }); div.append(sigil, p, hints); e.thread.appendChild(div); }
  function _removeWelcome() { const w = document.getElementById('agent-welcome'); if (w) w.remove(); }
  function _setThinking(label, e) { e = e || el(); e.thinking.hidden = false; e.thLabel.textContent = label; }
  function _addThinkStep(thought, turn, e) { e = e || el(); const div = document.createElement('div'); div.className = 'think-step'; const idx = document.createElement('span'); idx.className = 'step-idx'; idx.textContent = `[${turn}]`; const text = document.createElement('span'); text.textContent = `${thought.slice(0,120)}${thought.length > 120 ? '…' : ''}`; div.append(idx, text); e.thSteps.appendChild(div); }
  function _clearThinking(e) { e = e || el(); e.thinking.hidden = true; e.thSteps.replaceChildren(); e.thLabel.textContent = 'Reasoning…'; }
  function _setRunning(v) { _running = v; const e = el(); e.sendBtn.disabled = v; e.input.disabled = v; }
  function _scroll(node) { requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; }); }
  function _save() { Store.set(KEYS.HISTORY, _history.filter(m => m.role === 'user' || m.role === 'assistant').slice(-40)); }
  function _autoResize(node) { node.style.height = 'auto'; node.style.height = Math.min(node.scrollHeight, 120) + 'px'; }
  return { init, send, sendHint, onKey, clearHistory };
})();
