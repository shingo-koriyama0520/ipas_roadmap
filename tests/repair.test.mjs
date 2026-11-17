import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAnswerKey } from '../scripts/verify-repair.mjs';

test('解答PDFの座標から同じ行の正答だけを対応付ける', () => {
  const cells = [
    { text: '問 1', x: 100, y: 500 },
    { text: 'イ', x: 150, y: 500 },
    { text: 'ウ', x: 150, y: 480 },
    { text: '問 2', x: 100, y: 480 },
  ];
  assert.deepEqual(
    [...extractAnswerKey(cells)],
    [
      [1, 'イ'],
      [2, 'ウ'],
    ],
  );
});
test('解答PDFの重複・曖昧な座標・正答欠損を拒否', () => {
  const q = { text: '問 1', x: 100, y: 500 },
    a = { text: 'ア', x: 150, y: 500 };
  assert.throws(() => extractAnswerKey([q, a, { ...a, text: 'イ' }]), /Ambiguous/);
  assert.throws(() => extractAnswerKey([q, a, q]), /Ambiguous/);
  assert.throws(() => extractAnswerKey([q]), /Ambiguous/);
});
