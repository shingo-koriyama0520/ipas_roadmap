import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateQuestions } from '../lib/importer.mjs';
import { publishable } from '../lib/domain.mjs';

export function extractAnswerKey(items) {
  const key = new Map();
  for (const cell of items) {
    const match = /^問\s*(\d+)$/.exec(cell.text);
    if (!match) continue;
    const n = Number(match[1]);
    const neighbors = items.filter(
      (item) =>
        /^[アイウエ]$/.test(item.text) &&
        Math.abs(item.y - cell.y) < 1 &&
        item.x - cell.x > 40 &&
        item.x - cell.x < 65,
    );
    if (neighbors.length !== 1 || key.has(n)) throw new Error(`Ambiguous answer cell: ${n}`);
    key.set(n, neighbors[0].text);
  }
  return key;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] || 'data/repair/2026/questions-repaired.json';
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const answerItems = JSON.parse(
    readFileSync('.local/repair/2026/answers/extracted-text.json', 'utf8'),
  )[0].items;
  const key = extractAnswerKey(answerItems);
  if (key.size !== 100) throw new Error(`Expected 100 answers, found ${key.size}`);
  const validation = validateQuestions(data);
  const mismatches = data
    .filter(
      (q) => key.get(q.number) !== q.official_answer || 'アイウエ'[q.answer] !== key.get(q.number),
    )
    .map((q) => q.id);
  const errors = data
    .filter(
      (q) =>
        q.status !== 'needs_review' ||
        q.reviewer ||
        q.reviewed_at ||
        q.explanation_status !== 'needs_review' ||
        publishable(q),
    )
    .map((q) => q.id);
  const proof = {
    total: data.length,
    schema: validation.summary,
    answerPdfCells: key.size,
    answerMismatches: mismatches,
    publicationGuardErrors: errors,
    publishable: data.filter(publishable).length,
    dataSha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    method:
      'Answer key extracted independently from PDF text positions; original page also visually inspected by AI. Human review pending.',
  };
  writeFileSync('data/repair/2026/verification.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
  if (data.length !== 100 || validation.rejected.length || mismatches.length || errors.length)
    process.exitCode = 1;
}
