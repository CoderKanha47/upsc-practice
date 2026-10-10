import { get, post } from '../api.js';
import { h, mount, loadingBox, fmtDuration, toast } from '../dom.js';
import { navigate } from '../router.js';
import { getExamMeta } from '../exam-state.js';

export default async function selective(view, params, query) {
  mount(view, loadingBox());
  const examId = query?.exam;
  const examMeta = getExamMeta(examId);
  let opts;
  try {
    opts = await get(`/api/selective/options?exam=${encodeURIComponent(examId)}`);
  } catch (err) {
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Cannot load practice options' }), h('div', { text: err.message })));
    return;
  }

  const paperIds = new Set((opts.papers || []).map((p) => p.id));
  const subjectNames = [...new Set(
    Object.entries(opts.subjects || {})
      .filter(([paper]) => paperIds.has(paper))
      .flatMap(([, list]) => list),
  )];

  const state = {
    exam: examId,
    papers: [],
    subjects: [],
    topics: [],
    types: [],
    difficulties: [],
    years: [],
    includeOfficial: true,
    includeAiGenerated: true,
    includeCustom: false,
    avoidSeen: false,
    count: 10,
  };

  const body = () => ({
    exam: state.exam,
    papers: state.papers,
    subjects: state.subjects,
    topics: state.topics,
    types: state.types,
    difficulties: state.difficulties,
    years: state.years,
    includeOfficial: state.includeOfficial,
    includeAiGenerated: state.includeAiGenerated,
    includeCustom: state.includeCustom,
    avoidSeen: state.avoidSeen,
    count: state.count === 'all' ? 'all' : state.count,
  });

  const checkGrid = (items, key, labelFn = (x) => x) =>
    h(
      'div',
      { class: 'check-grid' },
      ...items.map((item) => {
        const value = typeof item === 'object' ? item.value : item;
        const label = typeof item === 'object' ? item.label : labelFn(item);
        const count = typeof item === 'object' && item.count !== undefined ? item.count : null;
        const input = h('input', { type: 'checkbox' });
        input.checked = Array.isArray(state[key]) && state[key].includes(value);
        input.addEventListener('change', () => {
          if (input.checked) state[key].push(value);
          else state[key] = state[key].filter((v) => v !== value);
          schedulePreview();
          if (key === 'subjects') renderTopics();
        });
        return h('label', { class: 'check' }, input, h('span', { text: label }), count !== null ? h('span', { class: 'count', text: `${count}` }) : null);
      }),
    );

  const topicsForSubjects = () => {
    const allowed = new Set(state.subjects);
    return opts.topics
      .filter((t) => !state.subjects.length || allowed.has(t.subject))
      .slice(0, 400);
  };

  const topicSlot = h('div', {});
  const renderTopics = () => {
    topicSlot.innerHTML = '';
    const list = topicsForSubjects();
    if (!list.length) {
      topicSlot.appendChild(h('div', { class: 'muted', style: { fontSize: '.82rem' }, text: 'No topics match. Import more questions or widen subject selection.' }));
      return;
    }
    topicSlot.appendChild(
      checkGrid(
        list.map((t) => ({ value: t.topic || t.subject, label: `${t.topic || '—'} · ${t.subject}`, count: t.count })),
        'topics',
      ),
    );
  };

  const previewSlot = h('div', {}, loadingBox('Calculating timing…'));
  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 300);
  }

  async function runPreview() {
    previewSlot.innerHTML = '';
    previewSlot.appendChild(loadingBox('Calculating timing…'));
    try {
      const p = await post('/api/selective/preview', body());
      const t = p.timing;
      const rows = [];
      const add = (label, value, sub) =>
        rows.push(
          h('div', { class: 'tile' },
            h('div', { class: 'tile-label', text: label }),
            h('div', { class: 'tile-value', text: value }),
            sub ? h('div', { class: 'tile-sub', text: sub }) : null,
          ),
        );
      add('Questions', String(p.actual), p.poolSize !== undefined ? `pool: ${p.poolSize}` : '');
      add('Base time', fmtDuration(t.baseSeconds), `${Math.round((t.baseSeconds / Math.max(1, p.actual)) * 10) / 10}s per question`);
      add('Buffer', fmtDuration(t.bufferTotalSeconds ?? t.bufferSeconds * p.actual), `${t.bufferSeconds}s × ${p.actual} questions`);
      add('Total time', t.totalFormatted || t.formatted?.total || fmtDuration(t.totalSeconds), 'what your timer will show');

      const src = Object.entries(p.sourceMix || {})
        .map(([k, v]) => `${k.replace('_', ' ').toLowerCase()}: ${v}`)
        .join(' · ');
      const dist = (p.distribution?.subject
        ? Object.entries(p.distribution.subject).filter(([k]) => k && k !== 'null').map(([k, v]) => `${k} ${v}`)
        : []
      ).join(' · ');

      previewSlot.innerHTML = '';
      previewSlot.appendChild(
        h('div', { class: 'grid grid-4' }, ...rows),
        h('div', { class: 'notice', style: { marginTop: '.7rem' } },
          h('div', { text: `Source mix — ${src || 'none'}` }),
          h('div', { text: `Subject spread — ${dist || 'none'}` }),
          h('div', { text: `Seed: ${p.seed ?? 'auto'} · pool size ${p.poolSize}` }),
        ),
      );
      startBtn.disabled = p.actual === 0;
      if (p.actual === 0) previewSlot.appendChild(h('div', { class: 'notice warn', style: { marginTop: '.6rem' }, text: 'No questions match these filters. Deselect some filters or import more questions (Admin → Import).' }));
    } catch (err) {
      previewSlot.innerHTML = '';
      previewSlot.appendChild(h('div', { class: 'notice warn', text: err.message }));
    }
  }

  const startBtn = h('button', {
    class: 'btn btn-accent btn-lg',
    onClick: async () => {
      startBtn.disabled = true;
      try {
        const res = await post('/api/selective/start', body());
        navigate(`/exam/${res.session.id}`);
      } catch (err) {
        toast(err.message, 'error');
        startBtn.disabled = false;
      }
    },
  }, 'START PRACTICE');

  const countGroup = h(
    'div',
    { class: 'pill-group' },
    ...[...opts.presets, 'all'].map((n) => {
      const label = n === 'all' ? 'All in pool' : `${n} questions`;
      const btn = h('button', {
        class: `pill ${state.count === n ? 'active' : ''}`,
        onClick: (e) => {
          state.count = n;
          countGroup.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
          e.target.classList.add('active');
          schedulePreview();
        },
      }, label);
      return btn;
    }),
  );

  const sourceToggles = h(
    'div',
    { class: 'check-grid' },
    ...[
      ['includeOfficial', 'Official PYQs', opts.counts.official],
      ['includeAiGenerated', 'AI-generated practice questions', opts.counts.aiGenerated],
      ['includeCustom', 'Custom imported questions', opts.counts.custom],
    ].map(([key, label, count]) => {
      const input = h('input', { type: 'checkbox' });
      input.checked = state[key];
      input.addEventListener('change', () => {
        state[key] = input.checked;
        schedulePreview();
      });
      return h('label', { class: 'check' }, input, h('span', { text: label }), h('span', { class: 'count', text: `${count}` }));
    }),
  );

  const avoidInput = h('input', { type: 'checkbox' });
  avoidInput.addEventListener('change', () => {
    state.avoidSeen = avoidInput.checked;
    schedulePreview();
  });

  renderTopics();
  schedulePreview();

  mount(
    view,
    h('div', { class: 'row-between', style: { marginBottom: '1rem' } },
      h('div', {},
        h('h1', { text: 'Selective Practice' }),
        h('div', { class: 'muted', text: `${examMeta?.name || 'Exam'} · Always available. The timer is calculated from question difficulty, type and a per-question buffer.` }),
      ),
      h('span', { class: 'badge badge-good', text: 'Unlocked' }),
    ),

    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, h('h2', { text: 'Scope' })),
        h('label', { class: 'field' }, h('span', { text: 'Paper' }), checkGrid(
          (opts.papers || []).map((p) => ({ value: p.id, label: `${p.shortTitle}${p.sectional?.enabled ? ' (sectional)' : ''}`, count: opts.counts[p.id] })),
          'papers',
        )),
        h('div', { class: 'field-label', text: 'Subject' }),
        checkGrid(subjectNames.map((s) => ({ value: s, label: s })), 'subjects'),
        h('div', { class: 'divider' }),
        h('div', { class: 'field-label', text: 'Topic (of selected subjects)' }),
        topicSlot,
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, h('h2', { text: 'Question properties' })),
        h('div', { class: 'field-label', text: 'Question type' }),
        checkGrid(opts.questionTypes.map((t) => ({ value: t, label: t })), 'types'),
        h('div', { class: 'divider' }),
        h('div', { class: 'field-label', text: 'Difficulty' }),
        checkGrid(opts.difficulties.map((d) => ({ value: d, label: d })), 'difficulties'),
        h('div', { class: 'divider' }),
        h('div', { class: 'field-label', text: 'Year' }),
        checkGrid(opts.years.slice().reverse().map((y) => ({ value: y, label: String(y) })), 'years'),
        h('div', { class: 'divider' }),
        h('div', { class: 'field-label', text: 'Question bank' }),
        sourceToggles,
        h('label', { class: 'check' }, avoidInput, h('span', { text: 'Avoid questions I have already seen' })),
      ),
    ),

    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' }, h('h2', { text: 'How many?' })),
      countGroup,
      h('div', { class: 'muted', style: { marginTop: '.5rem', fontSize: '.84rem' }, text: `Custom maximum per session: ${opts.customMax} · default buffer ${opts.bufferSeconds}s per question.` }),
    ),

    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' },
        h('h2', { text: 'Timing preview' }),
        h('span', { class: 'muted', style: { fontSize: '.82rem' }, text: 'Base time + buffer = total. Shown before you start.' }),
      ),
      previewSlot,
      h('div', { class: 'btn-row', style: { marginTop: '1rem' } }, startBtn, h('a', { class: 'btn', href: '#/' }, 'Back to dashboard')),
    ),
  );
}
