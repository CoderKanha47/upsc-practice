import { get } from '../api.js';
import { h, mount, loadingBox, fmtPct, fmtDate } from '../dom.js';
import { navigate } from '../router.js';
import { getExamMeta, papersForExam, paperLabel } from '../exam-state.js';

export default async function dashboard(view, params, query) {
  mount(view, loadingBox());
  const examId = query?.exam;
  const examMeta = getExamMeta(examId);
  const examName = examMeta?.name || 'Exam';
  let data;
  try {
    data = await get(`/api/dashboard?exam=${encodeURIComponent(examId)}`);
  } catch (err) {
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Cannot load dashboard' }), h('div', { text: err.message })));
    return;
  }

  const fp = data.fullPaper;
  const perf = data;
  const papers = papersForExam(examId);
  const defaultPaper = paperLabel(examMeta?.defaultPaper);
  const yearSpan = examMeta ? examMeta.years.end - examMeta.years.start + 1 : 20;

  // Active session resume
  let active = { sessions: [] };
  try {
    active = await get('/api/sessions/active');
  } catch {
    /* ignore */
  }

  const resume = active.sessions.length
    ? h(
        'div',
        { class: 'resume-banner' },
        h(
          'div',
          {},
          h('strong', { text: 'Test in progress' }),
          h('div', { class: 'muted', text: `${active.sessions[0].title} — your time keeps running on the server.` }),
        ),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', onClick: () => navigate(`/exam/${active.sessions[0].id}`) }, 'Resume test'),
        ),
      )
    : null;

  const fullCard = h(
    'div',
    { class: `mode-card ${fp.available ? 'available' : 'locked'}` },
    h('div', { class: 'row-between' },
      h('h2', { text: 'FULL PAPER' }),
      h('span', { class: fp.available ? 'badge badge-good' : 'badge badge-neutral', text: fp.available ? 'Available today' : 'Sunday only' }),
    ),
    h('div', { class: 'mode-status', text: fp.label }),
    h('div', { class: 'mode-meta' },
      ...papers.map((p) =>
        h('div', {},
          h('span', { text: p.shortTitle }),
          h('strong', { text: `${p.questionCount} Q · ${p.durationMinutes} min${p.sectional?.enabled ? ' · sectional' : ''}` }),
        ),
      ),
      h('div', {}, h('span', { text: 'Window' }), h('strong', { text: `${fp.openTime}–${fp.closeTime}` })),
      h('div', {}, h('span', { text: 'Timezone' }), h('strong', { text: fp.timezone })),
    ),
    h('div', { class: 'muted', style: { fontSize: '.8rem' }, text: fp.reason }),
    h('button', {
      class: `btn ${fp.available ? 'btn-primary' : ''}`,
      disabled: !fp.available,
      onClick: () => navigate('/full'),
    }, fp.available ? 'START FULL SIMULATION' : 'View details'),
  );

  const selectiveCard = h(
    'div',
    { class: 'mode-card available' },
    h('div', { class: 'row-between' },
      h('h2', { text: 'SELECTIVE PRACTICE' }),
      h('span', { class: 'badge badge-good', text: 'Always available' }),
    ),
    h('div', { class: 'mode-status', text: 'Unlocked\nMonday → Sunday · unlimited attempts' }),
    h('div', { class: 'mode-meta' },
      h('div', {}, h('span', { text: 'Choose' }), h('strong', { text: 'Subject / Topic' })),
      h('div', {}, h('span', { text: 'Timer' }), h('strong', { text: 'Dynamically calculated' })),
      h('div', {}, h('span', { text: 'Buffer' }), h('strong', { text: `${data.bufferSeconds}s / question` })),
    ),
    h('div', { class: 'muted', style: { fontSize: '.8rem' }, text: 'Total time = Σ(estimated question time + buffer). Shown before you start.' }),
    h('button', { class: 'btn btn-accent', onClick: () => navigate('/selective') }, 'Choose subject / topic'),
  );

  const tile = (label, value, sub = '', tone = '') =>
    h('div', { class: `tile ${tone}` },
      h('div', { class: 'tile-label', text: label }),
      h('div', { class: 'tile-value', text: value }),
      sub ? h('div', { class: 'tile-sub', text: sub }) : null,
    );

  const cov = data.coverage;
  const covPct = cov && cov.percent !== undefined ? cov.percent : 0;

  const performance = h(
    'section',
    { class: 'section-gap' },
    h('div', { class: 'card-title' }, h('h2', { text: 'YOUR PERFORMANCE' })),
    h(
      'div',
      { class: 'grid grid-4' },
      tile('PYQs attempted', `${perf.pyqsAttempted}`, `${perf.pyqTotal || 0} official in DB`),
      tile('Accuracy', fmtPct(perf.accuracy), `${perf.totalQuestionExposures || 0} question exposures`, perf.accuracy >= 60 ? 'good' : perf.accuracy > 0 ? 'warn' : ''),
      tile('Average score', perf.averageScorePercent !== null && perf.averageScorePercent !== undefined ? fmtPct(perf.averageScorePercent) : '—', `${defaultPaper} tests`),
      tile('Total tests', String(perf.totalTests || 0), 'submitted sessions'),
      tile('Strongest subject', perf.strongestSubject ? perf.strongestSubject.name : '—', perf.strongestSubject ? `${perf.strongestSubject.accuracy}% accuracy` : 'attempt 3+ questions'),
      tile('Weakest subject', perf.weakestSubject ? perf.weakestSubject.name : '—', perf.weakestSubject ? `${perf.weakestSubject.accuracy}% accuracy` : 'attempt 3+ questions', 'bad'),
      tile('PYQ mastery', `${perf.mastery?.masteryPercent ?? 0}%`, perf.mastery ? `${perf.mastery.mastered} of ${perf.mastery.total} mastered` : '', perf.mastery?.masteryPercent >= 50 ? 'good' : 'warn'),
      tile(`${yearSpan}-year coverage`, `${covPct}%`, cov ? `${cov.found} / ${cov.expected} questions imported` : '', covPct >= 100 ? 'good' : 'warn'),
    ),
  );

  const recent = (perf.recentSessions || []).slice(0, 8);
  const recentTable = recent.length
    ? h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h('thead', {}, h('tr', {},
            h('th', { text: 'Test' }), h('th', { text: 'Type' }), h('th', { text: 'When' }),
            h('th', { class: 'num', text: 'Marks' }), h('th', { class: 'num', text: 'Accuracy' }), h('th', {}),
          )),
          h('tbody', {}, ...recent.map((s) =>
            h('tr', {},
              h('td', {}, h('strong', { text: s.title }), h('div', { class: 'muted', style: { fontSize: '.75rem' }, text: paperLabel(s.paper) })),
              h('td', {}, h('span', { class: 'badge badge-neutral', text: s.kindLabel })),
              h('td', { class: 'muted', text: fmtDate(s.startedAt) }),
              h('td', { class: 'num', text: `${s.marksObtained ?? 0}` }),
              h('td', { class: 'num', text: fmtPct(s.accuracy) }),
              h('td', {}, h('a', { class: 'btn btn-sm', href: `#/result/${s.id}` }, 'Result')),
            ),
          )),
        ),
      )
    : h('div', { class: 'empty' }, h('strong', { text: 'No tests yet' }), h('div', { text: 'Start a selective practice or wait for Sunday to run a full paper.' }));

  mount(
    view,
    resume,
    h('div', { class: 'row-between', style: { marginBottom: '1rem' } },
      h('div', {}, h('h1', { text: `${examName} Dashboard` }), h('div', { class: 'muted', text: `Exam window timezone: ${fp.timezone} · PYQ range ${examMeta ? `${examMeta.years.start}–${examMeta.years.end}` : ''}` })),
    ),
    h('div', { class: 'grid grid-2' }, fullCard, selectiveCard),
    performance,
    h('section', { class: 'section-gap' },
      h('div', { class: 'card' },
        h('div', { class: 'card-title' },
          h('h2', { text: 'Recent tests' }),
          h('a', { href: '#/analytics' }, 'Full analytics →'),
        ),
        recentTable,
      ),
    ),
  );
}
