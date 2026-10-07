#!/usr/bin/env node
/**
 * SOURCE FETCHER
 * --------------
 *   npm run fetch-sources                       # uses data/sources.manifest.json
 *   npm run fetch-sources -- --url <URL> --year 2024 --paper GS1
 *   npm run fetch-sources -- --check            # re-inspect already downloaded PDFs
 *   npm run fetch-sources -- --force            # re-download
 *
 * Downloads official UPSC question-paper PDFs listed in a manifest, verifies
 * they are real PDFs, hashes them, and inspects whether they carry a usable
 * text layer. It NEVER extracts, guesses or invents question content: scanned
 * papers are reported as `needsOcr` and must be OCRed/verified by a human
 * before importing (npm run import -- <txt> --format text).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractPdfText } from '../src/import/parsers/pdf.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_DIR = path.join(ROOT, 'data', 'sources');
const MANIFEST = path.join(ROOT, 'data', 'sources.manifest.json');
const INDEX = path.join(SOURCES_DIR, 'index.json');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

function safeName(year, paper, url) {
  if (year && paper) return `${year}-${paper}.pdf`;
  const base = url.split('?')[0].split('/').pop() || 'download.pdf';
  return base.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

async function loadManifest() {
  if (has('url')) {
    return [{ url: arg('url'), year: arg('year') ? Number(arg('year')) : null, paper: arg('paper') }];
  }
  try {
    const raw = await fs.readFile(MANIFEST, 'utf8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function download(url, dest) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'upsc-prelims-simulator/1.0 (personal study tool)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('response is not a PDF (HTML redirect page?) — the URL may be wrong');
  }
  const tmp = `${dest}.part`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, dest);
  return buf;
}

async function inspect(file, buf) {
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  try {
    const text = await extractPdfText(file);
    return {
      file: path.basename(file),
      bytes: buf.length,
      sha256,
      pageCount: text.pageCount,
      textChars: text.chars,
      needsOcr: text.needsOcr,
      note: text.note,
      state: text.needsOcr ? 'SCANNED_NEEDS_OCR' : 'TEXT_LAYER_OK',
    };
  } catch (err) {
    return { file: path.basename(file), bytes: buf.length, sha256, state: 'UNREADABLE', note: err.message };
  }
}

await fs.mkdir(SOURCES_DIR, { recursive: true });
const entries = await loadManifest();
if (!entries.length) {
  console.log(`No sources listed. Create ${path.relative(process.cwd(), MANIFEST)} as an array of {url, year, paper}.`);
  console.log('Example: [{ "url": "https://www.upsc.gov.in/sites/default/files/QP-...pdf", "year": 2024, "paper": "GS1" }]');
  process.exit(1);
}

const report = [];
for (const entry of entries) {
  const { url, year = null, paper = null } = entry;
  const dest = path.join(SOURCES_DIR, safeName(year, paper, url));
  const line = `${year ?? '?'} ${paper ?? '?'} — ${url}`;
  let buf;
  try {
    const existing = has('force') ? null : await fs.readFile(dest).catch(() => null);
    if (existing) {
      console.log(`skip (exists) ${path.basename(dest)}`);
      buf = existing;
    } else {
      console.log(`fetch       ${line}`);
      buf = await download(url, dest);
      console.log(`  saved ${path.basename(dest)} (${buf.length} bytes)`);
    }
    const info = await inspect(dest, buf);
    info.url = url;
    info.year = year;
    info.paper = paper;
    report.push(info);
    console.log(`  ${info.state} · pages ${info.pageCount ?? '—'} · text chars ${info.textChars ?? '—'}`);
    if (info.needsOcr) {
      console.log('  → scanned PDF: run OCR externally, then import the .txt (npm run import -- file.txt --format text --year YYYY --paper PAPER)');
    }
  } catch (err) {
    console.log(`  FAILED: ${err.message}`);
    report.push({ url, year, paper, state: 'DOWNLOAD_FAILED', note: err.message });
  }
}

await fs.writeFile(INDEX, `${JSON.stringify({ generatedAt: new Date().toISOString(), items: report }, null, 2)}\n`);
console.log('');
console.log(`Report written to ${path.relative(process.cwd(), INDEX)}`);
const ok = report.filter((r) => r.state === 'TEXT_LAYER_OK').length;
const ocr = report.filter((r) => r.state === 'SCANNED_NEEDS_OCR').length;
const bad = report.length - ok - ocr;
console.log(`Summary: ${ok} text-layer · ${ocr} need OCR · ${bad} failed/other`);
process.exit(bad ? 1 : 0);
