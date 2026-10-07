import CONFIG, { getPaper } from '../../config/exam.config.js';

/**
 * CENTRAL SCORING ENGINE
 * ----------------------
 * All UPSC scoring rules are read from CONFIG.PAPERS — never hardcoded in
 * views, routes or components. If UPSC changes its scheme, only config changes.
 *
 *   correct      → +marks
 *   wrong        → −negative_marks  (configured as negativeFraction × marks)
 *   unattempted  → 0
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function marksFor(question, paperId) {
  const paper = getPaper(paperId);
  const marks = Number(question?.marks ?? paper.marksPerQuestion);
  const negative = Number(question?.negative_marks ?? marks * paper.negativeFraction);
  return { marks, negative };
}

/**
 * @param {string} paperId 'GS1' | 'CSAT'
 * @param {Array} questions rows with id, correct_answer, marks, negative_marks
 * @param {Array} answers rows with question_id, answer, time_spent_seconds
 */
export function scoreSubmission(paperId, questions, answers = [], cfg = CONFIG) {
  const paper = getPaper(paperId);
  const answerMap = new Map(answers.map((a) => [a.question_id, a]));

  let attempted = 0;
  let correct = 0;
  let incorrect = 0;
  let unattempted = 0;
  let marksObtained = 0;
  let negativeMarks = 0;
  let timeUsed = 0;
  let correctMarks = 0;

  const perQuestion = questions.map((q) => {
    const { marks, negative } = marksFor(q, paperId);
    const a = answerMap.get(q.id);
    const answered = a && a.answer ? String(a.answer).trim().toUpperCase() : null;
    timeUsed += Number(a?.time_spent_seconds || 0);

    if (!answered) {
      unattempted += 1;
      return {
        question_id: q.id,
        question_number: q.question_number,
        answered: null,
        correct_answer: null,
        result: 'unattempted',
        marks: 0,
        negative: 0,
        net: 0,
      };
    }

    attempted += 1;
    const key = q.correct_answer ? String(q.correct_answer).trim().toUpperCase() : null;
    if (key && answered === key) {
      correct += 1;
      correctMarks += marks;
      marksObtained += marks;
      return {
        question_id: q.id,
        question_number: q.question_number,
        answered,
        correct_answer: key,
        result: 'correct',
        marks,
        negative: 0,
        net: marks,
      };
    }

    incorrect += 1;
    negativeMarks += negative;
    marksObtained -= negative;
    return {
      question_id: q.id,
      question_number: q.question_number,
      answered,
      correct_answer: key,
      result: 'incorrect',
      marks: 0,
      negative: round2(negative),
      net: round2(-negative),
    };
  });

  marksObtained = round2(marksObtained);
  negativeMarks = round2(negativeMarks);
  const accuracy = attempted > 0 ? round2((correct / attempted) * 100) : 0;
  const attemptedAccuracy = round2((correct / Math.max(1, questions.length)) * 100);

  return {
    paper: paper.id,
    totalMarks: paper.marks,
    maxQuestions: questions.length,
    attempted,
    correct,
    incorrect,
    unattempted,
    marksObtained,
    correctMarks: round2(correctMarks),
    negativeMarks,
    accuracy,
    attemptedAccuracy,
    timeUsedSeconds: round2(timeUsed),
    perQuestion,
  };
}

/** CSAT is a qualifying paper: 33% of 200 marks under the current scheme. */
export function csatQualification(marksObtained, paperId = 'CSAT', cfg = CONFIG) {
  const paper = getPaper(paperId);
  const percentage = paper.qualifyingPercentage ?? 33;
  const threshold = round2((paper.marks * percentage) / 100);
  const obtained = round2(marksObtained);
  return {
    qualifyingPercentage: percentage,
    thresholdMarks: threshold,
    obtained,
    status: obtained >= threshold ? 'QUALIFIED' : 'NOT QUALIFIED',
    note: 'CSAT is qualifying only. A score below 33% disqualifies regardless of GS Paper I performance.',
  };
}

/** Indicative GS cutoff band — never a guarantee. */
export function gsCutoffEstimate(marksObtained, cfg = CONFIG) {
  const [low, high] = cfg.SCORING.GS_CUTOFF_ESTIMATE_RANGE;
  const obtained = round2(marksObtained);
  let position;
  if (obtained >= high) position = 'ABOVE INDICATIVE RANGE';
  else if (obtained >= low) position = 'WITHIN INDICATIVE RANGE';
  else position = 'BELOW INDICATIVE RANGE';
  return {
    range: [low, high],
    obtained,
    position,
    disclaimer: cfg.SCORING.CUTOFF_DISCLAIMER,
  };
}

export default { scoreSubmission, csatQualification, gsCutoffEstimate, marksFor };
