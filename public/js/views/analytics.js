import { get } from '../api.js';
import { h, mount, loadingBox, fmtPct, fmtDuration, bar } from '../dom.js';
import { navigate } from '../router.js';
import { getExamMeta, papersForExam, paperLabel } from '../exam-state.js';

export default async function analytics(view, params, query) {
  mount(view, loadingBox('Crunching your numbers…'));
  const examId = query?.exam;
  const examMeta = getExamMeta(examId);
  const papers = papersForExam(examId);
  const qExam = `exam=${encodeURIComponent(examId)}`;
  let overview;
  let time;
  let trend;
  let failures;
  let calibration;
  let mastery;
  let progress;
  try {
    [overview, time, trend, failures, calibration, mastery, progress] = await Promise.all([
      get(`/api/analytics/overview?${qExam}`),
      get('/api/analytics/time'),
      get(`/api/analytics/trend?${qExam}`),
      get(`/api/analytics/failures?${qExam}`),
      get('/api/analytics/calibration'),
      get(`/api/analytics/mastery?${qExam}`),
      get('/api/analytics/progress'),
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

  /* ------------------------------------------- progress chart (6 series) */
  // Six independent series: UPSC full/selective plus SSC Tier-I and Tier-II,
  // each split by full paper vs selective practice.
  const SERIES_COLORS = {
    UPSC_FULL: 'var(--navy)',
    UPSC_SELECTIVE: 'var(--info-text)',
    SSC_T1_FULL: 'var(--accent)',
    SSC_T1_SELECTIVE: 'var(--purple)',
    SSC_T2_FULL: '#b45309',
    SSC_T2_SELECTIVE: '#0e7490',
  };
  let allSeries = progress?.series || [];
  const hiddenSeries = new Set();

  const fTier = h('select', { class: 'sm' },
    h('option', { value: '' }, 'All tiers'),
    h('option', { value: 'UPSC' }, 'UPSC'),
    h('option', { value: 'SSC' }, 'SSC'),
    h('option', { value: 'TIER_I' }, 'SSC Tier-I'),
    h('option', { value: 'TIER_II' }, 'SSC Tier-II'),
  );
  const fMode = h('select', { class: 'sm' },
    h('option', { value: '' }, 'Full + selective'),
    h('option', { value: 'FULL' }, 'Full paper only'),
    h('option', { value: 'SELECTIVE' }, 'Selective only'),
  );
  const fFrom = h('input', { type: 'date', class: 'sm' });
  const fTo = h('input', { type: 'date', class: 'sm' });
  const fApply = h('button', { class: 'btn btn-sm', type: 'button', text: 'Apply' });
  const fNote = h('span', { class: 'muted', style: { fontSize: '.76rem' } });
  const fError = h('div', { class: 'notice warn', style: { display: 'none' } });

  async function applyProgressFilters() {
    fError.style.display = 'none';
    const q = new URLSearchParams();
    if (fTier.value) q.set('tiers', fTier.value);
    if (fMode.value) q.set('modes', fMode.value);
    if (fFrom.value) q.set('from', fFrom.value);
    if (fTo.value) q.set('to', fTo.value);
    try {
      const data = await get(`/api/analytics/progress?${q}`);
      allSeries = data.series || [];
      progress.absentCount = data.absentCount;
      hiddenSeries.clear();
      redraw();
      fNote.textContent = data.note ? ` · ${data.note}` : '';
    } catch (err) {
      fError.textContent = err.message;
      fError.style.display = '';
    }
  }
  fApply.addEventListener('click', applyProgressFilters);

  function renderProgress() {
    const anyPoints = allSeries.some((s) => s.points?.length);
    const legend = h('div', { class: 'progress-legend' },
      ...allSeries.map((s) => {
        const btn = h('button', {
          class: `legend-toggle ${hiddenSeries.has(s.id) ? 'off' : ''}`,
          type: 'button',
          onClick: () => {
            if (hiddenSeries.has(s.id)) hiddenSeries.delete(s.id);
            else hiddenSeries.add(s.id);
            redraw();
          },
        },
          h('span', { class: 'legend-dot', style: { background: SERIES_COLORS[s.id] || 'var(--muted)' } }),
          h('span', { text: `${s.label} (${s.points?.length || 0})` }),
        );
        return btn;
      }),
    );

    const chartSlot = h('div', {});
    function drawChart() {
      const active = allSeries.filter((s) => !hiddenSeries.has(s.id));
      chartSlot.innerHTML = '';
      if (!anyPoints) {
        chartSlot.appendChild(h('div', { class: 'empty' }, h('strong', { text: 'No submitted tests yet' }), h('div', { text: 'Score-normalised progress appears after your first submitted test in each mode.' })));
        return;
      }
      const w = 760;
      const hgt = 180;
      const pad = 30;
      const max = 100;
      const totalPoints = active.reduce((n, s) => n + (s.points?.length || 0), 0);
      const x = (i, len) => pad + (i * (w - pad * 2)) / Math.max(1, len - 1);
      const y = (v) => hgt - pad - (Math.min(max, Math.max(0, v)) / max) * (hgt - pad * 2);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
      svg.setAttribute('class', 'trend-chart');
      let inner = `
        <line class="axis" x1="${pad}" y1="${y(0)}" x2="${w - pad}" y2="${y(0)}"></line>
        <line class="axis" x1="${pad}" y1="${y(50)}" x2="${w - pad}" y2="${y(50)}" stroke-dasharray="4 4"></line>
        <line class="axis" x1="${pad}" y1="${y(100)}" x2="${w - pad}" y2="${y(100)}" stroke-dasharray="2 6"></line>
      `;
      for (const s of active) {
        const pts = s.points || [];
        if (!pts.length) continue;
        const color = SERIES_COLORS[s.id] || '#888';
        const coords = pts.map((p, i) => `${x(i, pts.length)},${y(p.scorePercent ?? 0)}`).join(' ');
        if (pts.length > 1) inner += `<polyline points="${coords}" style="fill:none;stroke:${color};stroke-width:2"></polyline>`;
        inner += pts.map((p, i) =>
          `<circle cx="${x(i, pts.length)}" cy="${y(p.scorePercent ?? 0)}" r="3.5" style="fill:${color}"><title>${s.label} · ${p.title}: ${p.scorePercent ?? 0}% (${p.marksObtained}/${p.totalMarks ?? '?'})</title></circle>`,
        ).join('');
      }
      svg.innerHTML = inner;
      chartSlot.appendChild(h('div', { class: 'table-wrap' }, svg));
      if (!totalPoints) chartSlot.appendChild(h('div', { class: 'muted', style: { fontSize: '.8rem' }, text: 'No points in the selected series.' }));
    }
    function redraw() {
      legend.querySelectorAll('.legend-toggle').forEach((b) => b.classList.remove('off'));
      allSeries.forEach((s, i) => {
        if (hiddenSeries.has(s.id)) legend.querySelectorAll('.legend-toggle')[i]?.classList.add('off');
      });
      drawChart();
    }
    drawChart();
    return h('div', {}, legend, chartSlot);
  }

  const progressCard = h('div', { class: 'card' },
    h('div', { class: 'card-title' },
      h('h2', { text: 'Progress by mode' }),
      h('span', { class: 'muted', style: { fontSize: '.82rem' }, text: 'score % normalised · Full Paper vs Selective, per exam and SSC tier' }),
    ),
    h('div', { class: 'pill-group', style: { marginBottom: '.5rem' } },
      fTier, fMode, fFrom, fTo, fApply,
      h('span', { class: 'muted', style: { fontSize: '.76rem' }, text: progress.absentCount ? `· ${progress.absentCount} ABSENT session(s) excluded` : '· no ABSENT sessions' }),
      fNote,
    ),
    fError,
    renderProgress(),
  );

  /* ------------------------------------------------------ performance table */
  let dimension = 'subject';
  let perfPaper = '';
  const perfBody = h('div', {}, loadingBox());

  async function loadPerf() {
    perfBody.innerHTML = '';
    perfBody.appendChild(loadingBox());
    try {
      const q = new URLSearchParams({ dimension, minAttempts: '3', exam: examId });
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
      style: { maxWidth: '180px' },
      onChange: (e) => {
        perfPaper = e.target.value;
        loadPerf();
      },
    }, h('option', { value: '' }, 'All papers'), ...papers.map((p) => h('option', { value: p.id }, p.shortTitle))),
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
        h('h1', { text: `${examMeta?.name || 'Exam'} · Analytics` }),
        h('div', { class: 'muted', text: 'Am I improving? Where do I lose marks and time?' }),
      ),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/' }, 'Dashboard'), h('a', { class: 'btn', href: '#/pyq' }, 'PYQ Explorer')),
    ),

    h('div', { class: 'grid grid-4' },
      tile('Accuracy', fmtPct(overview.accuracy), `${overview.totalQuestionExposures} exposures`, overview.accuracy >= 60 ? 'good' : 'warn'),
      tile('Tests taken', String(overview.totalTests), 'submitted'),
      tile('Average score', overview.averageScorePercent !== null ? fmtPct(overview.averageScorePercent) : '—', `${paperLabel(examMeta?.defaultPaper)} tests`),
      tile('Best subject', overview.strongestSubject ? overview.strongestSubject.name : '—', overview.strongestSubject ? fmtPct(overview.strongestSubject.accuracy, 0) : 'needs 3+ attempts'),
    ),

    chart,
    progressCard,
    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' }, h('h2', { text: 'Performance breakdown' })),
      dimPills,
      perfBody,
    ),
    h('section', { class: 'grid grid-2 section-gap' }, timeCard, masteryCard),
    h('section', { class: 'grid grid-2 section-gap' }, failCard, calibCard),
  );
}
