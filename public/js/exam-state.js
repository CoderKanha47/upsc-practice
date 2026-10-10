import { get } from './api.js';

export const DEFAULT_EXAM = 'UPSC_CSE_PRELIMS';
const STORAGE_KEY = 'upsc-exam';

let cache = null; // { defaultExam, exams, papers }

export async function loadExamConfig(force = false) {
  if (cache && !force) return cache;
  const cfg = await get('/api/config');
  cache = {
    defaultExam: cfg.defaultExam || DEFAULT_EXAM,
    exams: cfg.exams || [],
    papers: cfg.papers || [],
  };
  return cache;
}

export function examConfig() {
  return cache;
}

export function currentExam() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && cache?.exams?.some((e) => e.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return cache?.defaultExam || DEFAULT_EXAM;
}

export function setExam(examId) {
  try {
    localStorage.setItem(STORAGE_KEY, examId);
  } catch {
    /* ignore */
  }
}

export function getExamMeta(examId = currentExam()) {
  return cache?.exams?.find((e) => e.id === examId) || null;
}

export function papersForExam(examId = currentExam()) {
  return (cache?.papers || []).filter((p) => p.exam === examId);
}

export function paperMeta(paperId) {
  return cache?.papers?.find((p) => p.id === paperId) || null;
}

export function paperLabel(paperId) {
  return paperMeta(paperId)?.shortTitle || paperId;
}

export default {
  DEFAULT_EXAM, loadExamConfig, examConfig, currentExam, setExam,
  getExamMeta, papersForExam, paperMeta, paperLabel,
};
