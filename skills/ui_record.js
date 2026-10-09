import fs from 'fs/promises';

const ui_record = {
  name: "ui_record",
  description: "Generates a recorder bookmarklet/JS snippet. Paste into browser console on target site, click through your workflow, then copy the actions JSON to use with ui-agent.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL you'll be recording on, for reference" },
      include_screenshots: { type: "boolean", default: true, description: "Auto-add screenshot step after each click" }
    },
    required: ["url"]
  },

  run: async ({ url, include_screenshots = true }, { logger }) => {
    const timestamp = Date.now();
    const sessionId = `rec_${timestamp}`;
    const targetUrlLiteral = JSON.stringify(String(url));

    // The recorder JS that runs in user's browser. Target URL is represented
    // as data and inserted with textContent; it is never treated as HTML.
    const recorderJS = `
(function AgentOSRecorder() {
  if (window.__agentos_recording) { console.log('Already recording'); return; }
  window.__agentos_recording = true;
  window.__agentos_actions = [];
  window.__agentos_session = ${JSON.stringify(sessionId)};

  const style = document.createElement('style');
  style.textContent = '#agentos-panel{position:fixed;bottom:20px;right:20px;background:#1e293b;color:#fff;padding:12px;border-radius:8px;z-index:999999;font-family:system-ui;box-shadow:0 4px 12px rgba(0,0,0,0.3)}#agentos-panel button{background:#3b82f6;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;margin-top:8px}';
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'agentos-panel';

  const title = document.createElement('b');
  title.textContent = '🔴 AgentOS Recording';
  const target = document.createElement('small');
  target.textContent = ${targetUrlLiteral};
  const count = document.createElement('span');
  count.id = 'agentos-count';
  count.textContent = '0 actions';
  const finish = document.createElement('button');
  finish.type = 'button';
  finish.textContent = 'Finish & Copy JSON';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';

  panel.append(title, document.createElement('br'), target, document.createElement('br'), count, document.createElement('br'), finish, cancel);
  document.body.appendChild(panel);

  function cssSelector(el) {
    if (el.id) return '#' + el.id;
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    let path = [];
    while (el && el.nodeType === 1 && path.length < 4) {
      let selector = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\\s+/)[0];
        if (cls) selector += '.' + cls;
      }
      const siblings = Array.from(el.parentNode?.children || []).filter(c => c.tagName === el.tagName);
      if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(el) + 1) + ')';
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(' > ');
  }

  window.__agentos_finish = function() {
    const actions = window.__agentos_actions;
    const json = JSON.stringify(actions, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      const heading = document.createElement('b');
      heading.textContent = '✅ Copied!';
      const note = document.createElement('small');
      note.textContent = 'Paste this into ui-agent';
      const textarea = document.createElement('textarea');
      textarea.style.cssText = 'width:300px;height:200px';
      textarea.value = json;
      panel.replaceChildren(heading, document.createElement('br'), note, document.createElement('br'), textarea);
    }).catch(() => {
      const heading = document.createElement('b');
      heading.textContent = '✅ Recording done';
      const textarea = document.createElement('textarea');
      textarea.style.cssText = 'width:300px;height:200px';
      textarea.value = json;
      panel.replaceChildren(heading, document.createElement('br'), textarea);
    });
    window.__agentos_recording = false;
  };

  window.__agentos_cancel = function() {
    window.__agentos_recording = false;
    window.__agentos_actions = [];
    panel.remove();
  };

  finish.addEventListener('click', window.__agentos_finish);
  cancel.addEventListener('click', window.__agentos_cancel);

  document.addEventListener('click', function(e) {
    if (!window.__agentos_recording || e.target.closest('#agentos-panel')) return;
    e.preventDefault();
    e.stopPropagation();
    const sel = cssSelector(e.target);
    window.__agentos_actions.push({ type: 'click', selector: sel });
    ${include_screenshots ? "window.__agentos_actions.push({ type: 'screenshot', name: 'step_' + window.__agentos_actions.length });" : ""}
    count.textContent = window.__agentos_actions.length + ' actions';
    e.target.style.outline = '2px solid #3b82f6';
    setTimeout(() => e.target.style.outline = '', 500);
  }, true);

  document.addEventListener('input', function(e) {
    if (!window.__agentos_recording || e.target.closest('#agentos-panel')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      const sel = cssSelector(e.target);
      window.__agentos_actions = window.__agentos_actions.filter(a => !(a.type === 'type' && a.selector === sel));
      window.__agentos_actions.push({ type: 'type', selector: sel, value: e.target.value });
      count.textContent = window.__agentos_actions.length + ' actions';
    }
  }, true);

  console.log('%cAgentOS Recorder Active', 'color:#3b82f6;font-weight:bold');
  console.log('Click elements and type in forms. Click "Finish & Copy JSON" when done.');
})();
`.trim();

    const recorderPath = `/mnt/data/ui_recorder_${timestamp}.js`;
    await fs.writeFile(recorderPath, recorderJS);

    const bookmarklet = `javascript:${encodeURIComponent(recorderJS)}`;

    await fs.appendFile('./knowledge/soul.md',
      `\n## UI Record ${new Date().toISOString()}\nURL: ${url}\nSession: ${sessionId}\n`);

    const msg = `🔴 *UI Recorder Ready*\n\n**Target**: ${url}\n**Session**: \`${sessionId}\`\n\n**How to use:**\n1. Go to ${url}\n2. Open DevTools Console (F12)\n3. Paste the code below and hit Enter\n4. Click through your workflow - each click/typing is recorded\n5. Click "Finish & Copy JSON" in the panel\n6. Use that JSON with \`ui-agent ${url} <paste>\`\n\n**Recorder Code**:\n\`\`\`javascript\n${recorderJS}\n\`\`\`\n\n**Bookmarklet** (drag to bookmarks bar):\n\`${bookmarklet.slice(0, 100)}...\`\n\nSaved to: \`${recorderPath}\``;

    return { success: true, message: msg, recorder_code: recorderJS, bookmarklet, session_id: sessionId };
  }
};

export { ui_record };
