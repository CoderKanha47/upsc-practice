import { get } from '../api.js';
import { h, mount, loadingBox, fmtPct, fmtDuration, fmtDate, bar, toast } from '../dom.js';
import { navigate } from '../router.js';

export default async function analytics(view) {
  mount(view, loadingBox('Crunching your numbers…'));
  let overview;
  let time;
  let trend;
  let failures;
  let calibration;
  let mastery;
  try {
    [overview, time, trend, failures, calibration, mastery] = await Promise.all([
      get('/api/analytics/overview'),
      get('/api/analytics/time'),
      get('/api/analytics/trend'),
      get('/api/analytics/failures'),
      get('/api/analytics/calibration'),
      get('/api/analytics/mastery'),
    ]);
  } catch (err) {
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Cannot load analytics' }), h('div', { text: err.message })));
    return;
  }

  const tile = (label, value, sub = '', tone = '') =>
    h('div', { class: `tile ${tone}` },
      h('div', { class: 'tile-label', text: label }),
      h('div', { class: 'tile-value', text: value }),
      sub ? h('div', { class: 'tile-sub', text: sub }) : null,
    );

  /* ------------------------------------------------------ trend chart */
  const sessions = trend.sessions || [];
  const chart = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, h('h2', { text: 'Score trend' }), h('span', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Accuracy % per submitted test' })),
    sessions.length ? renderTrend(sessions) : h('div', { class: 'empty' }, h('strong', { text: 'No tests yet' }), h('div', { text: 'Your accuracy trend appears after your first submitted test.' })),
  );

  function renderTrend(list) {
    const w = 760;
    const hgt = 160;
    const pad = 28;
    const max = 100;
    const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, list.length - 1);
    const y = (v) => hgt - pad - (v / max) * (hgt - pad * 2);
    const points = list.map((s, i) => `${x(i)},${y(s.accuracy)}`).join(' ');
    return h('div', { class: 'table-wrap' },
      (() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
        svg.setAttribute('class', 'trend-chart');
        svg.innerHTML = `
          <line class="axis" x1="${pad}" y1="${y(0)}" x2="${w - pad}" y2="${y(0)}"></line>
          <line class="axis" x1="${pad}" y1="${y(50)}" x2="${w - pad}" y2="${y(50)}" stroke-dasharray="4 4"></line>
          <polyline points="${points}"></polyline>
          ${list.map((s, i) => `<circle cx="${x(i)}" cy="${y(s.accuracy)}" r="4"><title>${s.title}: ${s.accuracy}% (${s.marksObtained} marks)</title></circle>`).join('')}
          ${list.map((s, i) => (list.length <= 14 || i % Math.ceil(list.length / 10) === 0 ? `<text x="${x(i)}" y="${hgt - 8}" text-anchor="middle">${s.accuracy}%</text>` : '')).join('')}
        `;
        return svg;
      })(),
    );
  }

  /* ------------------------------------------------------ performance table */
  let dimension = 'subject';
  let perfPaper = '';
  const perfBody = h('div', {}, loadingBox());

  async function loadPerf() {
    perfBody.innerHTML = '';
    perfBody.appendChild(loadingBox());
    try {
      const q = new URLSearchParams({ dimension, minAttempts: '3' });
      if (perfPaper) q.set('paper', perfPaper);
      const data = await get(`/api/analytics/performance?${q}`);
      perfBody.innerHTML = '';
      if (!data.items.length) {
        perfBody.appendChild(h('div', { class: 'empty' }, h('strong', { text: 'Not enough attempts yet' }), h('div', { text: `Answer at least 3 questions per group. Total exposures: ${overview.totalQuestionExposures}.` })));
        return;
      }
      perfBody.appendChild(
        h('div', { class: 'table-wrap' },
          h('table', { class: 'table' },
            h('thead', {}, h('tr', {},
              h('th', { text: data.dimension.replace(/([A-Z])/g, ' $1') }),
              h('th', { class: 'num', text: 'Attempts' }),
              h('th', { class: 'num', text: 'Correct' }),
              h('th', { class: 'num', text: 'Wrong' }),
              h('th', { class: 'num', text: 'Accuracy' }),
              h('th', { class: 'num', text: 'Avg time' }),
              h('th', { class: 'num', text: 'Est. time' }),
              h('th', { class: 'num', text: 'Δ' }),
            )),
            h('tbody', {}, ...data.items.map((it) =>
              h('tr', {},
                h('td', {}, h('strong', { text: it.key })),
                h('td', { class: 'num', text: String(it.attempted) }),
                h('td', { class: 'num', text: String(it.correct) }),
                h('td', { class: 'num', text: String(it.incorrect) }),
                h('td', { class: 'num', text: fmtPct(it.accuracy) }),
                h('td', { class: 'num', text: it.averageTimeSeconds !== null ? fmtDuration(it.averageTimeSeconds) : '—' }),
                h('td', { class: 'num', text: it.averageEstimatedSeconds !== null ? fmtDuration(it.averageEstimatedSeconds) : '—' }),
                h('td', { class: 'num', text: it.calibrationDelta === null ? '—' : `${it.calibrationDelta > 0 ? '+' : ''}${it.calibrationDelta}s` }),
              ),
            )),
          ),
        ),
      );
    } catch (err) {
      perfBody.innerHTML = '';
      perfBody.appendChild(h('div', { class: 'notice warn', text: err.message }));
    }
  }

  const dimPills = h('div', { class: 'pill-group' },
    ...['subject', 'topic', 'questionType', 'difficulty'].map((d) =>
      h('button', {
        class: `pill ${d === dimension ? 'active' : ''}`,
        onClick: (e) => {
          dimension = d;
          dimPills.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
          e.target.classList.add('active');
          loadPerf();
        },
      }, d === 'questionType' ? 'Question type' : d[0].toUpperCase() + d.slice(1)),
    ),
    h('select', {
      style: { maxWidth: '160px' },
      onChange: (e) => {
        perfPaper = e.target.value;
        loadPerf();
      },
    }, h('option', { value: '' }, 'All papers'), h('option', { value: 'GS1' }, 'GS Paper I'), h('option', { value: 'CSAT' }, 'CSAT')),
  );
  loadPerf();

  /* ------------------------------------------------------ time analysis */
  const timeCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, h('h2', { text: 'Time management' })),
    time.count
      ? h('div', {},
          h('div', { class: 'grid grid-4' },
            tile('Average / question', fmtDuration(time.averageSeconds), `${time.count} timed`),
            tile('Median', fmtDuration(time.medianSeconds)),
            tile('Fastest', fmtDuration(time.fastest.seconds), time.fastest.text || ''),
            tile('Slowest', fmtDuration(time.slowest.seconds), time.slowest.text || ''),
          ),
          h('div', { class: 'divider' }),
          h('h3', { text: 'Average time by subject (estimated vs actual)' }),
          ...time.bySubject.filter((s) => s.attempted).map((s) =>
            h('div', {},
              bar(`${s.key} — actual ${s.averageTimeSeconds ?? '—'}s vs est ${s.averageEstimatedSeconds ?? '—'}s`, s.averageTimeSeconds || 0, Math.max(60, s.averageEstimatedSeconds || 60), s.calibrationDelta !== null && s.calibrationDelta > 15 ? 'bad' : 'good'),
              h('div', { class: 'muted', style: { fontSize: '.74rem', marginTop: '-.2rem', marginBottom: '.5rem' }, text: s.calibrationDelta === null ? '' : `calibration delta ${s.calibrationDelta > 0 ? '+' : ''}${s.calibrationDelta}s — ${s.calibrationDelta > 0 ? 'you are running slower than estimated' : 'you are faster than estimated'}` }),
            ),
          ),
        )
      : h('div', { class: 'empty' }, h('strong', { text: 'No timed answers yet' }), h('div', { text: 'Time per question is recorded during tests.' })),
  );

  /* ------------------------------------------------------ failures + calibration */
  const failCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, h('h2', { text: 'Repeated failures' }), h('span', { class: 'muted', style: { fontSize: '.82rem' }, text: 'wrong ≥ 2, never right' })),
    failures.questions.length
      ? h('div', {}, ...failures.questions.slice(0, 12).map((q) =>
          h('div', { class: 'admin-q' },
            h('div', { class: 'qhead' },
              h('span', { text: `${q.year} · ${q.paper} · Q${q.question_number}` }),
              h('span', { class: 'badge badge-bad', text: `${q.incorrect_count} wrong / ${q.correct_count} right` }),
              h('span', { text: `${q.subject || ''} · ${q.topic || ''}` }),
            ),
            h('div', { class: 'qtext', text: q.text }),
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn btn-sm', onClick: () => navigate('/selective') }, 'Drill this subject'),
              q.concept ? h('span', { class: 'badge badge-neutral', text: q.concept }) : null,
            ),
          ),
        ))
      : h('div', { class: 'empty' }, h('strong', { text: 'Nothing repeatedly failing' }, ''), h('div', { text: 'Keep practising — weak spots appear here.' })),
  );

  const calibCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, h('h2', { text: 'Timing calibration' }), h('span', { class: 'muted', style: { fontSize: '.82rem' }, text: 'largest estimate mismatches' })),
    calibration.items.length
      ? h('div', { class: 'table-wrap' },
          h('table', { class: 'table' },
            h('thead', {}, h('tr', {}, h('th', { text: 'Question' }), h('th', { class: 'num', text: 'Estimated' }), h('th', { class: 'num', text: 'Actual avg' }), h('th', { class: 'num', text: 'Delta' }), h('th', { class: 'num', text: 'Samples' }))),
            h('tbody', {}, ...calibration.items.slice(0, 15).map((c) =>
              h('tr', {},
                h('td', { text: `${c.question} · ${c.questionType || ''} ${c.difficulty || ''}` }),
                h('td', { class: 'num', text: `${c.estimated}s` }),
                h('td', { class: 'num', text: `${c.actualAverage}s` }),
                h('td', { class: 'num', text: `${c.delta > 0 ? '+' : ''}${c.delta}s` }),
                h('td', { class: 'num', text: String(c.samples) }),
              ),
            )),
          ),
        )
      : h('div', { class: 'muted', text: 'No timed samples yet.' }),
  );

  /* ------------------------------------------------------ mastery */
  const masteryCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, h('h2', { text: 'PYQ mastery (official corpus)' })),
    mastery.total
      ? h('div', {},
          h('div', { class: 'grid grid-4' },
            tile('Mastered', `${mastery.mastered}`, `${mastery.masteryPercent}% of ${mastery.total} imported PYQs`, mastery.masteryPercent >= 50 ? 'good' : 'warn'),
            tile('Attempted', `${mastery.attempted}`, fmtPct(mastery.attemptedPercent, 0)),
            tile('Struggling', String(mastery.struggling), 'wrong ≥ 2, never right', 'bad'),
            tile('Never attempted', String(mastery.neverAttempted), 'unseen questions'),
          ),
          h('div', { class: 'progress-strip', style: { marginTop: '.8rem' } },
            h('span', { class: 's-correct', style: { width: `${mastery.masteryPercent}%` } }),
            h('span', { class: 's-incorrect', style: { width: `${mastery.struggling ? (mastery.struggling / mastery.total) * 100 : 0}%` } }),
            h('span', { class: 's-unattempted', style: { width: `${mastery.neverAttempted ? (mastery.neverAttempted / mastery.total) * 100 : 0}%` } }),
          ),
          h('div', { class: 'notice', style: { marginTop: '.7rem' }, text: `Mastered = ≥${mastery.rules.minCorrect} correct, ≥${mastery.rules.minAttempts} attempts, and average time within ${mastery.rules.maxTimeRatio}× the estimate.` }),
        )
      : h('div', { class: 'empty' }, h('strong', { text: 'No official PYQs imported yet' }), h('div', { text: 'Import papers in Admin → Import to start measuring mastery.' })),
  );

  /* ------------------------------------------------------ composition */
  mount(
    view,
    h('div', { class: 'row-between', style: { marginBottom: '1rem' } },
      h('div', {},
        h('h1', { text: 'Analytics' }),
        h('div', { class: 'muted', text: 'Am I improving? Where do I lose marks and time?' }),
      ),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/' }, 'Dashboard'), h('a', { class: 'btn', href: '#/pyq' }, 'PYQ Explorer')),
    ),

    h('div', { class: 'grid grid-4' },
      tile('Accuracy', fmtPct(overview.accuracy), `${overview.totalQuestionExposures} exposures`, overview.accuracy >= 60 ? 'good' : 'warn'),
      tile('Tests taken', String(overview.totalTests), 'submitted'),
      tile('Average GS score', overview.averageScorePercent !== null ? fmtPct(overview.averageScorePercent) : '—', 'GS Paper I tests'),
      tile('Best subject', overview.strongestSubject ? overview.strongestSubject.name : '—', overview.strongestSubject ? fmtPct(overview.strongestSubject.accuracy, 0) : 'needs 3+ attempts'),
    ),

    chart,
    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' }, h('h2', { text: 'Performance breakdown' })),
      dimPills,
      perfBody,
    ),
    h('section', { class: 'grid grid-2 section-gap' }, timeCard, masteryCard),
    h('section', { class: 'grid grid-2 section-gap' }, failCard, calibCard),
  );
  void toast;
}
