const out = document.getElementById('out');
const show = value => { out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
const cfg = () => ({ ssid: document.getElementById('ssid').value, password: document.getElementById('password').value });
window.addEventListener('DOMContentLoaded', async () => {
  show(await WifiManager.capabilities());
  document.getElementById('scan').onclick = async () => show(await WifiManager.scan());
  document.getElementById('connect').onclick = async () => show(await WifiManager.connect(cfg()));
  document.getElementById('disconnect').onclick = async () => show(await WifiManager.disconnect(cfg()));
  document.getElementById('status').onclick = async () => show(await WifiManager.status());
  document.getElementById('settings').onclick = async () => show(await WifiManager.openWifiSettings());
});
