const storage = chrome.storage.local; let recording = false; let actions = [];
document.addEventListener('DOMContentLoaded', async () => {
  const cfg = await storage.get(['gateway', 'token', 'actions', 'recording']);
  if (cfg.gateway) document.getElementById('gateway-url').value = cfg.gateway;
  if (cfg.token) document.getElementById('api-token').value = cfg.token;
  if (cfg.actions) { actions = cfg.actions; updateActionsUI(); }
  if (cfg.recording) { recording = true; updateRecordButton(); }
});
document.getElementById('save-config').onclick = async () => {
  const gateway = document.getElementById('gateway-url').value.trim();
  const token = document.getElementById('api-token').value.trim();
  await storage.set({ gateway, token });
  document.getElementById('config-status').textContent = '✅ Saved';
  setTimeout(() => document.getElementById('config-status').textContent = '', 2000);
};
document.getElementById('record-btn').onclick = async () => {
  recording =!recording; await storage.set({ recording });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_RECORD', recording });
  });
  updateRecordButton();
};
function updateRecordButton() {
  const btn = document.getElementById('record-btn');
  if (recording) { btn.textContent = '⏹️ Stop Recording'; btn.classList.add('recording'); }
  else { btn.textContent = '🔴 Start Recording'; btn.classList.remove('recording'); }
}
function updateActionsUI() {
  const list = document.getElementById('actions-list');
  const copyBtn = document.getElementById('copy-actions');
  const sendBtn = document.getElementById('send-to-agent');
  const clearBtn = document.getElementById('clear-actions');
  if (actions.length > 0) {
    list.classList.remove('hidden'); copyBtn.classList.remove('hidden'); sendBtn.classList.remove('hidden'); clearBtn.classList.remove('hidden');
    list.textContent = JSON.stringify(actions, null, 2);
  } else {
    list.classList.add('hidden'); copyBtn.classList.add('hidden'); sendBtn.classList.add('hidden'); clearBtn.classList.add('hidden');
  }
}
document.getElementById('copy-actions').onclick = () => {
  navigator.clipboard.writeText(JSON.stringify(actions, null, 2));
  document.getElementById('copy-actions').textContent = 'Copied!';
  setTimeout(() => document.getElementById('copy-actions').textContent = 'Copy Actions JSON', 1500);
};
document.getElementById('send-to-agent').onclick = async () => {
  const { gateway, token } = await storage.get(['gateway', 'token']);
  if (!gateway ||!token) return alert('Set Gateway URL and Token first');
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const url = tabs[0].url;
    const apiUrl = `${gateway}/api/ui-agent?url=${encodeURIComponent(url)}&actions=${encodeURIComponent(JSON.stringify(actions))}&token=${token}`;
    document.getElementById('send-to-agent').textContent = 'Sending...';
    try { const res = await fetch(apiUrl); const data = await res.json(); alert(data.message || 'Sent'); }
    catch (e) { alert('Failed: ' + e.message); }
    document.getElementById('send-to-agent').textContent = 'Send to AgentOS';
  });
};
document.getElementById('clear-actions').onclick = async () => {
  actions = []; await storage.set({ actions }); updateActionsUI();
};
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ADD_ACTION') { actions.push(msg.action); storage.set({ actions }); updateActionsUI(); }
});
async function callSkill(endpoint) {
  const { gateway, token } = await storage.get(['gateway', 'token']);
  if (!gateway ||!token) return alert('Set Gateway URL and Token first');
  document.getElementById('skill-status').textContent = 'Running...';
  try { const res = await fetch(`${gateway}${endpoint}?token=${token}`); const data = await res.json(); document.getElementById('skill-status').textContent = '✅ ' + (data.message?.slice(0, 50) || 'Done'); }
  catch (e) { document.getElementById('skill-status').textContent = '❌ ' + e.message; }
  setTimeout(() => document.getElementById('skill-status').textContent = '', 3000);
}
document.getElementById('skill-memory').onclick = () => callSkill('/api/memory');
document.getElementById('skill-onboard').onclick = () => callSkill('/api/onboard?target=all');
document.getElementById('skill-hotspot').onclick = () => callSkill('/api/hotspot-brand?target=all');
