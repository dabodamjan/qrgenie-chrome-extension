/*
 * Fallback result page, used when the extension cannot inject its overlay
 * into the page (chrome:// pages, the Web Store, the PDF viewer). The result
 * travels in the URL fragment so nothing is stored anywhere.
 */
(() => {
  const body = document.getElementById('body');

  let result = null;
  try {
    result = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  } catch (_) {}

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  if (!result || !result.ok) {
    body.appendChild(el('div', null, 'We could not find a QR code there.'));
    body.appendChild(
      el('div', 'hint', 'Try zooming the page so the code appears larger, then scan again.')
    );
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
