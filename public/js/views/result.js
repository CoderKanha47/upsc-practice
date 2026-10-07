import { get, post } from '../api.js';
import { h, mount, loadingBox, fmtClock, fmtDuration, fmtDate, fmtPct, toast, badgeForSourceType, confirmDialog, bar } from '../dom.js';
import { navigate } from '../router.js';

export default async function result(view, params) {
  mount(view, loadingBox('Scoring your test…'));
  let data;
  try {
    data = await get(`/api/sessions/${encodeURIComponent(params.id)}/result`);
  } catch (err) {
    if (err.code === 'NOT_SUBMITTED') {
      mount(
        view,
        h('div', { class: 'empty' },
          h('strong', { text: 'Test still in progress' }),
          h('div', { text: 'Finish it first — the timer keeps running on the server.' }),
          h('a', { class: 'btn btn-primary', style: { marginTop: '1rem' }, href: `#/exam/${params.id}` }, 'Resume test'),
        ),
      );
      return;
    }
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Result not available' }), h('div', { text: err.message }), h('a', { class: 'btn', style: { marginTop: '1rem' }, href: '#/' }, 'Dashboard')));
    return;
  }

  const { session, paper, score, qualification, review, distribution, time } = data;
  const filterState = { filter: 'ALL', query: '' };

  const isCsat = session.paper === 'CSAT';
  const pct = score.totalMarks ? (score.marksObtained / score.totalMarks) * 100 : 0;

  /* ---------------------------------------------------- hero + tiles */
  const hero = h(
    'div',
    { class: 'result-hero' },
    h('div', {},
      h('h1', { text: session.title }),
      h('div', { class: 'sub', text: `${session.kindLabel} · ${paper.title} · ${paper.questionCount} questions · ${paper.durationMinutes} minutes` }),
      h('div', { class: 'sub', text: `${fmtDate(session.started_at)}${session.status === 'AUTO_SUBMITTED' ? ' · auto-submitted at time over' : ''}` }),
    ),
    h('div', { class: 'result-score' },
      h('div', { class: 'big', text: `${score.marksObtained} / ${score.totalMarks}` }),
      h('div', { class: 'of', text: `${pct.toFixed(1)}% of total marks · ${score.accuracy}% accuracy` }),
      isCsat
        ? h('span', { class: `qual-badge ${qualification.status === 'QUALIFIED' ? 'pass' : 'fail'}`, text: `CSAT: ${qualification.status} (need ${qualification.thresholdMarks}/${paper.marks})` })
        : h('span', { class: `qual-badge ${qualification.position.startsWith('BELOW') ? 'fail' : 'pass'}`, text: `GS indicative band: ${qualification.position}` }),
    ),
  );

  const tile = (label, value, sub = '', tone = '') =>
    h('div', { class: `tile ${tone}` },
      h('div', { class: 'tile-label', text: label }),
      h('div', { class: 'tile-value', text: value }),
      sub ? h('div', { class: 'tile-sub', text: sub }) : null,
    );

  const strip = h(
    'div',
    { class: 'progress-strip', title: 'Correct / incorrect / unattempted' },
    h('span', { class: 's-correct', style: { width: `${(score.correct / Math.max(1, review.length)) * 100}%` } }),
    h('span', { class: 's-incorrect', style: { width: `${(score.incorrect / Math.max(1, review.length)) * 100}%` } }),
    h('span', { class: 's-unattempted', style: { width: `${(score.unattempted / Math.max(1, review.length)) * 100}%` } }),
  );

  const tiles = h('div', { class: 'grid grid-4', style: { marginTop: '1rem' } },
    tile('Attempted', `${score.attempted} / ${review.length}`, `${score.unattempted} unattempted`),
    tile('Correct', String(score.correct), `+${score.correctMarks} marks`, 'good'),
    tile('Incorrect', String(score.incorrect), `−${score.negativeMarks} marks (1/3)`, 'bad'),
    tile('Time used', fmtDuration(score.timeUsedSeconds), score.autoSubmitted ? 'submitted at time over' : `${fmtDuration(score.timeRemainingSeconds)} left`),
  );

  const qualificationNotice = isCsat
    ? h('div', { class: `notice ${qualification.status === 'QUALIFIED' ? 'good' : 'warn'}`, text: `${qualification.note} Threshold: ${qualification.thresholdMarks} marks (${qualification.qualifyingPercentage}% of ${paper.marks}).` })
    : h('div', { class: 'notice warn', text: `${qualification.disclaimer} Your ${score.marksObtained} marks sit ${qualification.position.toLowerCase()} (${qualification.range[0]}–${qualification.range[1]}).` });

  /* ---------------------------------------------------- breakdown */
  const breakdownCard = (title, bucket) => {
    const entries = Object.entries(bucket || {}).sort((a, b) => b[1].accuracy - a[1].accuracy);
    if (!entries.length) return h('div', { class: 'card' }, h('h3', { text: title }), h('div', { class: 'muted', text: 'No data.' }));
    return h('div', { class: 'card' },
      h('h3', { text: title }),
      ...entries.map(([key, v]) => {
        const tone = v.accuracy >= 70 ? 'good' : v.accuracy < 40 ? 'bad' : 'warn';
        return h('div', {},
          bar(`${key} (${v.correct}/${v.attempted})`, v.accuracy, 100, tone),
          h('div', { class: 'muted', style: { fontSize: '.74rem', marginTop: '-.2rem', marginBottom: '.5rem' }, text: `${v.total} questions · avg ${v.averageTimeSeconds}s per question` }),
        );
      }),
    );
  };

  const timeCard = h('div', { class: 'card' },
    h('h3', { text: 'Time analysis' }),
    time.count
      ? h('div', {},
          h('div', { class: 'grid grid-2' },
            tile('Average', fmtDuration(time.averageSeconds), `${time.count} timed questions`),
            tile('Median', fmtDuration(time.medianSeconds)),
            tile('Fastest', fmtDuration(time.fastest.seconds), time.fastest.question ? `Question ${time.fastest.question}` : ''),
            tile('Slowest', fmtDuration(time.slowest.seconds), time.slowest.question ? `Question ${time.slowest.question}` : ''),
          ),
          h('div', { class: 'notice', style: { marginTop: '.7rem' }, text: 'Compare each question\u2019s time against its estimated time in the review below — positive deltas mean you are running long.' }),
        )
      : h('div', { class: 'muted', text: 'No timed answers recorded.' }),
  );

  /* ---------------------------------------------------- review list */
  const reviewList = h('div', {});
  const filterPills = h('div', { class: 'pill-group' });
  const summaryLine = h('div', { class: 'muted', style: { fontSize: '.84rem' } });

  const FILTERS = [
    ['ALL', `All (${review.length})`],
    ['incorrect', `Incorrect (${score.incorrect})`],
    ['correct', `Correct (${score.correct})`],
    ['unattempted', `Unattempted (${score.unattempted})`],
    ['marked', `Marked (${review.filter((r) => r.marked).length})`],
  ];
  for (const [id, label] of FILTERS) {
    filterPills.appendChild(
      h('button', {
        class: `pill ${filterState.filter === id ? 'active' : ''}`,
        onClick: (e) => {
          filterState.filter = id;
          filterPills.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
          e.target.classList.add('active');
          renderReview();
        },
      }, label),
    );
  }

  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Filter by text, subject, topic or year…',
    style: { maxWidth: '340px' },
    onInput: (e) => {
      filterState.query = e.target.value.toLowerCase().trim();
      renderReview();
    },
  });

  function practiceSimilar(item) {
    const doIt = async () => {
      try {
        const sim = await get(`/api/questions/${encodeURIComponent(item.id)}/similar?limit=5`);
        const ids = sim.questions.map((q) => q.id);
        if (!ids.length) {
          toast('No similar questions in the bank yet.', 'error');
          return;
        }
        const started = await post('/api/selective/start', { includeIds: ids, count: 'all', includeOfficial: true, includeAiGenerated: true, includeCustom: true });
        navigate(`/exam/${started.session.id}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    doIt();
  }

  function reviewItem(r) {
    const resultBadge =
      r.result === 'correct'
        ? h('span', { class: 'badge badge-good', text: 'Correct' })
        : r.result === 'incorrect'
          ? h('span', { class: 'badge badge-bad', text: 'Incorrect' })
          : h('span', { class: 'badge badge-neutral', text: 'Unattempted' });

    const options = r.options.map((o) => {
      const key = String(o.key).toUpperCase();
      const isCorrect = r.correct_answer && key === String(r.correct_answer).toUpperCase();
      const isYours = r.your_answer && key === String(r.your_answer).toUpperCase();
      const cls = isCorrect ? 'review-opt correct' : isYours ? 'review-opt wrong' : 'review-opt';
      return h('div', { class: cls },
        h('span', { class: 'k', text: key }),
        h('span', { text: `${o.text ?? o.content ?? ''}${isCorrect ? '  ✓ correct' : ''}${isYours && !isCorrect ? '  ✗ your answer' : ''}` }),
      );
    });

    return h('div', { class: 'review-item' },
      h('div', { class: 'review-head' },
        h('strong', { text: `Q${r.number}` }),
        resultBadge,
        badgeForSourceType(r.source_type),
        r.marked ? h('span', { class: 'badge badge-purple', text: 'Marked' }) : null,
        h('span', { text: `${r.year} · ${r.subject || '—'} · ${r.topic || '—'}` }),
        h('span', { class: 'muted', text: `you: ${r.your_answer || '—'} · answer: ${r.correct_answer || '—'}` }),
        h('span', { class: 'muted', text: `⏱ ${fmtDuration(r.time_spent_seconds)} / est ${fmtDuration(r.estimated_time_seconds)}` }),
        h('span', { style: { marginLeft: 'auto' } },
          h('button', { class: 'btn btn-sm', onClick: () => practiceSimilar(r) }, 'Practice 5 similar'),
        ),
      ),
      h('div', { class: 'review-body' },
        r.passage ? h('div', { class: 'passage' }, r.passage) : null,
        h('div', { class: 'review-q', text: r.question_text }),
        options,
        r.explanation || r.concept || r.source
          ? h('div', { class: 'explain' },
              r.explanation ? h('div', {}, h('h4', { text: 'Explanation' }), h('div', { text: r.explanation })) : null,
              r.concept ? h('div', { class: 'concept', text: `Concept: ${r.concept}` }) : null,
              r.source ? h('div', { class: 'muted', style: { fontSize: '.8rem', marginTop: '.4rem' }, text: `Source: ${r.source}` }) : null,
            )
          : null,
      ),
    );
  }

  function renderReview() {
    reviewList.innerHTML = '';
    const items = review.filter((r) => {
      if (filterState.filter === 'incorrect' && r.result !== 'incorrect') return false;
      if (filterState.filter === 'correct' && r.result !== 'correct') return false;
      if (filterState.filter === 'unattempted' && r.result !== 'unattempted') return false;
      if (filterState.filter === 'marked' && !r.marked) return false;
      if (filterState.query) {
        const hay = `${r.question_text} ${r.subject || ''} ${r.topic || ''} ${r.year} ${r.number}`.toLowerCase();
        if (!hay.includes(filterState.query)) return false;
      }
      return true;
    });
    summaryLine.textContent = `${items.length} question${items.length === 1 ? '' : 's'} shown`;
    if (!items.length) {
      reviewList.appendChild(h('div', { class: 'empty' }, h('strong', { text: 'Nothing matches this filter' }), h('div', { text: 'Try another filter or clear the search.' })));
      return;
    }
    items.forEach((r) => reviewList.appendChild(reviewItem(r)));
  }
  renderReview();

  mount(
    view,
    h('div', { class: 'btn-row', style: { marginBottom: '1rem' } },
      h('a', { class: 'btn', href: '#/' }, '← Dashboard'),
      h('a', { class: 'btn', href: '#/analytics' }, 'Analytics'),
      score.autoSubmitted ? h('span', { class: 'badge badge-review', text: 'Auto-submitted at time over' }) : null,
    ),
    hero,
    tiles,
    strip,
    qualificationNotice,
    h('section', { class: 'grid grid-4 section-gap' },
      breakdownCard('By subject', distribution.subject),
      breakdownCard('By question type', distribution.questionType),
      breakdownCard('By difficulty', distribution.difficulty),
      timeCard,
    ),
    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' },
        h('h2', { text: 'Answer review' }),
        h('div', { class: 'btn-row' }, searchInput),
      ),
      h('div', { class: 'row-between', style: { marginBottom: '.8rem' } }, filterPills, summaryLine),
      reviewList,
    ),
  );
  void fmtClock;
}
