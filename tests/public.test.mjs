import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handlePublic } from '../lib/public-api.mjs';
import { createLearningClient, STORAGE_KEY } from '../public/learning.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  for (let n = 1; n <= 100; n++)
    db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      `2026-${String(n).padStart(3, '0')}`,
      2026,
      n,
      'Synthetic question',
      JSON.stringify(['A', 'B', 'C', 'D']),
      0,
      'テクノロジ',
      'needs_review',
      'needs_review',
      JSON.stringify({
        answer: 0,
        reasons: ['A reason', 'B reason', 'C reason', 'D reason'],
        terms: ['Term'],
        point: 'Point',
      }),
      null,
      null,
      '{}',
      '[]',
    );
  let calls = [];
  const env = {
    DB: {
      prepare(sql) {
        assert.match(sql, /^SELECT /);
        calls.push(sql);
        let args = [];
        return {
          bind(...v) {
            args = v;
            return this;
          },
          async all() {
            return { results: db.prepare(sql).all(...args) };
          },
          async first() {
            return db.prepare(sql).get(...args);
          },
        };
      },
    },
  };
  const fetcher = (path, options = {}) => {
    assert.equal(options.method, undefined);
    return handlePublic(new Request('https://example.test' + path), env);
  };
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) || null, setItem: (k, v) => data.set(k, v) };
  return { db, env, fetcher, storage, calls };
}
test('公開APIは98問の目録と単問だけを返し、管理・認証・書き込みを公開しない', async () => {
  const f = fixture();
  try {
    const get = (path) => handlePublic(new Request('https://example.test/api' + path), f.env);
    const catalog = await (await get('/catalog')).json();
    assert.equal(catalog.count, 98);
    assert.ok(
      catalog.questions.every(
        (q) =>
          !('prompt' in q) &&
          !('answer' in q) &&
          !('explanation' in q) &&
          ![9, 29].includes(q.number),
      ),
    );
    const q = await (await get('/questions/2026-001')).json();
    assert.equal(q.choices.length, 4);
    assert.ok(!('answer' in q) && !('source' in q));
    assert.equal((await get('/questions/2026-009')).status, 404);
    assert.equal((await get('/questions/2026-029/solution')).status, 404);
    for (const path of [
      '/admin/data',
      '/admin/learners',
      '/auth/request',
      '/history',
      '/questions/2026-001%27',
    ])
      assert.equal((await get(path)).status, 404);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      assert.equal(
        (await handlePublic(new Request('https://example.test/api/answers', { method }), f.env))
          .status,
        405,
      );
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  } finally {
    f.db.close();
  }
});
test('ブラウザ保存は回答・14日進捗・98問模試・再読込・別ブラウザの分離を維持する', async () => {
  const f = fixture();
  let clock = Date.now();
  let client = createLearningClient(f.storage, f.fetcher, () => clock);
  try {
    const questions = (await client('/catalog')).questions;
    assert.equal(questions.length, 98);
    await assert.rejects(client('/days/complete', { day: 1 }), /学習後/);
    for (let day = 1; day <= 14; day++) {
      const result = await client('/answers', {
        id: 'answer-' + day,
        question_id: questions[day - 1].id,
        selected: day % 2,
        mode: 'study',
      });
      assert.equal(result.correct, day % 2 === 0);
      assert.equal(result.explanation.reasons.length, 4);
      await assert.rejects(client('/days/complete', { day: day + 1 }), /未完了/);
      await client('/days/complete', { day });
      client = createLearningClient(f.storage, f.fetcher, () => clock);
      assert.equal((await client('/history')).days.length, day);
    }
    const { id } = await client('/exams', { split: false });
    const exam = await client('/exams/' + id);
    assert.equal(exam.questions.length, 98);
    assert.ok(!exam.solutions);
    await client('/exams/' + id + '/answer', { question_id: exam.questions[0].id, selected: 0 });
    client = createLearningClient(f.storage, f.fetcher, () => clock);
    assert.equal(Object.keys((await client('/exams/' + id)).selections).length, 1);
    const result = await client('/exams/' + id + '/submit', {});
    assert.equal(result.result.correct, 1);
    assert.equal(result.result.total, 98);
    assert.equal(result.solutions.length, 98);
    await client('/exams/' + id + '/submit', {});
    assert.equal((await client('/history')).answers.length, 15);
    const split = await client('/exams', { split: true });
    clock += 3600001;
    assert.equal((await client('/exams/' + split.id)).status, 'paused');
    await client('/exams/' + split.id + '/resume', {});
    clock += 3600001;
    assert.equal((await client('/exams/' + split.id)).status, 'submitted');
    assert.equal(
      (await createLearningClient({ getItem: () => null, setItem() {} }, f.fetcher)('/history'))
        .answers.length,
      0,
    );
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM answers').get().n, 0);
    assert.equal(JSON.parse(f.storage.getItem(STORAGE_KEY)).days.length, 14);
  } finally {
    f.db.close();
  }
});
test('保存失敗・破損を成功扱いにしない', async () => {
  const f = fixture();
  try {
    const client = createLearningClient(
      {
        getItem: () => null,
        setItem() {
          throw Error('quota');
        },
      },
      f.fetcher,
    );
    await assert.rejects(
      client('/answers', { id: 'x', question_id: '2026-001', selected: 0 }),
      /保存できません/,
    );
    await assert.rejects(
      createLearningClient({ getItem: () => '{bad' }, f.fetcher)('/history'),
      /読み込めません/,
    );
  } finally {
    f.db.close();
  }
});
