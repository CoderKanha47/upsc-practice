/**
 * RAW TEXT PARSER for UPSC-style question papers.
 *
 * Works on text extracted from a PDF (text layer) or a clean transcription.
 * Detection is sequence-aware: a new question must be the *next* question
 * number, so statement numbering (1. 2. 3.) inside a question is never
 * mistaken for a new question.
 *
 * Anything structurally uncertain is returned with flags so the pipeline can
 * mark it REVIEW_REQUIRED instead of guessing.
 */

const NOISE_PATTERNS = [
  /^do not open this booklet/i,
  /^please read/i,
  /^blank page/i,
  /^p\.?t\.?o\.?$/i,
  /^\s*turn over/i,
  /^space for rough work/i,
  /^enrolment number/i,
  /^registration number/i,
  /^signature of the candidate/i,
  /^candidate's signature/i,
];

const OPTION_START = /^\s*[([]?\s*([a-fA-F])\s*[).]\s+(.*)$/;
const QUESTION_START = /^\s*(\d{1,3})\s*[.)]\s+(\S.*)$/;
const PASSAGE_START =
  /^\s*(passage\s*\d*|directions?\s*(?:for|:)|consider the following passage|read the following (?:passage|extract)|answer the following questions|study the following)/i;
const ANSWER_LINE = /^\s*(?:answer|ans)\s*[:\-]?\s*\(?\s*([a-fA-F])\s*\)?\s*$/i;

function cleanLine(line) {
  return line
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .trim();
}

function isNoise(line) {
  if (!line.trim()) return false;
  if (/^\d{1,3}$/.test(line.trim())) return true; // bare page numbers
  return NOISE_PATTERNS.some((re) => re.test(line.trim()));
}

/**
 * @param {string} text raw text of one paper
 * @returns {{questions: Array, warnings: Array}}
 */
export function parsePaperText(text, { paper = 'GS1', year = null, source = null } = {}) {
  const warnings = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, ' '))
    .filter((l) => !isNoise(l));

  const blocks = [];
  let current = null;
  let expected = 1;
  let currentPassage = null;
  let passageGroupId = null;
  let passageQuestions = 0;
  let groupIndex = 0;
  let preamble = [];

  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = cleanLine(raw);
    if (!line) continue;

    // Passage / directions header: applies to the questions that follow.
    if (PASSAGE_START.test(line) && (!current || current.optionLines.length > 0)) {
      if (currentPassage && passageQuestions > 0) {
        // A new passage block starts.
        flush();
        currentPassage = [line];
        passageGroupId = `p${blocks.length + 1}_${Math.random().toString(36).slice(2, 7)}`;
        groupIndex = 0;
        passageQuestions = 0;
      } else if (currentPassage) {
        currentPassage.push(line); // continuation of the same header
      } else {
        flush();
        currentPassage = [line];
        passageGroupId = `p${blocks.length + 1}_${Math.random().toString(36).slice(2, 7)}`;
        groupIndex = 0;
        passageQuestions = 0;
      }
      continue;
    }

    const qMatch = line.match(QUESTION_START);
    if (qMatch) {
      const num = Number(qMatch[1]);
      if (num === expected || (expected === 1 && num === 1)) {
        flush();
        expected = num + 1;
        current = {
          question_number: num,
          question_text: qMatch[2].trim(),
          optionLines: [],
          answer: null,
          passage: currentPassage ? currentPassage.join('\n') : null,
          group_id: currentPassage ? passageGroupId : null,
          group_index: currentPassage ? (groupIndex += 1) : null,
        };
        if (currentPassage) passageQuestions += 1;
        continue;
      }
      if (num === expected - 1 && current) {
        // Possible column-repeat of the current question header.
        const remainder = qMatch[2] || '';
        const head = current.question_text.slice(0, 12).toLowerCase();
        if (remainder && head && remainder.toLowerCase().startsWith(head)) {
          continue;
        }
        current.question_text += `\n${line}`;
        continue;
      }
      // Number out of sequence: statement numbering inside the question.
      if (current) {
        current.question_text += `\n${line}`;
        continue;
      }
      preamble.push(line);
      continue;
    }

    if (current) {
      const aMatch = line.match(ANSWER_LINE);
      if (aMatch) {
        current.answer = aMatch[1].toUpperCase();
        continue;
      }
      if (OPTION_START.test(line)) {
        current.optionLines.push(line);
        continue;
      }
      // Continuation of the question or of the last option.
      if (current.optionLines.length === 0) {
        current.question_text += `\n${line}`;
      } else if (current.answer) {
        current.question_text += `\n${line}`;
      } else {
        const last = current.optionLines[current.optionLines.length - 1];
        current.optionLines[current.optionLines.length - 1] = `${last} ${line}`;
      }
      continue;
    }

    if (currentPassage) currentPassage.push(line);
    else preamble.push(line);
  }
  flush();

  const questions = [];
  for (const b of blocks) {
    const options = [];
    let order = 0;
    for (const ol of b.optionLines) {
      const m = ol.match(OPTION_START);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const body = (m[2] || '').trim();
      if (!body) continue;
      options.push({ key, text: body, _order: order++ });
    }
    options.sort((a, z) => a.key.localeCompare(z.key));

    const q = {
      question_number: b.question_number,
      question_text: b.question_text.trim(),
      options: options.map(({ key, text }) => ({ key, text })),
      correct_answer: b.answer,
      passage: b.passage,
      group_id: b.group_id,
      group_index: b.group_index,
      paper,
      year,
      source,
      source_type: 'OFFICIAL_PYQ',
    };

    if (q.options.length < 2) {
      warnings.push(`Q${q.question_number}: only ${q.options.length} option(s) found — REVIEW REQUIRED`);
      q._flags = ['FEW_OPTIONS'];
    }
    if (!q.question_text || q.question_text.length < 10) {
      warnings.push(`Q${q.question_number}: question text looks incomplete`);
      q._flags = [...(q._flags || []), 'SHORT_TEXT'];
    }
    questions.push(q);
  }

  if (!questions.length) {
    warnings.push('No questions detected — the text may be a scan without a text layer.');
  }
  const lastExpected = questions.length ? questions[questions.length - 1].question_number : 0;
  if (expected - 1 !== lastExpected) {
    warnings.push(
      `Sequence gap: parsed up to Q${lastExpected}, next expected Q${expected}. Some questions may be missing (column layout or scan).`,
    );
  }

  return { questions, warnings, preamble: preamble.join('\n').trim() };
}

export default { parsePaperText };
