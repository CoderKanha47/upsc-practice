import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * PDF INGEST
 * ----------
 * Extracts the embedded text layer from a question-paper PDF.
 *
 * Many official UPSC PDFs are scans without a text layer; those are returned
 * with `needsOcr: true` and are NEVER given guessed/fabricated content — they
 * must go through OCR or a verified transcription before use.
 */

let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

export async function extractPdfText(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;

  const pages = [];
  let text = '';
  const numPages = doc.numPages;
  for (let p = 1; p <= numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let pageText = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      pageText += item.str;
      if (item.hasEOL) pageText += '\n';
      else if (item.str && !item.str.endsWith(' ')) pageText += ' ';
    }
    pageText = pageText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    pages.push(pageText);
    text += `${pageText}\n\n`;
    page.cleanup();
  }
  await doc.destroy();

  const cleaned = text.trim();
  const charsPerPage = pages.length ? Math.round(cleaned.length / pages.length) : 0;
  const needsOcr = cleaned.length < 400 || charsPerPage < 120;

  return {
    file: path.basename(filePath),
    pageCount: numPages,
    text: cleaned,
    pages,
    chars: cleaned.length,
    charsPerPage,
    needsOcr,
    note: needsOcr
      ? 'No usable text layer found (likely a scanned PDF). Run OCR or provide a verified transcription — the pipeline will not invent content.'
      : 'Text layer extracted.',
  };
}

export default { extractPdfText };
