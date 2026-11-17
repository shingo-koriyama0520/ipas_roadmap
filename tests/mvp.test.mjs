import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMvpQuestions } from '../scripts/mvp-data.mjs';
import { contentFingerprint } from '../lib/question-quality.mjs';
import { publishable } from '../lib/domain.mjs';

function fixture() {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: `2026-${String(index + 1).padStart(3, '0')}`,
    year: 2026,
    number: index + 1,
    prompt: 'Synthetic MVP question',
    choices: ['A', 'B', 'C', 'D'],
    answer: 0,
    official_answer: 'ア',
    domain: 'テクノロジ',
    status: 'needs_review',
    explanation_status: 'needs_review',
    reviewer: null,
    reviewed_at: null,
    source: { question_pdf: 'synthetic.pdf', page: 1 },
    issues: [],
    explanation: {
      answer: 0,
      reasons: ['Reason A', 'Reason B', 'Reason C', 'Reason D'],
      terms: ['Term'],
      point: 'Point',
    },
  }));
  const decisions = {
    records: rows.map((q) => ({
      id: q.id,
      fingerprint: contentFingerprint(q),
      source: 'matched_ai_visual',
      explanation: [9, 29].includes(q.number) ? 'reviewed_evidence_pending' : 'evidence_checked',
      unresolved: [],
      choiceReviews: Array.from({ length: 4 }, () => ({ status: 'evidence_checked' })),
      human: { status: 'pending', reviewer: null, reviewed_at: null },
    })),
  };
  return { rows, decisions };
}

test('MVPは98問だけを選び、内容変更・根拠不足・人の承認の捏造を拒否する', () => {
  const { rows, decisions } = fixture();
  const selected = selectMvpQuestions(rows, decisions);
  assert.equal(selected.length, 98);
  assert.ok(selected.every((q) => ![9, 29].includes(q.number) && !publishable(q)));
  for (const mutate of [
    (q) => (q.explanation.reasons[3] += ' changed'),
    (q) => (q.reviewer = 'Fabricated reviewer'),
  ]) {
    const f = fixture();
    mutate(f.rows[0]);
    assert.throws(() => selectMvpQuestions(f.rows, f.decisions));
  }
  decisions.records[0].choiceReviews[3].status = 'pending';
  assert.throws(() => selectMvpQuestions(rows, decisions));
});
