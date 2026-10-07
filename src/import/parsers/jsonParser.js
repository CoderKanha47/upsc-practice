/**
 * CANONICAL JSON IMPORT FORMAT
 * ----------------------------
 * The preferred, loss-free way to load official PYQs. One file per paper:
 *
 * {
 *   "year": 2024,
 *   "paper": "GS1",                  // GS1 | CSAT
 *   "source": "UPSC QP-CSP-24-GENERAL-STUDIES-PAPER-I",
 *   "source_type": "OFFICIAL_PYQ",
 *   "questions": [
 *     {
 *       "question_number": 1,
 *       "question_text": "...",
 *       "options": [{ "key": "A", "text": "..." }, ...],
 *       "correct_answer": "B",
 *       "subject": "Indian Polity", "topic": "Constitution", "subtopic": "...",
 *       "difficulty": "medium",
 *       "question_type": "statement_based",
 *       "passage": null,             // shared comprehension passage (optional)
 *       "group_id": null,            // linked-question group (optional)
 *       "group_index": null,
 *       "explanation": "...",
 *       "concept": "..."
 *     }
 *   ],
 *   "answer_key": { "1": "B", "2": "A" }   // optional, can also be a separate file
 * }
 */

export function parseJsonPayload(content) {
  let data;
  try {
    data = typeof content === 'string' ? JSON.parse(content) : content;
  } catch (err) {
    const e = new Error(`Invalid JSON: ${err.message}`);
    e.status = 400;
    throw e;
  }

  const meta = {
    year: data.year ?? null,
    paper: data.paper ?? null,
    source: data.source ?? null,
    source_type: data.source_type ?? 'OFFICIAL_PYQ',
  };

  let rawQuestions = [];
  if (Array.isArray(data)) rawQuestions = data;
  else if (Array.isArray(data.questions)) rawQuestions = data.questions;
  else if (data.question_text) rawQuestions = [data];
  else {
    const e = new Error('JSON must contain a "questions" array.');
    e.status = 400;
    throw e;
  }

  const questions = rawQuestions.map((q, i) => ({
    ...q,
    year: q.year ?? meta.year,
    paper: q.paper ?? meta.paper,
    source: q.source ?? meta.source,
    source_type: q.source_type ?? meta.source_type,
    question_number: q.question_number ?? i + 1,
    _index: i,
  }));

  return { meta, questions, answerKey: data.answer_key || data.answerKey || null };
}

/** Apply a {questionNumber: answer} key onto already-parsed questions. */
export function applyAnswerKey(questions, answerKey) {
  if (!answerKey) return { questions, applied: 0 };
  const map = new Map();
  for (const [k, v] of Object.entries(answerKey)) {
    map.set(String(k).trim(), String(v).trim().toUpperCase().replace(/[().]/g, ''));
  }
  let applied = 0;
  const out = questions.map((q) => {
    const key = map.get(String(q.question_number));
    if (key && /^[A-F]$/.test(key)) {
      applied += 1;
      return { ...q, correct_answer: q.correct_answer || key };
    }
    return q;
  });
  return { questions: out, applied };
}

export default { parseJsonPayload, applyAnswerKey };
