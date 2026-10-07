/** Tiny DOM helpers — no framework, no build step. */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(container, ...children) {
  clear(container);
  append(container, children);
  return container;
}

export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hpart = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hpart > 0 ? `${pad(hpart)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hpart = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (hpart > 0) return `${hpart}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function fmtDate(epochMs) {
  if (!epochMs) return '—';
  return new Date(epochMs).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function fmtPct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

export function toast(message, kind = '') {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.className = `toast show ${kind}`;
  clearTimeout(node._t);
  node._t = setTimeout(() => {
    node.className = 'toast';
  }, 3200);
}

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'modal-backdrop' });
    const close = (val) => {
      document.body.removeChild(backdrop);
      resolve(val);
    };
    const modal = h(
      'div',
      { class: 'modal' },
      h('h3', { text: title }),
      h('p', { class: 'muted', text: message }),
      h(
        'div',
        { class: 'btn-row' },
        h('button', { class: 'btn', onClick: () => close(false) }, 'Cancel'),
        h(
          'button',
          { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onClick: () => close(true) },
          confirmText,
        ),
      ),
    );
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
    document.body.appendChild(backdrop);
  });
}

export function badgeForSourceType(sourceType) {
  if (sourceType === 'OFFICIAL_PYQ') return h('span', { class: 'badge badge-official', text: 'Official PYQ' });
  if (sourceType === 'AI_GENERATED') return h('span', { class: 'badge badge-ai', text: 'AI Generated' });
  return h('span', { class: 'badge badge-custom', text: 'Custom' });
}

export function badgeForState(state) {
  const map = {
    VERIFIED: ['badge-verified', 'Verified'],
    REVIEW_REQUIRED: ['badge-review', 'Review Required'],
    PARSED: ['badge-official', 'Parsed'],
    IMPORTED: ['badge-custom', 'Imported'],
  };
  const [cls, label] = map[state] || ['badge-neutral', state];
  return h('span', { class: `badge ${cls}`, text: label });
}

export function loadingBox(text = 'Loading…') {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), h('span', { text }));
}

export function emptyBox(title, body, extra = []) {
  return h('div', { class: 'empty' }, h('strong', { text: title }), h('div', { text: body }), ...extra);
}

export function bar(label, value, max = 100, tone = '') {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return h(
    'div',
    { class: 'bar-row' },
    h('div', { class: 'bar-label', title: label, text: label }),
    h('div', { class: 'bar-track' }, h('div', { class: `bar-fill ${tone}`, style: { width: `${pct}%` } })),
    h('div', { class: 'bar-value', text: `${Math.round(value * 10) / 10}` }),
  );
}
