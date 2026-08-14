/*
 * Fallback result page, used when the extension cannot inject its overlay
 * into the page (chrome:// pages, the Web Store, the PDF viewer). The result
 * is collected from the service worker with a read-once message, so decoded
 * content (Wi-Fi passwords, OTP secrets) never appears in the URL or in any
 * stored state.
 *
 * The URL fragment carries only the nonce this tab was opened with: it names
 * which pending result is ours, so a second scan opening its own viewer cannot
 * hand us its payload (and vice versa).
 */
(async () => {
  const body = document.getElementById('body');
  const nonce = location.hash.slice(1);

  let result = null;
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'qrgenie:get-result', nonce });
    result = reply && reply.result;
  } catch (_) {}

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  if (!result) {
    body.appendChild(el('div', null, 'No scan result to show.'));
    body.appendChild(
      el('div', 'hint', 'Results appear here right after a scan; this page does not keep them.')
    );
    return;
  }

  if (!result.ok) {
    if (result.reason === 'blocked') {
      body.appendChild(el('div', null, 'Chrome does not let extensions scan this page.'));
      body.appendChild(
        el(
          'div',
          'hint',
          'Its own pages, the Web Store and the built-in PDF viewer are off limits. Try the scan on a regular website.'
        )
      );
    } else {
      body.appendChild(el('div', null, 'We could not find a QR code there.'));
      body.appendChild(
        el('div', 'hint', 'Try zooming the page so the code appears larger, then scan again.')
      );
    }
    return;
  }

  const p = result.payload;
  body.appendChild(el('span', 'chip', p.label));
  body.appendChild(el('div', 'raw', p.raw));

  if (p.fields && p.fields.length) {
    const ul = el('ul', 'fields');
    for (const f of p.fields) {
      const li = el('li');
      li.appendChild(el('span', 'k', f.name));
      li.appendChild(el('span', 'v', f.value));
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  if (result.fromVisibleTab) {
    body.appendChild(
      el(
        'div',
        'hint',
        'The image itself could not be read, so this code was found on the visible part of the tab.'
      )
    );
  }

  const actions = el('div', 'actions');
  const copyBtn = el('button', 'btn', 'Copy');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(p.raw).then(() => {
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
    });
  });
  actions.appendChild(copyBtn);

  if (p.url) {
    const openBtn = el('button', 'btn primary', 'Open link');
    openBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: p.url });
    });
    actions.appendChild(openBtn);
  }
  body.appendChild(actions);
})();
