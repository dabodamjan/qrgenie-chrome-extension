document.getElementById('scan-area').addEventListener('click', async () => {
  const errorEl = document.getElementById('error');
  errorEl.hidden = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  const reply = await chrome.runtime.sendMessage({
    type: 'qrgenie:start-area',
    tabId: tab.id
  });
  if (reply && reply.ok) {
    window.close();
  } else {
    errorEl.textContent =
      'We cannot scan this page. Chrome blocks extensions on its own pages and on the Web Store.';
    errorEl.hidden = false;
  }
});
