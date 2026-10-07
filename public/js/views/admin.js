import { get, post, patch, del, setAdminToken, getAdminToken } from '../api.js';
import { h, mount, loadingBox, fmtDate, toast, confirmDialog, badgeForState, badgeForSourceType } from '../dom.js';

const METADATA_FIELDS = [
  ['year', 'Year'], ['paper', 'Paper'], ['question_number', 'Question #'],
  ['subject', 'Subject'], ['topic', 'Topic'], ['subtopic', 'Subtopic'],
  ['difficulty', 'Difficulty'], ['question_type', 'Question type'],
  ['correct_answer', 'Correct answer (A–D)'], ['source', 'Source reference'],
  ['concept', 'Concept'], ['explanation', 'Explanation'],
];

export default async function admin(view) {
  mount(view, loadingBox());
  if (!getAdminToken()) {
    return renderTokenGate(view);
  }
  try {
    await get('/api/admin/stats');
  } catch (err) {
    if (err.status === 401) return renderTokenGate(view, 'Wrong token.');
    renderTokenGate(view, err.message);
    return;
  }
  renderShell(view);
}

function renderTokenGate(view, message = '') {
  const input = h('input', { type: 'password', placeholder: 'admin token (x-admin-token)' });
  mount(
    view,
    h('div', { class: 'view-narrow', style: { margin: '0 auto' } },
      h('div', { class: 'card' },
        h('h1', { text: 'Admin access' }),
        h('p', { class: 'muted', text: 'Data validation, imports and audit log are protected by an admin token (APP.ADMIN_TOKEN / admin token env).' }),
        message ? h('div', { class: 'notice warn', text: message }) : null,
        h('label', { class: 'field' }, h('span', { text: 'Token' }), input),
        h('button', {
          class: 'btn btn-primary',
          onClick: () => {
            setAdminToken(input.value.trim());
            renderShell(view);
          },
        }, 'Unlock'),
      ),
    ),
  );
}

async function renderShell(view) {
  mount(view, loadingBox());
  let stats;
  try {
    stats = await get('/api/admin/stats');
  } catch (err) {
    if (err.status === 401) return renderTokenGate(view, 'Token rejected.');
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Cannot load admin' }), h('div', { text: err.message })));
    return;
  }

  const tabs = h('div', { class: 'pill-group', style: { marginBottom: '1rem' } });
  const body = h('div', {});
  let current = 'overview';
  const panels = {
    overview: () => renderOverview(stats, body),
    import: () => renderImport(body),
    review: () => renderReview(body),
    audit: () => renderAudit(body),
  };
  const label = { overview: 'Overview', import: 'Import', review: 'Review queue', audit: 'Audit log' };
  Object.entries(panels).forEach(([id, fn]) => {
    const btn = h('button', {
      class: `pill ${current === id ? 'active' : ''}`,
      onClick: (e) => {
        current = id;
        tabs.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
        e.target.classList.add('active');
        fn();
      },
    }, label[id]);
    tabs.appendChild(btn);
  });

  mount(
    view,
    h('div', { class: 'row-between', style: { marginBottom: '1rem' } },
      h('div', {},
        h('h1', { text: 'Admin · data validation' }),
        h('div', { class: 'muted', text: 'Import official papers, verify questions, track coverage. Verified PYQ text is locked against casual edits.' }),
      ),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn', href: '#/' }, 'Back to app'),
        h('button', { class: 'btn btn-ghost', onClick: () => { setAdminToken(''); location.reload(); } }, 'Lock'),
      ),
    ),
    tabs,
    body,
  );
  renderOverview(stats, body);
}

/* ---------------------------------------------------------------- overview */
function renderOverview(stats, body) {
  const byState = {};
  for (const row of stats.byState) {
    const k = `${row.validation_state}`;
    byState[k] = (byState[k] || 0) + row.n;
  }
  const stateTiles = Object.entries(byState).map(([state, n]) =>
    h('div', { class: 'tile' },
      h('div', { class: 'tile-label', text: state }),
      h('div', { class: 'tile-value', text: String(n) }),
      h('div', { class: 'tile-sub', text: 'questions' }),
    ),
  );

  const batchRows = (stats.batches || []).map((b) =>
    h('tr', {},
      h('td', {}, h('strong', { text: b.filename }), h('div', { class: 'muted', style: { fontSize: '.74rem' }, text: fmtDate(b.created_at) })),
      h('td', { text: b.format }),
      h('td', {}, h('span', { class: 'badge badge-neutral', text: b.state })),
      h('td', { class: 'num', text: `${b.inserted}/${b.total}` }),
      h('td', { class: 'num', text: String(b.duplicates || 0) }),
      h('td', { class: 'num', text: String(b.rejected || 0) }),
      h('td', { class: 'num', text: String(b.needs_review || 0) }),
    ),
  );

  mount(
    body,
    h('div', { class: 'grid grid-4' },
      ...stateTiles,
      h('div', { class: `tile ${stats.unkeyed ? 'bad' : 'good'}` },
        h('div', { class: 'tile-label', text: 'Unkeyed' }),
        h('div', { class: 'tile-value', text: String(stats.unkeyed) }),
        h('div', { class: 'tile-sub', text: 'missing correct answer' }),
      ),
      h('div', { class: `tile ${stats.duplicateGroups.length ? 'warn' : 'good'}` },
        h('div', { class: 'tile-label', text: 'Duplicate groups' }),
        h('div', { class: 'tile-value', text: String(stats.duplicateGroups.length) }),
        h('div', { class: 'tile-sub', text: 'same content hash' }),
      ),
    ),
    h('section', { class: 'card section-gap' },
      h('div', { class: 'card-title' },
        h('h2', { text: 'Import batches' }),
        h('div', { class: 'btn-row' },
          h('button', {
            class: 'btn btn-sm',
            onClick: async () => {
              try {
                await post('/api/admin/coverage/refresh', {});
                toast('Coverage refreshed.', 'success');
                renderShellRefresh();
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          }, 'Refresh coverage'),
        ),
      ),
      batchRows.length
        ? h('div', { class: 'table-wrap' },
            h('table', { class: 'table' },
              h('thead', {}, h('tr', {},
                h('th', { text: 'File' }), h('th', { text: 'Format' }), h('th', { text: 'State' }),
                h('th', { class: 'num', text: 'Inserted' }), h('th', { class: 'num', text: 'Duplicates' }),
                h('th', { class: 'num', text: 'Rejected' }), h('th', { class: 'num', text: 'Review' }),
              )),
              h('tbody', {}, ...batchRows),
            ),
          )
        : h('div', { class: 'empty' }, h('strong', { text: 'No imports yet' }), h('div', { text: 'Use the Import tab to add official paper data.' })),
    ),
  );

  function renderShellRefresh() {
    get('/api/admin/stats').then((s) => renderOverview(s, body)).catch((e) => toast(e.message, 'error'));
  }
}

/* ---------------------------------------------------------------- import */
function renderImport(body) {
  const formatSel = h('select', {},
    h('option', { value: 'json' }, 'JSON (canonical questions + optional answer key)'),
    h('option', { value: 'text' }, 'Raw text (extracted from PDF/OCR)'),
    h('option', { value: 'answerkey' }, 'Answer key text (question: answer pairs)'),
  );
  const fileInput = h('input', { type: 'file', accept: '.json,.txt,.csv,.md' });
  const ta = h('textarea', { placeholder: '{\n  "year": 2024,\n  "paper": "GS1",\n  "questions": [ { "question_number": 1, "question_text": "…", "options": ["…","…","…","…"], "correct_answer": "B" } ]\n}' });
  const yearInput = h('input', { type: 'number', placeholder: 'year (text imports)' });
  const paperSel = h('select', {}, h('option', { value: 'GS1' }, 'GS1'), h('option', { value: 'CSAT' }, 'CSAT'));
  const filenameInput = h('input', { type: 'text', placeholder: 'filename (optional)' });
  const sourceSel = h('select', {},
    h('option', { value: 'CUSTOM' }, 'Custom (not official)'),
    h('option', { value: 'OFFICIAL_PYQ' }, 'Official UPSC PYQ (verified paper)'),
    h('option', { value: 'AI_GENERATED' }, 'AI generated (always labelled)'),
  );
  const resultSlot = h('div', {});

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (f) ta.value = await f.text();
  });

  const doImport = async () => {
    const content = ta.value.trim();
    if (!content) {
      toast('Paste or choose a file first.', 'error');
      return;
    }
    resultSlot.innerHTML = '';
    resultSlot.appendChild(loadingBox('Importing…'));
    try {
      const res = await post('/api/admin/import', {
        format: formatSel.value,
        content,
        meta: {
          filename: filenameInput.value.trim() || fileInput.files?.[0]?.name || 'paste',
          year: yearInput.value ? Number(yearInput.value) : null,
          paper: paperSel.value,
          sourceType: sourceSel.value,
        },
      });
      const s = res.summary || {};
      const applied = res.applied;
      mount(
        resultSlot,
        h('div', { class: 'notice good' },
          h('div', { text: `Batch ${res.batchId || ''}: total ${s.total ?? '—'} · inserted ${s.inserted ?? 0} · duplicates ${s.duplicates ?? 0} · rejected ${s.rejected ?? 0} · needs review ${s.review ?? 0}` }),
          applied ? h('div', { text: `Answer key applied: ${applied.applied || 0}, missing ${applied.missing?.length ?? 0}, conflicts ${applied.conflicts?.length ?? 0}` }) : null,
        ),
        s.errors?.length ? h('div', { class: 'notice warn', text: `Errors: ${s.errors.slice(0, 8).join(' | ')}` }) : null,
        s.duplicatesList?.length ? h('div', { class: 'notice', text: `Duplicates: ${s.duplicatesList.slice(0, 8).join(' | ')}` }) : null,
      );
      toast('Import finished.', 'success');
    } catch (err) {
      mount(resultSlot, h('div', { class: 'notice warn', text: err.message }));
    }
  };

  mount(
    body,
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, h('h2', { text: 'Import data' })),
        h('label', { class: 'field' }, h('span', { text: 'Format' }), formatSel),
        h('label', { class: 'field' }, h('span', { text: 'Load file' }), fileInput),
        h('label', { class: 'field' }, h('span', { text: 'Or paste content' }), ta),
        h('div', { class: 'grid grid-2' },
          h('label', { class: 'field' }, h('span', { text: 'Year' }), yearInput),
          h('label', { class: 'field' }, h('span', { text: 'Paper' }), paperSel),
        ),
        h('div', { class: 'grid grid-2' },
          h('label', { class: 'field' }, h('span', { text: 'Filename' }), filenameInput),
          h('label', { class: 'field' }, h('span', { text: 'Source type' }), sourceSel),
        ),
        h('button', { class: 'btn btn-primary', onClick: doImport }, 'Run import'),
        resultSlot,
      ),
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, h('h2', { text: 'Format guide' })),
        h('div', { class: 'notice' },
          h('div', { html: '<b>JSON</b> — <code>{ year, paper, source_type, questions: [{ question_number, question_text, options: ["..",".."] or [{key,text}], correct_answer, subject, topic, difficulty, question_type, explanation, passage, source }] }</code>' }),
        ),
        h('div', { class: 'notice', style: { marginTop: '.6rem' }, text: 'Text — pasted OCR of a paper; always imports as REVIEW_REQUIRED until verified.' }),
        h('div', { class: 'notice', style: { marginTop: '.6rem' }, text: 'Answer key — lines like "1. B  2. D" or "1:B, 2:D"; updates existing questions by year+paper+number.' }),
        h('div', { class: 'notice warn', style: { marginTop: '.6rem' }, text: 'Official UPSC PDFs are scans without a text layer — OCR them externally, then import here. Never hand-write "official" answers you cannot verify.' }),
      ),
    ),
  );
}

/* ---------------------------------------------------------------- review */
async function renderReview(body) {
  mount(body, loadingBox());
  const stateSel = h('select', {},
    h('option', { value: '' }, 'All states'),
    h('option', { value: 'REVIEW_REQUIRED' }, 'Needs review'),
    h('option', { value: 'VERIFIED' }, 'Verified'),
    h('option', { value: 'PARSED' }, 'Parsed'),
    h('option', { value: 'unkeyed' }, 'Unkeyed'),
    h('option', { value: 'duplicates' }, 'Duplicate groups'),
  );
  const search = h('input', { type: 'search', placeholder: 'Search text / subject / topic / id' });
  const list = h('div', {});
  const pagerInfo = h('div', { class: 'muted', style: { fontSize: '.82rem' } });
  let page = 1;
  const pageSize = 25;

  async function load() {
    mount(list, loadingBox());
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (['unkeyed', 'duplicates'].includes(stateSel.value)) q.set('state', stateSel.value);
      else if (stateSel.value) q.set('validation_state', stateSel.value);
      if (search.value.trim()) q.set('q', search.value.trim());
      const res = await get(`/api/admin/questions?${q}`);
      pagerInfo.textContent = `${res.total} questions · page ${res.page} of ${Math.max(1, Math.ceil(res.total / res.pageSize))}`;
      mount(list, ...(res.items.length ? res.items.map(questionCard) : [
        h('div', { class: 'empty' }, h('strong', { text: 'Nothing here' }), h('div', { text: 'No questions match these filters.' })),
      ]));
    } catch (err) {
      mount(list, h('div', { class: 'notice warn', text: err.message }));
    }
  }

  function questionCard(item) {
    let options = [];
    try {
      options = JSON.parse(item.options_json || '[]');
    } catch { /* ignore */ }
    const expanded = h('div', { class: 'panel-body', style: { display: 'none' } });
    const card = h('div', { class: 'admin-q' },
      h('div', { class: 'qhead' },
        badgeForSourceType(item.source_type),
        badgeForState(item.validation_state),
        h('span', { text: `${item.year} · ${item.paper} · Q${item.question_number}` }),
        h('span', { text: `${item.subject || '—'} · ${item.topic || '—'} · ${item.difficulty || '—'}` }),
        h('span', { class: item.correct_answer ? 'badge badge-good' : 'badge badge-missing', text: item.correct_answer ? `answer ${item.correct_answer}` : 'NO KEY' }),
        item.is_duplicate ? h('span', { class: 'badge badge-custom', text: 'duplicate' }) : null,
        h('span', { class: 'muted', text: item.id }),
      ),
      h('div', { class: 'qtext', text: item.question_text }),
      h('div', { class: 'opts' }, ...options.map((o) => h('div', { html: `<b>${o.key}</b>. ${escapeHtml(o.text ?? '')}` }))),
      h('div', { class: 'btn-row', style: { marginTop: '.5rem' } },
        h('button', { class: 'btn btn-sm', onClick: () => { expanded.style.display = expanded.style.display === 'none' ? 'block' : 'none'; } }, 'Edit'),
        h('button', { class: 'btn btn-sm btn-accent', disabled: !item.correct_answer || item.validation_state === 'VERIFIED', onClick: () => act(() => post(`/api/admin/questions/${item.id}/verify`, {})) }, 'Verify'),
        h('button', { class: 'btn btn-sm btn-danger', onClick: () => act(async () => {
          if (await confirmDialog({ title: 'Mark duplicate?', message: 'This hides the question from all tests.', confirmText: 'Mark duplicate', danger: true })) return post(`/api/admin/questions/${item.id}/duplicate`, {});
        }) }, 'Mark duplicate'),
        h('button', { class: 'btn btn-sm btn-danger', onClick: () => act(async () => {
          if (await confirmDialog({ title: 'Delete question?', message: 'Permanent. Statistics for it are removed too.', confirmText: 'Delete', danger: true })) return del(`/api/admin/questions/${item.id}`);
        }) }, 'Delete'),
      ),
      expanded,
    );

    function act(fn) {
      Promise.resolve()
        .then(fn)
        .then((r) => {
          if (r) toast('Done.', 'success');
          load();
        })
        .catch((e) => toast(e.message, 'error'));
    }

    // edit form
    const inputs = {};
    for (const [field, label] of METADATA_FIELDS) {
      const input = h('input', { type: 'text' });
      input.value = item[field] ?? '';
      inputs[field] = input;
      expanded.appendChild(h('label', { class: 'field' }, h('span', { text: label }), input));
    }
    const textInput = h('textarea');
    textInput.value = item.question_text || '';
    const passageInput = h('textarea', { style: { minHeight: '80px' } });
    passageInput.value = item.passage || '';
    const allowText = h('input', { type: 'checkbox' });
    expanded.appendChild(h('div', { class: 'notice', text: 'Verified official text is locked. Tick "allow text edit" only after independent verification.' }));
    expanded.appendChild(h('label', { class: 'field' }, h('span', { text: 'Question text' }), textInput));
    expanded.appendChild(h('label', { class: 'field' }, h('span', { text: 'Passage' }), passageInput));
    expanded.appendChild(h('label', { class: 'check' }, allowText, h('span', { text: 'allow text edit (unlocks verified official text)' })));
    expanded.appendChild(h('button', {
      class: 'btn btn-primary btn-sm',
      onClick: () => {
        const patchBody = {};
        for (const [field] of METADATA_FIELDS) {
          let v = inputs[field].value.trim();
          if (field === 'year' || field === 'question_number') v = v ? Number(v) : null;
          if (field === 'correct_answer') v = v.toUpperCase();
          if (v !== '' || v === null) patchBody[field] = v === '' ? null : v;
        }
        patchBody.question_text = textInput.value;
        patchBody.passage = passageInput.value;
        patchBody.allowTextEdit = allowText.checked;
        patch(`/api/admin/questions/${item.id}`, patchBody)
          .then(() => { toast('Saved.', 'success'); load(); })
          .catch((e) => toast(e.message, 'error'));
      },
    }, 'Save changes'));

    return card;
  }

  const pager = h('div', { class: 'btn-row', style: { marginTop: '.8rem' } },
    h('button', { class: 'btn btn-sm', onClick: () => { page = Math.max(1, page - 1); load(); } }, '← Prev'),
    h('button', { class: 'btn btn-sm', onClick: () => { page += 1; load(); } }, 'Next →'),
    pagerInfo,
  );

  stateSel.addEventListener('change', () => { page = 1; load(); });
  search.addEventListener('input', () => { page = 1; load(); });

  mount(
    body,
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, h('h2', { text: 'Review queue' })),
      h('div', { class: 'row', style: { marginBottom: '.8rem' } }, stateSel, search),
      list,
      pager,
    ),
  );
  load();
}

/* ---------------------------------------------------------------- audit */
async function renderAudit(body) {
  mount(body, loadingBox());
  try {
    const res = await get('/api/admin/audit?limit=100');
    const rows = res.entries.map((e) =>
      h('tr', {},
        h('td', { class: 'mono', style: { fontSize: '.78rem' }, text: fmtDate(e.created_at) }),
        h('td', { text: e.entity_type || '' }),
        h('td', { class: 'mono', style: { fontSize: '.78rem' }, text: e.entity_id || '' }),
        h('td', {}, h('span', { class: 'badge badge-neutral', text: e.action || '' })),
        h('td', { class: 'muted', style: { fontSize: '.78rem' }, text: e.actor || 'system' }),
      ),
    );
    mount(
      body,
      h('div', { class: 'card' },
        h('div', { class: 'card-title' }, h('h2', { text: 'Audit log' }), h('span', { class: 'muted', text: `${res.entries.length} entries` })),
        rows.length
          ? h('div', { class: 'table-wrap' },
              h('table', { class: 'table' },
                h('thead', {}, h('tr', {}, h('th', { text: 'When' }), h('th', { text: 'Entity' }), h('th', { text: 'Id' }), h('th', { text: 'Action' }), h('th', { text: 'Actor' }))),
                h('tbody', {}, ...rows),
              ),
            )
          : h('div', { class: 'empty' }, h('strong', { text: 'No entries' }), h('div', { text: 'Imports and edits are recorded here.' })),
      ),
    );
  } catch (err) {
    mount(body, h('div', { class: 'notice warn', text: err.message }));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
