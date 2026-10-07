import { get, post } from '../api.js';
import { h, mount, loadingBox, fmtDuration, toast } from '../dom.js';
import { navigate } from '../router.js';

export default async function fullpaper(view) {
  mount(view, loadingBox());
  let status;
  let coverage;
  try {
    [status, coverage] = await Promise.all([get('/api/full-paper/status'), get('/api/exact-papers')]);
  } catch (err) {
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Cannot load Full Paper mode' }), h('div', { text: err.message })));
    return;
  }

  let selectedYear = null;
  let selectedPaper = 'GS1';
  let errorBox = null;

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
      const res = await post('/api/full-paper/start', { kind: 'exact', paper: selectedPaper, year: selectedYear });
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
      const res = await post('/api/full-paper/start', { kind: 'mixed', paper: selectedPaper });
      toast(res.resumed ? 'Resuming your in-progress mixed paper…' : 'Mixed paper started.', 'success');
      navigate(`/exam/${res.session.id}`);
    } catch (err) {
      showError(err.message || 'Could not start the mixed paper.');
    }
  };

  /* buttons are created after these helpers, then wired up */
  let exactBtn = null;
  let mixedBtn = null;
  const poolFor = (paper) => coverage.years.reduce((sum, y) => sum + (y.papers[paper]?.found || 0), 0);
  const mixedHint = h('span', { class: 'muted', style: { fontSize: '.82rem' } });

  function updateButtons() {
    const pool = poolFor(selectedPaper);
    if (exactBtn) exactBtn.disabled = !status.available || !selectedYear;
    if (mixedBtn) mixedBtn.disabled = !status.available || pool === 0;
    mixedHint.textContent = pool === 0
      ? `Mixed papers use only imported official PYQs — none for ${selectedPaper === 'GS1' ? 'GS Paper I' : 'CSAT'} yet (Admin → Import). Nothing is ever invented.`
      : `${pool} official questions available for the mixed pool.`;
  }

  const paperTabs = h(
    'div',
    { class: 'pill-group' },
    ...[
      ['GS1', 'GS Paper I · 100 Q'],
      ['CSAT', 'CSAT · 80 Q'],
    ].map(([id, label]) =>
      h(
        'button',
        {
          class: `pill ${selectedPaper === id ? 'active' : ''}`,
          onClick: (e) => {
            selectedPaper = id;
            e.target.parentElement.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
            e.target.classList.add('active');
            updateButtons();
          },
        },
        label,
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

  const yearInfo = h('div', { class: 'muted', style: { fontSize: '.82rem', marginTop: '.4rem' } });
  const updateYearInfo = () => {
    yearInfo.innerHTML = '';
    if (!selectedYear) {
      yearInfo.appendChild(document.createTextNode('Official UPSC papers only — never invented.'));
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
  for (const p of ['GS1', 'CSAT']) grid.appendChild(h('div', { class: 'coverage-cell coverage-head', text: p === 'GS1' ? 'GS Paper I' : 'CSAT' }));
  for (const y of coverage.years) {
    grid.appendChild(h('div', { class: 'coverage-cell coverage-year', text: String(y.year) }));
    for (const p of ['GS1', 'CSAT']) {
      const info = y.papers[p];
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

  mount(
    view,
    h('div', { class: 'row-between', style: { marginBottom: '1rem' } },
      h('div', {},
        h('h1', { text: 'Full Paper Simulation' }),
        h('div', { class: 'muted', text: 'Sunday-only · GS Paper I and CSAT as separate papers with a strict server-side timer.' }),
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
          h('div', {}, h('span', { text: 'GS Paper I' }), h('strong', { text: '100 Q · 120 min · 200 marks' })),
          h('div', {}, h('span', { text: 'CSAT' }), h('strong', { text: '80 Q · 120 min · 200 marks' })),
          h('div', {}, h('span', { text: 'Negative marking' }), h('strong', { text: '1/3 of marks per wrong answer' })),
          h('div', {}, h('span', { text: 'CSAT qualifying' }), h('strong', { text: '33% (66 marks)' })),
        ),
        h('div', { class: 'notice warn', text: 'Choose an exact year paper or a mixed paper. Mixed papers draw randomised questions from the imported PYQ pool using a server seed.' }),
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
        h('label', { class: 'field' },
          h('span', { text: 'Exact PYQ paper (year)' }),
          yearSelect,
          yearInfo,
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
        h('h2', { text: '20-year PYQ coverage' }),
        h('a', { href: '#/pyq' }, 'Open PYQ Explorer →'),
      ),
      h('div', { class: 'notice', style: { marginBottom: '.8rem' }, text: coverage.note }),
      grid,
      h('div', { class: 'muted', style: { marginTop: '.6rem', fontSize: '.82rem' }, text: `Imported: ${coverage.totals.found} / ${coverage.totals.expected} questions (${coverage.totals.percent}%). Missing years are marked DATA_MISSING and never faked.` }),
    ),
  );
  updateButtons();
  void errorBox;
  void fmtDuration;
}
