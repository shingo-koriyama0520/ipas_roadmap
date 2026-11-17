import test from 'node:test';
import assert from 'node:assert/strict';
import { publishable } from '../lib/domain.mjs';
const fixture = (i) => ({
  id: 'test-' + i,
  year: 2026,
  number: i,
  prompt: 'テスト専用の問題',
  choices: JSON.stringify(['A', 'B', 'C', 'D']),
  answer: i % 4,
  domain: ['ストラテジ', 'マネジメント', 'テクノロジ'][i % 3],
  status: 'published',
  explanation_status: 'publishable',
  explanation: JSON.stringify({
    answer: i % 4,
    reasons: ['理由A', '理由B', '理由C', '理由D'],
    terms: ['用語'],
    point: 'テスト専用',
  }),
  reviewer: 'test reviewer',
  reviewed_at: new Date().toISOString(),
});
test('公開ゲートは未校正・未検証解説・空選択肢を拒否する', () => {
  const q = fixture(1);
  assert.ok(publishable(q));
  for (const patch of [
    { status: 'needs_review' },
    { reviewer: null },
    { explanation_status: 'generated' },
    { choices: '["A","B","C",""]' },
    { explanation: '{}' },
    { answer: 8 },
  ])
    assert.equal(publishable({ ...q, ...patch }), false);
});
