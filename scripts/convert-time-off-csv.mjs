#!/usr/bin/env node
// Convert the HRX Time Off Report CSV into the bundled JSON seed.
//
// Why bundled JSON instead of reading the CSV at runtime:
// Next.js's standalone build (Dockerfile runner stage) only copies the
// .next/standalone tree, so arbitrary files under data/seed/ never make
// it into the production image. Importing JSON via `with { type: 'json' }`
// pulls it through the bundler — same pattern as
// src/data/csv_country_owners_seed.json. The CSV at data/seed/ stays as
// the source-of-truth audit artifact; this script regenerates the JSON
// from it.
//
// Run after dropping a fresh CSV into data/seed/:
//   node scripts/convert-time-off-csv.mjs [path/to/source.csv]
// Defaults to data/seed/hrx_time_off_2026_05_11.csv → src/data/time_off_seed.json.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_INPUT  = resolve(REPO_ROOT, 'data/seed/hrx_time_off_2026_05_11.csv');
const DEFAULT_OUTPUT = resolve(REPO_ROOT, 'src/data/time_off_seed.json');

const MONTHS = {
  jan:1, feb:2, mar:3, apr:4, may:5, jun:6,
  jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
};

function pad2(n) { return String(n).padStart(2, '0'); }

// Parse 'May 26, 2026' or 'May 26 2026' to '2026-05-26'. Returns null on
// any failure so the caller can log + skip rather than corrupt the seed.
function parseHrxDate(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/"/g, '').trim();
  const m = cleaned.match(/^([A-Za-z]{3,})\s+(\d{1,2})[, ]+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  const day   = parseInt(m[2], 10);
  const year  = parseInt(m[3], 10);
  if (!month || !day || !year) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// Minimal CSV reader: handles double-quoted fields containing commas,
// which is the only CSV quirk the HRX export uses. No backslash escapes,
// no embedded newlines inside fields.
function splitCsvLine(line) {
  const out = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map(s => s.trim());
}

async function main() {
  const inputPath  = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_INPUT;
  const outputPath = process.argv[3] ? resolve(process.cwd(), process.argv[3]) : DEFAULT_OUTPUT;

  const text = await readFile(inputPath, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) {
    console.error('[convert-time-off-csv] input is empty:', inputPath);
    process.exit(1);
  }

  const header = splitCsvLine(lines[0]).map(s => s.toLowerCase());
  const iStart = header.findIndex(h => /^start/.test(h));
  const iEnd   = header.findIndex(h => /^end/.test(h));
  const iEmail = header.findIndex(h => /email/.test(h));
  if (iStart < 0 || iEnd < 0 || iEmail < 0) {
    console.error('[convert-time-off-csv] header missing required columns. saw:', header);
    process.exit(1);
  }

  const rows = [];
  const errors = [];
  for (let lineNo = 1; lineNo < lines.length; lineNo++) {
    const cols = splitCsvLine(lines[lineNo]);
    const start = parseHrxDate(cols[iStart]);
    const end   = parseHrxDate(cols[iEnd]);
    const email = (cols[iEmail] || '').toLowerCase().trim();
    if (!start || !end || !email || !email.includes('@')) {
      errors.push({ lineNo: lineNo + 1, cols });
      continue;
    }
    if (start > end) {
      errors.push({ lineNo: lineNo + 1, reason: 'end before start', cols });
      continue;
    }
    rows.push({ work_email: email, start_date: start, end_date: end });
  }

  // Deterministic order: by email then start_date so diffs stay small
  // across regenerations. Removes ambiguity if the source CSV reorders.
  rows.sort((a, b) =>
    a.work_email.localeCompare(b.work_email) || a.start_date.localeCompare(b.start_date)
  );

  const payload = {
    sourceFile: inputPath.split('/').pop(),
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows,
  };

  await writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(`[convert-time-off-csv] wrote ${rows.length} rows to ${outputPath}`);
  if (errors.length > 0) {
    console.warn(`[convert-time-off-csv] skipped ${errors.length} malformed row(s):`);
    for (const e of errors.slice(0, 5)) console.warn('  line', e.lineNo, e.reason || '', e.cols);
    if (errors.length > 5) console.warn(`  ...and ${errors.length - 5} more`);
  }
}

main().catch(err => {
  console.error('[convert-time-off-csv] failed:', err);
  process.exit(1);
});
