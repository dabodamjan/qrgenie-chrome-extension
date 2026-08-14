// Firefox only guarantees promises on browser.*; Chrome and Edge on chrome.*.
const api = globalThis.browser ?? globalThis.chrome;

document.getElementById('scan-area').addEventListener('click', async () => {
  const errorEl = document.getElementById('error');
  errorEl.hidden = true;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  const reply = await api.runtime.sendMessage({
    type: 'qrgenie:start-area',
    tabId: tab.id
  });
  if (reply && reply.ok) {
    window.close();
  } else {
    errorEl.textContent =
      'We cannot scan this page. Browsers block extensions on their own pages and on extension stores.';
    errorEl.hidden = false;
  }
});
