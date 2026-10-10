import { register, startRouter, redispatch } from './router.js';
import { loadExamConfig, currentExam, setExam, getExamMeta } from './exam-state.js';
import dashboard from './views/dashboard.js';
import fullpaper from './views/fullpaper.js';
import selective from './views/selective.js';
import exam from './views/exam.js';
import result from './views/result.js';
import pyq from './views/pyq.js';
import analytics from './views/analytics.js';
import admin from './views/admin.js';

register('/', dashboard);
register('full', fullpaper);
register('selective', selective);
register('exam/:id', exam);
register('result/:id', result);
register('pyq', pyq);
register('analytics', analytics);
register('admin', admin);

const toggle = document.getElementById('navToggle');
const nav = document.getElementById('nav');
if (toggle && nav) {
  toggle.addEventListener('click', () => nav.classList.toggle('open'));
  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') nav.classList.remove('open');
  });
}

const themeBtn = document.getElementById('themeToggle');
if (themeBtn) {
  const syncLabel = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    themeBtn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  };
  syncLabel();
  themeBtn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('upsc-theme', next); } catch (e) {}
    syncLabel();
  });
}

/* ------------------------------------------------ exam switcher + branding */
function applyExamChrome(examId) {
  const meta = getExamMeta(examId);
  const nameEl = document.getElementById('brandName');
  const subEl = document.getElementById('brandSub');
  const markEl = document.getElementById('brandMark');
  if (meta) {
    if (nameEl) nameEl.textContent = meta.name;
    if (subEl) subEl.textContent = `${meta.years.start}–${meta.years.end} · PYQ practice engine`;
    if (markEl) markEl.textContent = meta.id === 'SSC_CGL' ? 'S' : 'U';
    document.title = `${meta.name} — Prelims Practice Simulator`;
  }
}

async function boot() {
  try {
    await loadExamConfig();
  } catch {
    /* config optional — views handle their own fetch errors */
  }
  const switcher = document.getElementById('examSwitch');
  if (switcher) {
    switcher.value = currentExam();
    switcher.addEventListener('change', () => {
      setExam(switcher.value);
      applyExamChrome(switcher.value);
      redispatch();
    });
  }
  // A ?exam= link overrides the stored preference — reflect it in the switch.
  const urlExam = new URLSearchParams(location.hash.split('?')[1] || '').get('exam');
  if (urlExam) switcher && (switcher.value = urlExam);
  applyExamChrome(currentExam());
  startRouter();
}

boot();
