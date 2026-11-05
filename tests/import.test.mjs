import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateQuestions, generateSql, importQuestions } from '../lib/importer.mjs';
import { publishable } from '../lib/domain.mjs';
import { main } from '../scripts/import.mjs';

const fixture = (n = 1) => ({
  id: `2026-${String(n).padStart(3, '0')}`,
  year: 2026,
  number: n,
  prompt: "テスト用：O'Reilly と SQL の記号 ; --",
  choices: ['A', 'B', 'C', 'D'],
  answer: 2,
  official_answer: 'ウ',
  domain: 'テクノロジ',
  status: 'published',
  explanation_status: 'publishable',
  reviewer: 'テスト用確認者',
  reviewed_at: '2026-11-05T00:00:00Z',
  explanation: {
    answer: 2,
    reasons: ['理由A', '理由B', '理由C', '理由D'],
    terms: ['テスト'],
    point: '本番には配信しない',
  },
  issues: [],
  source: { note: 'test fixture only' },
});
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  return db;
}

test('ID・年度・問題番号・正答・選択肢・解説・公開条件を検証', () => {
  assert.equal(validateQuestions([fixture()]).summary.publishable, 1);
  for (const patch of [
    { year: 2020 },
    { number: 101 },
    { id: 'wrong' },
    { answer: 8 },
    { official_answer: 'エ' },
    { choices: ['A'] },
    { choices: [1, 2, 3, 4] },
    { explanation: null },
    { domain: null },
    { reviewer: ' ' },
    { reviewed_at: 'invalid' },
  ]) {
    assert.equal(
      validateQuestions([{ ...fixture(), ...patch }]).summary.rejected,
      1,
      JSON.stringify(patch),
    );
  }
  assert.equal(validateQuestions([null]).summary.rejected, 1);
  assert.throws(() => validateQuestions({ records: [] }), /array/);
});
test('重複IDと年度・番号の重複を拒否', () => {
  const r = validateQuestions([fixture(), fixture()]);
  assert.equal(r.summary.rejected, 2);
  assert.equal(r.summary.issues.duplicate_id, 2);
  assert.equal(r.summary.issues.duplicate_year_number, 2);
});
test('生成SQLは文字を保全し再実行しても重複・上書きしない', () => {
  const db = database(),
    q = fixture(),
    sql = generateSql([q]);
  assert.doesNotMatch(sql, /INSERT OR REPLACE|DELETE FROM|UPDATE questions/);
  db.exec(sql);
  db.exec(sql);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM questions').get().n, 1);
  assert.equal(db.prepare('SELECT prompt FROM questions').get().prompt, q.prompt);
  db.exec(generateSql([{ ...q, prompt: '変更された問題' }]));
  assert.equal(db.prepare('SELECT prompt FROM questions').get().prompt, q.prompt);
  db.close();
});
test('ローカル登録は同一内容をスキップし学習履歴を保全', () => {
  const db = database(),
    q = fixture();
  assert.deepEqual(importQuestions(db, [q]), { inserted: 1, skipped: 0, total: 1 });
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(
    'u',
    'test@example.invalid',
    'learner',
    '2026-11-05',
  );
  db.prepare('INSERT INTO answers VALUES(?,?,?,?,?,?,?)').run(
    'a',
    'u',
    q.id,
    2,
    1,
    '2026-11-05',
    'study',
  );
  assert.deepEqual(importQuestions(db, [q]), { inserted: 0, skipped: 1, total: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM answers').get().n, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});
test('既存内容との衝突は先行した追加を含め全体をロールバック', () => {
  const db = database();
  importQuestions(db, [fixture()]);
  assert.throws(
    () => importQuestions(db, [fixture(2), { ...fixture(), prompt: '競合' }]),
    /conflict/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM questions').get().n, 1);
  db.close();
});
test('不正入力はSQL生成とローカルDB変更より前に停止', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ipas-import-'));
  const input = join(dir, 'invalid.json'),
    db = join(dir, 'app.sqlite');
  writeFileSync(input, JSON.stringify([{ ...fixture(), choices: [] }]));
  assert.throws(
    () => main(['--input', input, '--db', db, '--out', join(dir, 'out')]),
    /Import blocked/,
  );
  assert.equal(existsSync(db), false);
  assert.throws(() => generateSql([{ ...fixture(), prompt: null }]), /Invalid/);
});
test('CLIによるSQL検証・ローカル登録・バックアップ・再実行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ipas-import-'));
  const input = join(dir, 'valid.json'),
    db = join(dir, 'app.sqlite');
  writeFileSync(input, JSON.stringify([fixture()]));
  const args = ['--input', input, '--db', db, '--out', join(dir, 'out')];
  const first = main(args),
    second = main(args);
  assert.equal(first.local.inserted, 1);
  assert.equal(second.local.skipped, 1);
  assert.ok(existsSync(first.sql.path));
  assert.ok(first.sql.verifiedTwice);
});
test('不正な配列風オブジェクトで公開判定が例外を起こさない', () => {
  assert.equal(publishable({ ...fixture(), choices: { length: 4 } }), false);
  assert.equal(
    publishable({
      ...fixture(),
      explanation: { ...fixture().explanation, reasons: { length: 4 } },
    }),
    false,
  );
});
