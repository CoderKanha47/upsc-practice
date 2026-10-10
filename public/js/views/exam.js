import { get, post } from '../api.js';
import { h, mount, fmtClock, fmtDuration, toast, confirmDialog, badgeForSourceType } from '../dom.js';
import { navigate } from '../router.js';
import { paperLabel } from '../exam-state.js';

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Exam runner.
 * - The server owns the clock: remaining time comes from the server on every
 *   sync; the browser only interpolates locally between syncs. A refresh never
 *   resets or extends time.
 * - Correct answers are never requested while the session is open.
 * - Sectional papers (SSC Tier-I style): sections auto-lock at their server
 *   deadline; closed sections reject answers (409) and cannot be revisited.
 */
export default async function exam(view, params) {
  const sessionId = params.id;
  let boot;
  try {
    boot = await get(`/api/sessions/${encodeURIComponent(sessionId)}`);
  } catch (err) {
    mount(view, h('div', { class: 'empty' }, h('strong', { text: 'Cannot open test' }), h('div', { text: err.message }), h('a', { class: 'btn', style: { marginTop: '1rem' }, href: '#/' }, 'Dashboard')));
    return;
  }

  if (boot.session.status !== 'IN_PROGRESS' || !boot.questions.length) {
    navigate(`/result/${sessionId}`);
    return () => {};
  }

  const session = boot.session;
  let questions = boot.questions;
  const sectional = Boolean(session.sectional && Array.isArray(session.sections) && session.sections.length);
  let sections = sectional ? session.sections : null;
  const sectionOf = session.config?.sectionOf || {};
  const answers = new Map(); // qid -> {answer, marked, visited, timeSpentSeconds}
  for (const a of boot.answers || []) {
    answers.set(a.question_id, {
      answer: a.answer,
      marked: Boolean(a.marked),
      visited: Boolean(a.visited),
      timeSpentSeconds: Number(a.time_spent_seconds || 0),
    });
  }
  const ensure = (qid) => {
    if (!answers.has(qid)) answers.set(qid, { answer: null, marked: false, visited: false, timeSpentSeconds: 0 });
    return answers.get(qid);
  };

  let index = 0;
  const firstUnanswered = questions.findIndex((q) => !ensure(q.id).visited);
  if (firstUnanswered >= 0) index = firstUnanswered;
  else if (ensure(questions[0].id).answer) {
    const firstEmpty = questions.findIndex((q) => !ensure(q.id).answer);
    if (firstEmpty >= 0) index = firstEmpty;
  }
  if (sectional && !isEditable(questions[index].id)) index = firstEditableIndex();

  /* ------------------------------------------------ server-synced clock */
  let remainingSeconds = Number(boot.remainingSeconds || 0);
  let syncedAt = Date.now();
  let serverNowMs = boot.serverNow ? Date.parse(boot.serverNow) : Date.now();
  const syncIntervalMs = Math.max(5000, Number(boot.syncIntervalMs || 15000));
  const localRemaining = () => Math.max(0, remainingSeconds - Math.floor((Date.now() - syncedAt) / 1000));
  const serverNow = () => serverNowMs + (Date.now() - syncedAt);

  /* ------------------------------------------------ sectional clock (client
     mirror of the server's cumulative deadlines; the server is authoritative
     and rejects any save to a closed section). */
  function sectionStateFor(questionId) {
    if (!sectional) return null;
    const secId = sectionOf[questionId];
    if (!secId) return null;
    const sec = sections.find((s) => s.id === secId);
    if (!sec) return null;
    const at = serverNow();
    const state = at >= sec.endAt ? 'closed' : at >= sec.startAt ? 'open' : 'upcoming';
    return { ...sec, state, remainingSeconds: state === 'open' ? Math.max(0, Math.round((sec.endAt - at) / 1000)) : 0 };
  }
  const isEditable = (questionId) => {
    const st = sectionStateFor(questionId);
    return !st || st.state === 'open';
  };
  const firstEditableIndex = () => {
    const i = questions.findIndex((q) => isEditable(q.id));
    return i >= 0 ? i : 0;
  };

  /* ------------------------------------------------ save queue */
  const pending = new Map();
  let flushing = false;
  let flushTimer = null;
  let closed = false;

  const buildPayload = (qid) => {
    const st = ensure(qid);
    return {
      questionId: qid,
      answer: st.answer,
      timeSpentSeconds: st.timeSpentSeconds,
      marked: st.marked,
      visited: st.visited,
    };
  };

  const handleSessionError = (err) => {
    if (err.code === 'SESSION_EXPIRED' || err.code === 'SESSION_CLOSED' || err.status === 410) {
      toast('Time is over — submitting…', 'error');
      stopAll();
      navigate(`/result/${sessionId}`);
      return true;
    }
    if (err.code === 'SECTION_LOCKED' || err.code === 'SECTION_NOT_OPEN') {
      toast(err.message, 'error');
      const target = firstEditableIndex();
      if (target !== index && isEditable(questions[target]?.id)) {
        index = target;
        renderAll();
      }
      return true;
    }
    return false;
  };

  async function flush({ silent = false } = {}) {
    if (flushing || closed) return;
    flushing = true;
    try {
      while (pending.size) {
        const [qid, payload] = pending.entries().next().value;
        pending.delete(qid);
        try {
          await post(`/api/sessions/${encodeURIComponent(sessionId)}/answer`, payload);
        } catch (err) {
          if (handleSessionError(err)) return;
          if (!silent) toast('Could not save answer — retrying.', 'error');
          pending.set(qid, payload);
          break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  function queueSave(qid, { immediate = false } = {}) {
    pending.set(qid, buildPayload(qid));
    clearTimeout(flushTimer);
    if (immediate) flush();
    else flushTimer = setTimeout(() => flush(), 500);
  }

  /* ------------------------------------------------ question time tracking */
  let questionEnteredAt = Date.now();
  function bankTime() {
    const q = questions[index];
    if (!q) return;
    const st = ensure(q.id);
    st.timeSpentSeconds += Math.max(0, Math.round((Date.now() - questionEnteredAt) / 1000));
    questionEnteredAt = Date.now();
  }

  /* ------------------------------------------------ render */
  const examTop = h('div', { class: 'exam-top' });
  const questionBox = h('div', { class: 'exam-question' });
  const paletteBox = h('div', { class: 'palette-card' });
  const resumeNote = h('div', {});

  const root = h(
    'div',
    { class: 'exam-shell' },
    resumeNote,
    examTop,
    h('div', { class: 'exam-body' }, h('div', { class: 'stack' }, questionBox), paletteBox),
  );

  const counts = () => {
    let answered = 0;
    let marked = 0;
    let visited = 0;
    for (const q of questions) {
      const st = ensure(q.id);
      if (st.answer) answered += 1;
      if (st.marked) marked += 1;
      if (st.visited) visited += 1;
    }
    return { answered, marked, visited, notAnswered: visited - answered, notVisited: questions.length - visited };
  };

  const timerNode = h('div', { class: 'exam-timer mono', text: fmtClock(localRemaining()) });
  const sectionTimerNode = sectional ? h('div', { class: 'exam-timer exam-timer-section mono' }) : null;
  const counterNode = h('div', { class: 'exam-counters' });

  function renderTop() {
    const c = counts();
    const secs = localRemaining();
    timerNode.textContent = fmtClock(secs);
    timerNode.className = `exam-timer mono ${secs <= 60 ? 'critical' : secs <= 600 ? 'warning' : ''}`;
    if (sectionTimerNode) {
      const cur = sectionStateFor(questions[index]?.id);
      if (cur && cur.state === 'open') {
        const s = cur.remainingSeconds;
        sectionTimerNode.textContent = `${cur.title}: ${fmtClock(s)}`;
        sectionTimerNode.className = `exam-timer exam-timer-section mono ${s <= 60 ? 'critical' : s <= 180 ? 'warning' : ''}`;
        sectionTimerNode.style.display = '';
      } else {
        sectionTimerNode.textContent = cur ? `${cur.title}: locked` : '';
        sectionTimerNode.style.display = cur ? '' : 'none';
      }
    }
    counterNode.innerHTML = '';
    counterNode.append(
      h('span', {}, h('b', { text: String(c.answered) }), ' Answered'),
      h('span', {}, h('b', { text: String(c.notAnswered) }), ' Not answered'),
      h('span', {}, h('b', { text: String(c.marked) }), ' Marked'),
      h('span', {}, h('b', { text: String(c.notVisited) }), ' Not visited'),
    );
    examTop.innerHTML = '';
    examTop.append(
      h('div', { class: 'exam-title' }, session.title, h('small', { text: `${session.kindLabel} · ${paperLabel(session.paper)} · ${questions.length} questions${sectional ? ' · sectional (auto-lock)' : ''}` })),
      counterNode,
      sectionTimerNode,
      timerNode,
    );
  }

  function stateClass(qid) {
    const st = ensure(qid);
    if (st.marked) return st.answer ? 'state-marked-answered' : 'state-marked';
    if (st.answer) return 'state-answered';
    if (st.visited) return 'state-visited';
    return 'state-notvisited';
  }
  function stateGlyph(qid) {
    const st = ensure(qid);
    if (st.marked) return 'M';
    if (st.answer) return '✓';
    if (st.visited) return '●';
    return '';
  }

  function sectionStrip() {
    if (!sectional) return null;
    return h(
      'div',
      { class: 'section-strip' },
      ...sections.map((s) => {
        const live = sectionStateFor(questions.find((q) => sectionOf[q.id] === s.id)?.id) || s;
        const cls = live.state === 'open' ? 'sec-open' : live.state === 'closed' ? 'sec-closed' : 'sec-upcoming';
        const timeText = live.state === 'open' ? fmtClock(live.remainingSeconds) : live.state === 'closed' ? 'LOCKED' : 'WAITING';
        return h(
          'div',
          { class: `section-chip ${cls}` },
          h('span', { class: 'section-chip-title', text: s.title || s.section || s.id }),
          h('span', { class: 'section-chip-time mono', text: timeText }),
        );
      }),
    );
  }

  function renderPalette() {
    paletteBox.innerHTML = '';
    const c = counts();
    const palette = h('div', { class: 'palette', role: 'listbox', 'aria-label': 'Question palette' });
    questions.forEach((q, i) => {
      const editable = isEditable(q.id);
      const btn = h(
        'button',
        {
          class: `p-btn ${stateClass(q.id)} ${i === index ? 'current' : ''} ${editable ? '' : 'state-locked'}`,
          type: 'button',
          disabled: !editable,
          'aria-label': `Question ${i + 1}${editable ? '' : ' (section locked)'}`,
          'aria-current': i === index ? 'true' : 'false',
          onClick: () => go(i),
        },
        h('span', { text: String(i + 1) }),
        h('span', { class: 'glyph', text: stateGlyph(q.id) }),
      );
      palette.appendChild(btn);
    });
    paletteBox.append(
      sectionStrip(),
      h('div', { class: 'palette-head', text: 'Question palette' }),
      palette,
      h('div', { class: 'palette-stats' },
        h('span', { text: `Answered ${c.answered}` }),
        h('span', { text: `Marked ${c.marked}` }),
        h('span', { text: `Visited ${c.visited}` }),
      ),
      h('div', { class: 'palette-legend' },
        h('div', { class: 'legend-item' }, h('span', { class: 'legend-swatch answered' }), 'Answered ✓'),
        h('div', { class: 'legend-item' }, h('span', { class: 'legend-swatch notanswered' }), 'Not answered ●'),
        h('div', { class: 'legend-item' }, h('span', { class: 'legend-swatch marked' }), 'Marked M'),
        h('div', { class: 'legend-item' }, h('span', { class: 'legend-swatch notvisited' }), 'Not visited'),
        sectional ? h('div', { class: 'legend-item' }, h('span', { class: 'legend-swatch locked' }), 'Section locked') : null,
      ),
      h('div', { class: 'kbd-help' },
        h('div', { html: '<kbd>A</kbd>–<kbd>D</kbd> choose · <kbd>N</kbd>/<kbd>P</kbd> next/prev · <kbd>M</kbd> mark · <kbd>1</kbd>–<kbd>4</kbd> choose' }),
      ),
    );
  }

  function renderQuestion() {
    const q = questions[index];
    const st = ensure(q.id);
    const editable = isEditable(q.id);
    st.visited = true;

    const secLive = sectionStateFor(q.id);
    const head = h('div', { class: 'exam-qhead' },
      h('div', { class: 'qno', text: `Question ${index + 1} / ${questions.length}` }),
      h('div', { class: 'qmeta' },
        badgeForSourceType(q.source_type),
        secLive ? h('span', { class: `badge ${secLive.state === 'open' ? 'badge-good' : 'badge-neutral'}`, text: secLive.title || secLive.section || '' }) : null,
        !editable ? h('span', { class: 'badge badge-neutral', text: secLive?.state === 'closed' ? 'Section locked' : 'Section not open' }) : null,
        st.marked ? h('span', { class: 'badge badge-purple', text: 'Marked' }) : null,
      ),
    );

    const options = h('div', { class: 'options', role: 'radiogroup', 'aria-label': 'Options' });
    q.options.forEach((o) => {
      const key = String(o.key).toUpperCase();
      const selected = st.answer === key;
      const input = h('input', { type: 'radio', name: `q_${q.id}`, value: key });
      input.checked = selected;
      if (!editable) input.disabled = true;
      const row = h(
        'label',
        { class: `option ${selected ? 'selected' : ''} ${editable ? '' : 'disabled'}` },
        input,
        h('span', { class: 'opt-key', text: key }),
        h('span', { class: 'opt-text', text: o.text ?? o.content ?? '' }),
      );
      if (editable) input.addEventListener('change', () => selectOption(key));
      options.appendChild(row);
    });

    const actions = h('div', { class: 'exam-actions' },
      h('button', { class: 'btn', disabled: index === 0, onClick: () => go(index - 1) }, '← Previous'),
      h('button', { class: 'btn', disabled: !editable, onClick: () => clearResponse() }, 'Clear response'),
      h('button', { class: `btn ${st.marked ? 'btn-primary' : ''}`, disabled: !editable, onClick: () => toggleMark() }, st.marked ? 'Unmark (M)' : 'Mark for review (M)'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', disabled: index === questions.length - 1, onClick: () => go(index + 1) }, 'Next →'),
      h('button', { class: 'btn btn-danger', onClick: confirmSubmit }, 'Submit test'),
    );

    questionBox.innerHTML = '';
    questionBox.append(
      head,
      h('div', { class: 'exam-qbody' },
        q.passage ? h('div', { class: 'passage' }, q.passage) : null,
        h('div', { class: 'qtext', text: q.question_text }),
        options,
        !editable && secLive?.state === 'closed'
          ? h('div', { class: 'notice warn', text: `Section "${secLive.title}" closed at its deadline — answers can no longer be changed for its questions.` })
          : null,
      ),
      actions,
    );
  }

  function renderAll() {
    renderTop();
    renderQuestion();
    renderPalette();
  }

  /* ------------------------------------------------ interactions */
  function go(nextIndex) {
    if (nextIndex < 0 || nextIndex >= questions.length || nextIndex === index) return;
    if (sectional && !isEditable(questions[nextIndex].id)) {
      const st = sectionStateFor(questions[nextIndex].id);
      toast(st?.state === 'closed'
        ? 'That section is closed — it cannot be revisited.'
        : 'That section has not started yet.', 'error');
      return;
    }
    bankTime();
    index = nextIndex;
    renderAll();
    const st = ensure(questions[index].id);
    queueSave(questions[index].id, { immediate: !st.answer });
  }

  function selectOption(key) {
    const q = questions[index];
    if (sectional && !isEditable(q.id)) return;
    const st = ensure(q.id);
    st.answer = st.answer === key ? null : key;
    st.visited = true;
    bankTime();
    renderAll();
    queueSave(q.id, { immediate: true });
  }

  function clearResponse() {
    const q = questions[index];
    if (sectional && !isEditable(q.id)) return;
    const st = ensure(q.id);
    st.answer = null;
    renderAll();
    queueSave(q.id, { immediate: true });
  }

  function toggleMark() {
    const q = questions[index];
    if (sectional && !isEditable(q.id)) return;
    const st = ensure(q.id);
    st.marked = !st.marked;
    renderAll();
    queueSave(q.id, { immediate: true });
  }

  async function confirmSubmit() {
    await flush();
    const c = counts();
    const ok = await confirmDialog({
      title: 'Submit the test?',
      message: `${c.answered} answered · ${c.notAnswered} visited but unanswered · ${c.notVisited} not visited · ${c.marked} marked for review. You cannot change answers after submitting.`,
      confirmText: 'Submit test',
      danger: true,
    });
    if (ok) doSubmit();
  }

  async function doSubmit() {
    try {
      await flush();
      await post(`/api/sessions/${encodeURIComponent(sessionId)}/submit`, {});
      stopAll();
      navigate(`/result/${sessionId}`);
    } catch (err) {
      if (err.status === 404 || err.code === 'SESSION_CLOSED') {
        navigate(`/result/${sessionId}`);
        return;
      }
      toast(err.message, 'error');
    }
  }

  async function syncFromServer() {
    if (closed) return;
    try {
      const s = await get(`/api/sessions/${encodeURIComponent(sessionId)}`);
      remainingSeconds = Number(s.remainingSeconds || 0);
      syncedAt = Date.now();
      if (s.serverNow) serverNowMs = Date.parse(s.serverNow);
      if (sectional && Array.isArray(s.session?.sections)) sections = s.session.sections;
      if (s.autoSubmitted) {
        stopAll();
        toast('Time over — your paper was submitted automatically.', 'error');
        navigate(`/result/${sessionId}`);
        return;
      }
      if (s.session.status !== 'IN_PROGRESS') {
        stopAll();
        navigate(`/result/${sessionId}`);
        return;
      }
      // merge server answers (e.g. saves made before a refresh)
      for (const a of s.answers || []) {
        const local = answers.get(a.question_id);
        if (!local) answers.set(a.question_id, { answer: a.answer, marked: a.marked, visited: a.visited, timeSpentSeconds: a.time_spent_seconds });
      }
      if (sectional && !isEditable(questions[index].id)) {
        const target = questions.findIndex((q) => isEditable(q.id));
        if (target >= 0) index = target;
      }
      renderTop();
      renderPalette();
      renderQuestion();
    } catch (err) {
      if (handleSessionError(err)) return;
      // network hiccup: keep counting locally, retry next tick
    }
  }

  /* ------------------------------------------------ timers & events */
  let tickTimer = setInterval(() => {
    const secs = localRemaining();
    if (secs <= 0) {
      timerNode.textContent = '00:00';
      timerNode.classList.add('critical');
      stopAll();
      toast('Time over — submitting your answers…', 'error');
      doSubmit();
      return;
    }
    if (sectional) {
      if (!isEditable(questions[index].id)) {
        const target = questions.findIndex((q) => isEditable(q.id));
        if (target >= 0) {
          bankTime();
          index = target;
          toast('Section closed — moved you to the next open section.', 'error');
          renderAll();
          queueSave(questions[index].id, { immediate: true });
          return;
        }
        // every section has closed: nothing left to attempt
        stopAll();
        toast('All sections are over — submitting…', 'error');
        doSubmit();
        return;
      }
    }
    renderTop();
    if (sectional) renderPalette();
  }, 1000);

  let syncTimer = setInterval(syncFromServer, syncIntervalMs);

  const onKey = (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const key = e.key.toUpperCase();
    const optionIndex = OPTION_KEYS.indexOf(key) >= 0 ? OPTION_KEYS.indexOf(key) : /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
    if (optionIndex >= 0 && optionIndex < questions[index].options.length) {
      e.preventDefault();
      selectOption(String(questions[index].options[optionIndex].key).toUpperCase());
    } else if (key === 'N' || e.key === 'ArrowRight') {
      e.preventDefault();
      go(index + 1);
    } else if (key === 'P' || e.key === 'ArrowLeft') {
      e.preventDefault();
      go(index - 1);
    } else if (key === 'M') {
      e.preventDefault();
      toggleMark();
    }
  };

  const onBeforeUnload = () => {
    bankTime();
    for (const q of questions) {
      const p = buildPayload(q.id);
      if (p.answer || p.marked || p.visited) pending.set(q.id, p);
    }
    // keepalive flush so a closed tab does not lose answers
    for (const [qid, payload] of pending) {
      fetch(`/api/sessions/${encodeURIComponent(sessionId)}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
      pending.delete(qid);
      void qid;
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onBeforeUnload();
  };

  function stopAll() {
    closed = true;
    clearInterval(tickTimer);
    clearInterval(syncTimer);
    clearTimeout(flushTimer);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  document.addEventListener('keydown', onKey);
  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibility);

  // mark the first shown question visited without forcing a save loop
  queueSave(questions[index].id);

  mount(view, root);
  renderAll();

  if (session.config?.timing) {
    const t = session.config.timing;
    resumeNote.appendChild(
      h('div', { class: 'notice', style: { marginBottom: '.8rem' }, text: `Dynamic timing: base ${fmtDuration(t.baseSeconds)} + buffer ${fmtDuration(t.bufferTotalSeconds ?? 0)} = ${t.totalFormatted || t.formatted?.total || fmtDuration(t.totalSeconds)}` }),
    );
  }

  return () => {
    stopAll();
    flush({ silent: true });
  };
}
