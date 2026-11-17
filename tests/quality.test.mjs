import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCoverage,
  check2026Coverage,
  contentFingerprint,
  qualityClassification,
} from '../lib/question-quality.mjs';

test('2025 coverage uses booklet boundaries and a resumable question range', () => {
  const rows = [35, 36, 37].map((n) => ({
    ...fixture(n),
    id: `2025-${String(n).padStart(3, '0')}`,
    year: 2025,
    domain: n <= 35 ? 'ストラテジ' : 'マネジメント',
  }));
  const key = new Map(Array.from({ length: 100 }, (_, i) => [i + 1, 'ア']));
  const options = { year: 2025, strategyEnd: 35, managementEnd: 55, start: 35, end: 37 };
  assert.deepEqual(checkCoverage(rows, key, options), []);
  rows[0].domain = 'マネジメント';
  assert.ok(checkCoverage(rows, key, options).length > 0);
});
import { buildQualityReport } from '../scripts/quality-2026.mjs';

function fixture(n) {
  return {
    id: `2026-${String(n).padStart(3, '0')}`,
    year: 2026,
    number: n,
    prompt: 'Synthetic prompt',
    choices: ['A', 'B', 'C', 'D'],
    answer: 0,
    official_answer: 'ア',
    domain: n <= 34 ? 'ストラテジ' : n <= 54 ? 'マネジメント' : 'テクノロジ',
    status: 'needs_review',
    explanation_status: 'needs_review',
    reviewer: null,
    reviewed_at: null,
    explanation: {
      answer: 0,
      reasons: ['Reason A', 'Reason B', 'Reason C', 'Reason D'],
      terms: ['Term'],
      point: 'Point',
    },
    source: {
      question_pdf: 'synthetic.pdf',
      page: 1,
      answer_pdf: 'synthetic-answers.pdf',
      answer_page: 1,
    },
    issues: [],
  };
}
const data = () => Array.from({ length: 100 }, (_, i) => fixture(i + 1));
const key = () => new Map(Array.from({ length: 100 }, (_, i) => [i + 1, 'ア']));
const review = (q) => ({
  id: q.id,
  fingerprint: contentFingerprint(q),
  source: 'matched_ai_visual',
  explanation: 'evidence_checked',
  unresolved: [],
  changes: [],
  human: { status: 'pending', reviewer: null, reviewed_at: null },
  choiceReviews: [...'アイウエ'].map((symbol) => ({ symbol, note: 'Synthetic review' })),
});

test('年度全件検証は欠番・重複・分類の境界・公式解答のずれを検出する', () => {
  const rows = data();
  assert.deepEqual(check2026Coverage(rows, key()), []);
  rows[33].domain = 'マネジメント';
  rows[54].domain = 'マネジメント';
  rows[99] = { ...rows[98] };
  rows[0].official_answer = 'イ';
  const codes = check2026Coverage(rows, key()).map((e) => e.code);
  for (const code of [
    'missing_number',
    'duplicate_id',
    'domain_range_mismatch',
    'answer_key_mismatch',
  ])
    assert.ok(codes.includes(code), code);
});

test('本文・誤答解説・公式正答の変更で過去の内容レビューは失効する', () => {
  for (const mutate of [
    (q) => (q.prompt += ' changed'),
    (q) => (q.explanation.reasons[3] += ' changed'),
    (q) => (q.official_answer = 'イ'),
  ]) {
    const rows = data(),
      reviews = rows.map(review);
    mutate(rows[0]);
    const result = buildQualityReport(rows, reviews, key());
    assert.ok(
      result.errors.some((e) => e.id === rows[0].id && e.code === 'missing_or_stale_review'),
    );
    assert.equal(result.records[0].classification, '要確認');
  }
});

test('AI確認だけ・未解決事項あり・承認とデータの不一致では公開可能にしない', () => {
  const q = fixture(1),
    r = review(q);
  assert.equal(qualityClassification(q, r, true), '要確認');
  q.status = 'published';
  q.explanation_status = 'publishable';
  q.reviewer = 'Synthetic reviewer';
  q.reviewed_at = '2026-11-06T00:00:00Z';
  r.human = { status: 'approved', reviewer: q.reviewer, reviewed_at: q.reviewed_at };
  assert.equal(qualityClassification(q, r, true), '公開可能');
  r.unresolved = ['Unresolved'];
  assert.equal(qualityClassification(q, r, true), '要確認');
  r.unresolved = [];
  r.human.reviewer = 'Different reviewer';
  assert.equal(qualityClassification(q, r, true), '要確認');
  q.choices.pop();
  assert.equal(qualityClassification(q, r, true), '公開不可');
});

test('最終品質監査は不足した選択肢レビューと予期しない人の承認を拒否する', () => {
  const rows = data(),
    reviews = rows.map(review);
  reviews[0].choiceReviews.pop();
  rows[1].reviewer = 'Unprovided reviewer';
  const result = buildQualityReport(rows, reviews, key());
  assert.ok(result.errors.some((e) => e.code === 'incomplete_choice_review'));
  assert.ok(result.errors.some((e) => e.code === 'unexpected_approval'));
});

test('根拠付きレビューは各選択肢の参照先・方法と全問判定の整合性を検証する', () => {
  const rows = data();
  const reviews = rows.map(review);
  const r = reviews[0];
  r.auditVersion = 2;
  r.evidence = [
    { url: 'https://example.org/spec', supports: 'Synthetic specification', access: 'Read' },
  ];
  r.choiceReviews = [...'アイウエ'].map((symbol) => ({
    symbol,
    note: 'Synthetic comparison',
    status: 'evidence_checked',
    method: 'Compare definition',
    evidenceRefs: [0],
  }));
  assert.deepEqual(buildQualityReport(rows, reviews, key()).errors, []);
  r.choiceReviews[3].evidenceRefs = [4];
  const invalid = buildQualityReport(rows, reviews, key());
  assert.ok(invalid.errors.some((e) => e.code === 'missing_choice_evidence'));
  assert.ok(invalid.errors.some((e) => e.code === 'inconsistent_evidence_decision'));
  assert.equal(invalid.summary.explanationEvidenceComplete, 99);
  r.choiceReviews[3].status = 'ai_reviewed_pending_evidence';
  r.choiceReviews[3].evidenceRefs = [];
  r.explanation = 'reviewed_evidence_pending';
  r.unresolved = ['Missing independent evidence'];
  assert.deepEqual(buildQualityReport(rows, reviews, key()).errors, []);
  assert.equal(buildQualityReport(rows, reviews, key()).summary.explanationEvidenceComplete, 99);
  r.explanation = 'evidence_checked';
  assert.ok(
    buildQualityReport(rows, reviews, key()).errors.some(
      (e) => e.code === 'inconsistent_evidence_decision',
    ),
  );
});
