chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'agentos-extract', title: 'Extract with AgentOS', contexts: ['all'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'agentos-extract') {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { const el = document.activeElement; chrome.runtime.sendMessage({ type: 'ADD_ACTION', action: { type: 'extract', selector: el.id? '#' + el.id : el.tagName, name: 'data_' + Date.now() } }); } });
  }
});
