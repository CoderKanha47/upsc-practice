import { currentExam, setExam } from './exam-state.js';

const routes = [];

export function register(pattern, handler) {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ parts, handler, pattern });
}

export function navigate(path) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === target) dispatch();
  else location.hash = target;
}

function match(segs, parts) {
  if (segs.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
    else if (parts[i] !== segs[i]) return null;
  }
  return params;
}

let currentCleanup = null;

async function dispatch() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathname, search] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(search || ''));
  // Shared links with ?exam= override the stored preference; otherwise the
  // stored exam is injected so every view sees a concrete exam id.
  if (query.exam) setExam(query.exam);
  else query.exam = currentExam();
  const segs = pathname.split('/').filter(Boolean);

  for (const route of routes) {
    const params = match(segs, route.parts);
    if (params) {
      if (typeof currentCleanup === 'function') {
        try {
          currentCleanup();
        } catch {
          /* ignore */
        }
        currentCleanup = null;
      }
      document.querySelectorAll('#nav a').forEach((a) => {
        const r = a.dataset.route;
        const active =
          (r === 'dashboard' && segs.length === 0) ||
          (r !== 'dashboard' && segs[0] === r);
        a.classList.toggle('active', active);
      });
      const view = document.getElementById('view');
      try {
        currentCleanup = (await route.handler(view, params, query)) || null;
      } catch (err) {
        console.error(err);
        view.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'empty';
        box.innerHTML = `<strong>Something went wrong</strong><div>${err.message || err}</div>`;
        const back = document.createElement('a');
        back.className = 'btn';
        back.style.marginTop = '1rem';
        back.textContent = 'Back to dashboard';
        back.href = '#/';
        box.appendChild(back);
        view.appendChild(box);
      }
      window.scrollTo({ top: 0 });
      return;
    }
  }
  navigate('/');
}

export function startRouter() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}

/** Re-run the current route (e.g. after the exam switch changes). */
export function redispatch() {
  dispatch();
}

export default { register, navigate, startRouter, redispatch };
