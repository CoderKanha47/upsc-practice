import { get, post } from '../api.js';
import { h, mount, loadingBox, fmtPct, fmtDate, toast, badgeForSourceType } from '../dom.js';
import { navigate } from '../router.js';
import { getExamMeta, papersForExam } from '../exam-state.js';

export default async function pyq(view, params, query) {
  mount(view, loadingBox());
  const examId = query?.exam;
  const examMeta = getExamMeta(examId);
  const papers = papersForExam(examId);
  const yearSpan = examMeta ? examMeta.years.end - examMeta.years.start + 1 : 20;
  let coverage;
  let questions;
  try {
    const [covRes, qRes] = await Promise.all([
      get(`/api/pyq/coverage?exam=${encodeURIComponent(examId)}`),
      get(`/api/pyq/questions?exam=${encodeURIComponent(examId)}`),
    ]);
    coverage = covRes;
    questions = qRes.questions || [];
  } catch (err) {
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Cannot load PYQ explorer' }), h('div', { text: err.message })));
    return;
  }

  const state = { year: '', paper: '' };
  const STATUS_LABEL = {
    NEVER_ATTEMPTED: 'Never attempted',
    CORRECT: 'Correct',
    INCORRECT: 'Incorrect',
    MIXED: 'Mixed attempts',
    SKIPPED: 'Skipped',
  };

  const startPractice = async (year, paper) => {
    try {
      const res = await post('/api/pyq/practice', { year, paper, exam: examId });
      navigate(`/exam/${res.session.id}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const questionList = h('div', {});
  function filteredQuestions() {
    return questions.filter(
      (q) => (!state.year || Number(q.year) === Number(state.year)) && (!state.paper || q.paper === state.paper),
    );
  }

  function renderQuestions() {
    questionList.innerHTML = '';
    const items = filteredQuestions();
    if (!items.length) {
      questionList.appendChild(
        h('div', { class: 'empty' },
          h('strong', { text: 'No official questions imported for this selection' }),
          h('div', { text: 'DATA_MISSING — papers are imported through Admin → Import. Nothing is invented.' }),
        ),
      );
      return;
    }
    for (const q of items) {
      const statusBadge =
        q.status === 'NEVER_ATTEMPTED'
          ? h('span', { class: 'badge badge-neutral', text: STATUS_LABEL[q.status] })
          : q.status === 'CORRECT'
            ? h('span', { class: 'badge badge-good', text: STATUS_LABEL[q.status] })
            : q.status === 'INCORRECT'
              ? h('span', { class: 'badge badge-bad', text: STATUS_LABEL[q.status] })
              : h('span', { class: 'badge badge-review', text: STATUS_LABEL[q.status] });

      const revealed = Boolean(q.correct_answer);
      questionList.appendChild(
        h('div', { class: 'review-item' },
          h('div', { class: 'review-head' },
            h('strong', { text: `${q.year} · ${q.paper} · Q${q.question_number}` }),
            badgeForSourceType(q.source_type),
            h('span', { class: q.validation_state === 'VERIFIED' ? 'badge badge-verified' : 'badge badge-review', text: q.validation_state.replace('_', ' ') }),
            statusBadge,
            h('span', { class: 'muted', text: `${q.subject || '—'} · ${q.topic || '—'}` }),
            h('span', { class: 'muted', text: `${q.attempt_count || 0} attempt(s)${q.last_attempted_at ? ` · last ${fmtDate(q.last_attempted_at)}` : ''}` }),
          ),
          h('div', { class: 'review-body' },
            q.passage ? h('div', { class: 'passage' }, q.passage) : null,
            h('div', { class: 'review-q', text: q.question_text }),
            h('div', { class: 'options' },
              ...q.options.map((o) => {
                const key = String(o.key).toUpperCase();
                const isCorrect = revealed && key === String(q.correct_answer).toUpperCase();
                const isYours = q.last_answer && key === String(q.last_answer).toUpperCase();
                return h('div', { class: `review-opt ${isCorrect ? 'correct' : isYours ? 'wrong' : ''}` },
                  h('span', { class: 'k', text: key }),
                  h('span', { text: `${o.text ?? o.content ?? ''}${isCorrect ? '  ✓' : ''}` }),
                );
              }),
            ),
            !revealed
              ? h('div', { class: 'notice', text: 'Answers stay hidden until you have practised this question (attempt it in Selective Practice or PYQ Practice).' })
              : q.explanation
                ? h('div', { class: 'explain' }, h('h4', { text: 'Explanation' }), h('div', { text: q.explanation }))
                : null,
          ),
        ),
      );
    }
  }

  /* year blocks */
  const yearList = h('div', { class: 'year-list' });
  for (const y of coverage.years) {
    const paperBoxes = papers.map((p) => {
      const pid = p.id;
      const info = y.papers[pid] || { status: 'DATA_MISSING', found: 0, expected: 0, keyed: 0, verified: 0 };
      const pool = questions.filter((q) => Number(q.year) === y.year && q.paper === pid);
      const chips = pool.map((q) => {
        const cls =
          q.status === 'CORRECT' ? 'correct' : q.status === 'INCORRECT' ? 'incorrect' : q.status === 'MIXED' ? 'mixed' : q.status === 'SKIPPED' ? 'skipped' : '';
        return h('span', { class: `qchip ${cls}`, title: `Q${q.question_number}: ${STATUS_LABEL[q.status]}` }, `Q${q.question_number}`);
      });
      const attempted = pool.filter((q) => q.status !== 'NEVER_ATTEMPTED');
      const acc = attempted.length
        ? fmtPct((attempted.filter((q) => q.status === 'CORRECT').length / attempted.length) * 100, 0)
        : '—';
      return h('div', { class: 'paper-box' },
        h('div', { class: 'row-between' },
          h('h4', { text: p.shortTitle }),
          h('span', { class: `badge ${info.status === 'VERIFIED' ? 'badge-verified' : info.status === 'DATA_MISSING' ? 'badge-missing' : 'badge-review'}`, text: info.status.replace(/_/g, ' ') }),
        ),
        h('div', { class: 'line' },
          h('span', { text: `${info.found}/${info.expected} imported · ${info.keyed} keyed · ${info.verified} verified` }),
          h('span', { text: `accuracy ${acc}` }),
        ),
        chips.length ? h('div', { class: 'qchip-list' }, chips) : h('div', { class: 'muted', style: { fontSize: '.78rem' }, text: 'DATA_MISSING — not imported.' }),
        h('div', { class: 'btn-row', style: { marginTop: '.6rem' } },
          h('button', {
            class: 'btn btn-sm',
            disabled: info.found === 0,
            onClick: () => startPractice(y.year, pid),
          }, 'Practice this paper (timed dynamically)'),
          h('button', {
            class: 'btn btn-sm btn-ghost',
            onClick: () => {
              state.year = String(y.year);
              state.paper = pid;
              yearSelect.value = state.year;
              paperSelect.value = state.paper;
              renderQuestions();
              questionList.scrollIntoView({ behavior: 'smooth' });
            },
          }, 'Browse questions'),
        ),
      );
    });
    yearList.appendChild(
      h('div', { class: 'year-block' },
        h('div', { class: 'year-head' },
          h('span', { class: 'year', text: String(y.year) }),
          h('span', { class: y.complete ? 'badge badge-verified' : 'badge badge-missing', text: y.complete ? 'Complete' : 'Incomplete' }),
        ),
        h('div', { class: 'year-papers' }, ...paperBoxes),
      ),
    );
  }

  const yearSelect = h('select', {
    onChange: (e) => {
      state.year = e.target.value;
      renderQuestions();
    },
  }, h('option', { value: '' }, 'All years'), ...coverage.years.map((y) => h('option', { value: String(y.year) }, String(y.year))));

  const paperSelect = h('select', {
    onChange: (e) => {
      state.paper = e.target.value;
      renderQuestions();
    },
  },
    h('option', { value: '' }, 'All papers'),
    ...papers.map((p) => h('option', { value: p.id }, p.shortTitle)),
  );

  renderQuestions();

  mount(
    view,
    h('div', { class: 'row-between', style: { marginBottom: '1rem' } },
      h('div', {},
        h('h1', { text: `${examMeta?.name || 'Exam'} · PYQ Explorer` }),
        h('div', { class: 'muted', text: `${examMeta ? `${examMeta.years.start}–${examMeta.years.end}` : ''} papers, exactly as imported — never rewritten.` }),
      ),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/selective' }, 'Selective practice'), h('a', { class: 'btn', href: '#/' }, 'Dashboard')),
    ),

    h('div', { class: 'grid grid-3' },
      h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Imported' }), h('div', { class: 'tile-value', text: `${coverage.totals.found} / ${coverage.totals.expected}` }), h('div', { class: 'tile-sub', text: `${coverage.totals.percent}% of the ${yearSpan}-year corpus` })),
      h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Answer-keyed' }), h('div', { class: 'tile-value', text: String(coverage.totals.keyed) }), h('div', { class: 'tile-sub', text: 'questions with a correct answer' })),
      h('div', { class: 'tile' }, h('div', { class: 'tile-label', text: 'Your attempts' }), h('div', { class: 'tile-value', text: String(questions.filter((q) => q.status !== 'NEVER_ATTEMPTED').length) }), h('div', { class: 'tile-sub', text: 'official questions attempted' })),
    ),

    h('section', { class: 'section-gap' },
      h('div', { class: 'card-title' }, h('h2', { text: 'Coverage by year' })),
      h('div', { class: 'notice', style: { marginBottom: '.8rem' }, text: coverage.note }),
      yearList,
    ),

    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' },
        h('h2', { text: 'Browse questions' }),
        h('div', { class: 'btn-row' }, yearSelect, paperSelect),
      ),
      questionList,
    ),
  );
}
