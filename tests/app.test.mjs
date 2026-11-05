import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle } from '../lib/api.mjs';
import { publishable, reviewQueue, remaining, score, curriculum } from '../lib/domain.mjs';
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
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
  const prep = (sql) => {
    let args = [];
    return {
      bind(...a) {
        args = a;
        return this;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...args) };
      },
      async first() {
        return sqlite.prepare(sql).get(...args) || null;
      },
      async run() {
        return sqlite.prepare(sql).run(...args);
      },
    };
  };
  const DB = {
    prepare: prep,
    async batch(ss) {
      sqlite.exec('BEGIN');
      try {
        for (const s of ss) await s.run();
        sqlite.exec('COMMIT');
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const env = {
    DB,
    LOCAL_DEVELOPMENT: true,
    mailbox: new Map(),
    APP_ORIGIN: 'http://localhost',
    ADMIN_EMAILS: 'admin@test.invalid',
  };
  for (let i = 1; i <= 105; i++) {
    const q = fixture(i);
    sqlite
      .prepare('INSERT INTO questions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        q.id,
        q.year,
        q.number,
        q.prompt,
        q.choices,
        q.answer,
        q.domain,
        q.status,
        q.explanation_status,
        q.explanation,
        q.reviewer,
        q.reviewed_at,
        '{}',
        '[]',
      );
  }
  const call = async (path, data, cookie = '', origin = 'http://localhost') => {
    const r = await handle(
      new Request('http://localhost/api' + path, {
        method: data ? 'POST' : 'GET',
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
      env,
    );
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get('Set-Cookie')?.split(';')[0],
    };
  };
  const login = async (email) => {
    await call('/auth/request', { email });
    const token = env.mailbox.get(email).split('=')[1];
    return call('/auth/verify', { token });
  };
  return { sqlite, env, call, login };
}
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
test('一度正解した既誤答問題を復習から除外しない', () => {
  assert.equal(
    reviewQueue(
      [fixture(1)],
      [
        { question_id: 'test-1', correct: 0, created_at: '2026-01-01' },
        { question_id: 'test-1', correct: 1, created_at: '2026-01-02' },
      ],
    ).length,
    1,
  );
});
test('採点・分野別集計と未回答扱い', () => {
  const s = score([fixture(1), fixture(2)], { 'test-1': 1 });
  assert.equal(s.correct, 1);
  assert.equal(s.rate, 50);
  assert.equal(
    Object.values(s.domains).reduce((n, d) => n + d.total, 0),
    2,
  );
  assert.equal(curriculum.length, 14);
});
test('時間はサーバー保存時刻から計算する', () => {
  assert.equal(remaining({ remaining: 7200000, running_since: 1000 }, 61000), 7140000);
  assert.equal(remaining({ remaining: 3600000, running_since: null }, 1e9), 3600000);
  assert.equal(remaining({ remaining: 10, running_since: 1 }, 100), 0);
});
test('認証・CSRF・メールリンクの一回使用と期限', async () => {
  const s = setup();
  assert.equal((await s.call('/history')).status, 401);
  assert.equal(
    (await s.call('/auth/request', { email: 'a@test.invalid' }, '', 'https://evil.invalid')).status,
    403,
  );
  await s.call('/auth/request', { email: 'a@test.invalid' });
  const token = s.env.mailbox.get('a@test.invalid').split('=')[1];
  assert.equal((await s.call('/auth/verify', { token })).status, 200);
  assert.equal((await s.call('/auth/verify', { token })).status, 401);
  await s.call('/auth/request', { email: 'b@test.invalid' });
  s.sqlite.exec('UPDATE login_tokens SET expires=1');
  assert.equal(
    (await s.call('/auth/verify', { token: s.env.mailbox.get('b@test.invalid').split('=')[1] }))
      .status,
    401,
  );
  s.sqlite.close();
});
test('回答確定前は正解と解説を返さない', async () => {
  const s = setup(),
    u = await s.login('a@test.invalid');
  const c = await s.call('/catalog', null, u.cookie);
  assert.equal(c.body.questions.length, 105);
  assert.equal('answer' in c.body.questions[0], false);
  assert.equal('explanation' in c.body.questions[0], false);
  s.sqlite.close();
});
test('自動保存・再送の冪等性・別ユーザーからの分離', async () => {
  const s = setup(),
    a = await s.login('a@test.invalid'),
    b = await s.login('b@test.invalid');
  const payload = { id: 'test-answer-00001', question_id: 'test-1', selected: 1, mode: 'study' };
  assert.equal((await s.call('/answers', payload, a.cookie)).body.correct, true);
  assert.equal((await s.call('/answers', payload, a.cookie)).status, 200);
  assert.equal((await s.call('/history', null, a.cookie)).body.answers.length, 1);
  assert.equal((await s.call('/history', null, b.cookie)).body.answers.length, 0);
  assert.equal((await s.call('/answers', payload, b.cookie)).status, 409);
  assert.equal(
    (await s.call('/answers', { ...payload, id: 'test-answer-00002', selected: 4 }, a.cookie))
      .status,
    400,
  );
  s.sqlite.close();
});
test('管理者APIの認証と認可', async () => {
  const s = setup(),
    a = await s.login('a@test.invalid'),
    admin = await s.login('admin@test.invalid');
  assert.equal((await s.call('/admin/learners')).status, 401);
  assert.equal((await s.call('/admin/learners', null, a.cookie)).status, 403);
  assert.equal((await s.call('/admin/learners', null, admin.cookie)).body.learners.length, 2);
  s.sqlite.close();
});
test('100問模試・回答変更・提出後採点・二重提出防止・所有権', async () => {
  const s = setup(),
    a = await s.login('a@test.invalid'),
    b = await s.login('b@test.invalid');
  const {
    body: { id },
  } = await s.call('/exams', { split: false }, a.cookie);
  let e = await s.call('/exams/' + id, null, a.cookie);
  assert.equal(e.body.questions.length, 100);
  assert.equal('solutions' in e.body, false);
  assert.equal((await s.call('/exams/' + id, null, b.cookie)).status, 404);
  const q = e.body.questions[0];
  await s.call(
    '/exams/' + id + '/answer',
    { question_id: q.id, selected: (q.number + 1) % 4 },
    a.cookie,
  );
  await s.call('/exams/' + id + '/answer', { question_id: q.id, selected: q.number % 4 }, a.cookie);
  e = await s.call('/exams/' + id + '/submit', {}, a.cookie);
  assert.equal(e.body.result.correct, 1);
  assert.equal(e.body.result.total, 100);
  await s.call('/exams/' + id + '/submit', {}, a.cookie);
  assert.equal((await s.call('/history', null, a.cookie)).body.answers.length, 1);
  assert.equal(
    (await s.call('/exams/' + id + '/answer', { question_id: q.id, selected: 1 }, a.cookie)).status,
    409,
  );
  s.sqlite.close();
});
test('模試の時間切れ自動採点と60分境界での中断・再開', async () => {
  const s = setup(),
    a = await s.login('a@test.invalid');
  let r = await s.call('/exams', { split: true }, a.cookie),
    id = r.body.id;
  s.sqlite.prepare('UPDATE exams SET running_since=? WHERE id=?').run(Date.now() - 3700000, id);
  let e = await s.call('/exams/' + id, null, a.cookie);
  assert.equal(e.body.status, 'paused');
  assert.equal(e.body.remaining, 3600000);
  await s.call('/exams/' + id + '/resume', {}, a.cookie);
  s.sqlite.prepare('UPDATE exams SET running_since=? WHERE id=?').run(Date.now() - 3700000, id);
  e = await s.call('/exams/' + id, null, a.cookie);
  assert.equal(e.body.status, 'submitted');
  assert.equal(e.body.result.correct, 0);
  s.sqlite.close();
});
test('未公開問題は回答を受け付けない・100問未満の模試開始を拒否', async () => {
  const s = setup(),
    a = await s.login('a@test.invalid');
  s.sqlite.exec("UPDATE questions SET status='needs_review'");
  assert.equal((await s.call('/catalog', null, a.cookie)).body.count, 0);
  assert.equal(
    (
      await s.call(
        '/answers',
        { id: 'answer-0000001', question_id: 'test-1', selected: 1, mode: 'study' },
        a.cookie,
      )
    ).status,
    404,
  );
  assert.equal((await s.call('/exams', { split: false }, a.cookie)).status, 409);
  s.sqlite.close();
});
test('完了日を順番に保存・回答なしの進捗偽装を拒否', async () => {
  const s = setup(),
    a = await s.login('a@test.invalid');
  assert.equal((await s.call('/days/complete', { day: 1 }, a.cookie)).status, 400);
  await s.call(
    '/answers',
    { id: 'answer-0000001', question_id: 'test-1', selected: 1, mode: 'study' },
    a.cookie,
  );
  assert.equal((await s.call('/days/complete', { day: 2 }, a.cookie)).status, 409);
  assert.equal((await s.call('/days/complete', { day: 1 }, a.cookie)).status, 200);
  assert.equal((await s.call('/history', null, a.cookie)).body.days.length, 1);
  s.sqlite.close();
});
test('メールレート制限と本番で開発受信箱を公開しない', async () => {
  const s = setup();
  for (let i = 0; i < 5; i++) await s.call('/auth/request', { email: 'a@test.invalid' });
  assert.equal((await s.call('/auth/request', { email: 'a@test.invalid' })).status, 429);
  s.env.LOCAL_DEVELOPMENT = false;
  assert.equal((await s.call('/dev/mail?email=a@test.invalid')).status, 401);
  assert.equal((await s.call('/auth/request', { email: 'z@test.invalid' })).status, 503);
  s.sqlite.close();
});
