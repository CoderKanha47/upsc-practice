import { get, post } from '../api.js';
import { h, mount, loadingBox, toast } from '../dom.js';
import { navigate } from '../router.js';
import { getExamMeta, papersForExam } from '../exam-state.js';

export default async function fullpaper(view, params, query) {
  mount(view, loadingBox());
  const examId = query?.exam;
  const examMeta = getExamMeta(examId);
  const papers = papersForExam(examId);
  let status;
  let coverage;
  try {
    [status, coverage] = await Promise.all([
      get('/api/full-paper/status'),
      get(`/api/exact-papers?exam=${encodeURIComponent(examId)}`),
    ]);
  } catch (err) {
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Cannot load Full Paper mode' }), h('div', { text: err.message })));
    return;
  }

  let selectedYear = null;
  let selectedPaper = papers[0]?.id || 'GS1';
  let selectedShift = '';

  const errorSlot = h('div', {});
  const showError = (msg, tone = 'warn') => {
    errorSlot.innerHTML = '';
    errorSlot.appendChild(
      h('div', { class: `notice ${tone === 'warn' ? 'warn' : ''}`, text: msg }),
    );
  };

  const startExact = async () => {
    if (!selectedYear) {
      showError('Pick a year first.');
      return;
    }
    try {
      const res = await post('/api/full-paper/start', {
        kind: 'exact', paper: selectedPaper, year: selectedYear,
        exam: examId, shift: selectedShift || null,
      });
      toast(res.resumed ? 'Resuming your in-progress paper…' : 'Paper started.', 'success');
      navigate(`/exam/${res.session.id}`);
    } catch (err) {
      if (err.code === 'DATA_MISSING') showError(err.message);
      else if (err.code === 'FULL_PAPER_LOCKED') showError(err.message);
      else showError(err.message || 'Could not start the paper.');
    }
  };

  const startMixed = async () => {
    try {
      const res = await post('/api/full-paper/start', { kind: 'mixed', paper: selectedPaper, exam: examId });
      toast(res.resumed ? 'Resuming your in-progress mixed paper…' : 'Mixed paper started.', 'success');
      navigate(`/exam/${res.session.id}`);
    } catch (err) {
      showError(err.message || 'Could not start the mixed paper.');
    }
  };

  let exactBtn = null;
  let mixedBtn = null;
  const poolFor = (paper) => coverage.years.reduce((sum, y) => sum + (y.papers[paper]?.found || 0), 0);
  const mixedHint = h('span', { class: 'muted', style: { fontSize: '.82rem' } });
  const paperTitle = (id) => papers.find((p) => p.id === id)?.shortTitle || id;

  function updateButtons() {
    const pool = poolFor(selectedPaper);
    if (exactBtn) exactBtn.disabled = !status.available || !selectedYear;
    if (mixedBtn) mixedBtn.disabled = !status.available || pool === 0;
    mixedHint.textContent = pool === 0
      ? `Mixed papers use only imported official PYQs — none for ${paperTitle(selectedPaper)} yet (Admin → Import). Nothing is ever invented.`
      : `${pool} official questions available for the mixed pool.`;
  }

  const paperTabs = h(
    'div',
    { class: 'pill-group' },
    ...papers.map((p) =>
      h(
        'button',
        {
          class: `pill ${selectedPaper === p.id ? 'active' : ''}`,
          onClick: (e) => {
            selectedPaper = p.id;
            e.target.parentElement.querySelectorAll('.pill').forEach((b) => b.classList.remove('active'));
            e.target.classList.add('active');
            updateButtons();
          },
        },
        `${p.shortTitle} · ${p.questionCount} Q`,
      ),
    ),
  );

  const yearOpts = coverage.years.map((y) => y.year);
  const yearSelect = h(
    'select',
    {
      onChange: (e) => {
        selectedYear = e.target.value ? Number(e.target.value) : null;
        updateYearInfo();
        updateButtons();
      },
    },
    h('option', { value: '' }, '— Select year —'),
    ...yearOpts.map((y) => h('option', { value: String(y) }, String(y))),
  );

  const shiftSelect = h(
    'select',
    { onChange: (e) => { selectedShift = e.target.value; } },
    h('option', { value: '' }, 'All shifts'),
    h('option', { value: 'SHIFT_1' }, 'Shift 1'),
    h('option', { value: 'SHIFT_2' }, 'Shift 2'),
    h('option', { value: 'SHIFT_3' }, 'Shift 3'),
    h('option', { value: 'SHIFT_4' }, 'Shift 4'),
  );

  const yearInfo = h('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '.4rem' } });
  const updateYearInfo = () => {
    yearInfo.innerHTML = '';
    if (!selectedYear) {
      yearInfo.appendChild(document.createTextNode('Official papers only — never invented.'));
      return;
    }
    const y = coverage.years.find((row) => row.year === selectedYear);
    if (!y) return;
    const info = y.papers[selectedPaper];
    yearInfo.appendChild(
      h(
        'span',
        { class: info.status === 'VERIFIED' ? 'badge badge-verified' : info.status === 'DATA_MISSING' ? 'badge badge-missing' : 'badge badge-review' },
        `${info.status.replace(/_/g, ' ')} · ${info.found}/${info.expected} imported`,
      ),
    );
    yearInfo.appendChild(document.createTextNode(` ${info.found}/${info.expected} questions in database.`));
  };
  updateYearInfo();

  // coverage grid
  const grid = h('div', { class: 'coverage-grid' });
  grid.appendChild(h('div', { class: 'coverage-cell coverage-head', text: 'Year' }));
  for (const p of papers) grid.appendChild(h('div', { class: 'coverage-cell coverage-head', text: p.shortTitle }));
  for (const y of coverage.years) {
    grid.appendChild(h('div', { class: 'coverage-cell coverage-year', text: String(y.year) }));
    for (const p of papers) {
      const info = y.papers[p.id] || { status: 'DATA_MISSING', found: 0, expected: 0 };
      grid.appendChild(
        h(
          'div',
          { class: `coverage-cell st-${info.status}` },
          h('span', { text: info.status.replace(/_/g, ' ') }),
          h('span', { class: 'mono', text: `${info.found}/${info.expected}` }),
        ),
      );
    }
  }

  exactBtn = h('button', { class: 'btn btn-primary btn-lg', onClick: startExact }, 'START EXACT PYQ PAPER');
  mixedBtn = h('button', { class: 'btn btn-lg', onClick: startMixed }, 'Start mixed paper');

  const negLabel = (p) => {
    const perWrong = Math.round(p.marksPerQuestion * p.negativeFraction * 100) / 100;
    return perWrong === Math.round(perWrong) ? `−${perWrong} per wrong` : `−${perWrong.toFixed(2)} per wrong`;
  };

  mount(
    view,
    h('div', { class: 'row-between', style: { marginBottom: '1rem' } },
      h('div', {},
        h('h1', { text: `${examMeta?.name || 'Exam'} · Full Paper Simulation` }),
        h('div', { class: 'muted', text: 'Sunday-only · exact PYQ papers and mixed papers with a strict server-side timer.' }),
      ),
      h('a', { class: 'btn', href: '#/pyq' }, 'PYQ Explorer'),
    ),

    h('section', { class: 'grid grid-2' },
      h('div', { class: `mode-card ${status.available ? 'available' : 'locked'}` },
        h('div', { class: 'row-between' },
          h('h2', { text: status.available ? 'AVAILABLE NOW' : 'LOCKED' }),
          h('span', { class: status.available ? 'badge badge-good' : 'badge badge-neutral', text: `${status.dayName}` }),
        ),
        h('div', { class: 'mode-status', text: status.reason }),
        h('div', { class: 'mode-meta' },
          h('div', {}, h('span', { text: 'Opens' }), h('strong', { text: status.openTime })),
          h('div', {}, h('span', { text: 'Closes' }), h('strong', { text: status.closeTime })),
          h('div', {}, h('span', { text: 'Timezone' }), h('strong', { text: status.timezone })),
          h('div', {}, h('span', { text: 'Server now' }), h('strong', { text: status.serverNowLocal })),
        ),
        h('div', { class: 'notice', text: 'The window is enforced by the server clock. Reloading, switching device or changing your system time cannot unlock it. A test already in progress keeps its original deadline.' }),
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, h('h2', { text: 'Paper format' })),
        h('div', { class: 'mode-meta', style: { marginBottom: '.8rem' } },
          ...papers.map((p) =>
            h('div', {},
              h('span', { text: p.shortTitle }),
              h('strong', { text: `${p.questionCount} Q · ${p.durationMinutes} min · ${p.marks} marks · ${negLabel(p)}${p.qualifying ? ' · qualifying' : ''}` }),
            ),
          ),
        ),
        h('div', { class: 'notice warn', text: 'Choose an exact year paper or a mixed paper. Mixed papers draw randomised questions from the imported PYQ pool using a server seed. Current-pattern sectional mocks follow the configured section rules.' }),
      ),
    ),

    errorSlot,

    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' }, h('h2', { text: 'Start a paper' })),
      h('div', { class: 'stack' },
        h('div', {},
          h('span', { class: 'field-label', text: 'Paper' }),
          paperTabs,
        ),
        h('div', { class: 'grid grid-2' },
          h('label', { class: 'field' },
            h('span', { text: 'Exact PYQ paper (year)' }),
            yearSelect,
            yearInfo,
          ),
          h('label', { class: 'field' },
            h('span', { text: 'Shift (SSC multi-shift papers)' }),
            shiftSelect,
          ),
        ),
        h('div', { class: 'btn-row' },
          exactBtn,
          mixedBtn,
          h('span', { class: 'muted', style: { fontSize: '.82rem' }, text: status.available ? '' : `Locked — ${status.reason}` }),
        ),
        mixedHint,
      ),
    ),

    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' },
        h('h2', { text: `PYQ coverage · ${examMeta?.name || ''}` }),
        h('a', { href: '#/pyq' }, 'Open PYQ Explorer →'),
      ),
      h('div', { class: 'notice', style: { marginBottom: '.8rem' }, text: coverage.note }),
      grid,
      h('div', { class: 'muted', style: { marginTop: '.6rem', fontSize: '.82rem' }, text: `Imported: ${coverage.totals.found} / ${coverage.totals.expected} questions (${coverage.totals.percent}%). Missing years are marked DATA_MISSING and never faked.` }),
    ),
  );
  updateButtons();
}
