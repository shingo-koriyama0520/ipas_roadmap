import { publishable, reviewQueue, remaining, score, curriculum } from './domain.mjs';
const enc = new TextEncoder();
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
const hash = async (x) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(x))), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
const json = (v, status = 200, headers = {}) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const all = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;
const first = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .first();
const run = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();
const safe = (q) => ({
  id: q.id,
  year: q.year,
  number: q.number,
  prompt: q.prompt,
  choices: JSON.parse(q.choices),
  domain: q.domain,
});
const reveal = (q) => ({ answer: q.answer, explanation: JSON.parse(q.explanation) });
async function body(req) {
  if (Number(req.headers.get('content-length')) > 50000) fail(413, '送信内容が大きすぎます');
  const s = await req.text();
  if (s.length > 50000) fail(413, '送信内容が大きすぎます');
  try {
    return JSON.parse(s);
  } catch {
    fail(400, 'JSONが不正です');
  }
}
export async function handle(req, env) {
  try {
    return await route(req, env);
  } catch (e) {
    return json(
      { error: e.status ? e.message : '処理に失敗しました。再度お試しください。' },
      e.status || 500,
    );
  }
}
async function route(req, env) {
  const url = new URL(req.url),
    path = url.pathname.replace(/^\/api/, '');
  const db = env.DB,
    now = Date.now();
  const origin = env.APP_ORIGIN || url.origin;
  if (req.method !== 'GET' && req.headers.get('Origin') !== origin)
    fail(403, '送信元を確認できません');
  if (path === '/auth/request' && req.method === 'POST') {
    const { email } = await body(req);
    if (typeof email !== 'string' || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email))
      fail(400, 'メールアドレスを確認してください');
    const normalized = email.trim().toLowerCase();
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    for (const key of ['email:' + normalized, 'ip:' + ip]) {
      await run(
        db,
        'INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END',
        key,
        now + 900000,
        now,
        now,
      );
      const r = await first(db, 'SELECT count FROM rate_limits WHERE key=?', key);
      if (r.count > (key.startsWith('ip:') ? 20 : 5)) fail(429, 'しばらく待ってからお試しください');
    }
    const token = random(),
      link = origin + '/#login=' + token;
    await run(
      db,
      'INSERT INTO login_tokens VALUES(?,?,?)',
      await hash(token),
      normalized,
      now + 900000,
    );
    if (env.LOCAL_DEVELOPMENT === true) {
      env.mailbox.set(normalized, link);
    } else {
      if (!env.MAIL_DELIVERY_URL || !env.MAIL_DELIVERY_KEY || !env.MAIL_FROM)
        fail(503, 'メール送信サービスが未設定です');
      const sent = await fetch(env.MAIL_DELIVERY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + env.MAIL_DELIVERY_KEY,
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: normalized,
          subject: '学習アプリへのログイン',
          text: '15分以内にログインしてください。\n' + link,
        }),
      });
      if (!sent.ok) fail(503, 'メール送信に失敗しました。再送してください');
    }
    return json({
      message: 'ログイン用メールを送信しました',
      local: env.LOCAL_DEVELOPMENT === true,
    });
  }
  if (path === '/dev/mail' && env.LOCAL_DEVELOPMENT === true && req.method === 'GET')
    return json({ link: env.mailbox.get(url.searchParams.get('email')) || null });
  if (path === '/auth/verify' && req.method === 'POST') {
    const { token } = await body(req);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      fail(400, 'ログインリンクが不正です');
    const t = await first(
      db,
      'DELETE FROM login_tokens WHERE token_hash=? AND expires>? RETURNING email',
      await hash(token),
      now,
    );
    if (!t) fail(401, 'リンクの有効期限が切れたか、使用済みです');
    const role = (env.ADMIN_EMAILS || '')
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .includes(t.email)
      ? 'admin'
      : 'learner';
    await run(
      db,
      'INSERT INTO users VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role',
      crypto.randomUUID(),
      t.email,
      role,
      new Date(now).toISOString(),
    );
    const u = await first(db, 'SELECT * FROM users WHERE email=?', t.email);
    const session = random();
    await run(
      db,
      'INSERT INTO sessions VALUES(?,?,?)',
      await hash(session),
      u.id,
      now + 7 * 86400000,
    );
    return json({ user: u }, 200, {
      'Set-Cookie': `session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${env.LOCAL_DEVELOPMENT === true ? '' : '; Secure'}`,
    });
  }
  const token = req.headers.get('Cookie')?.match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const user = token
    ? await first(
        db,
        'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?',
        await hash(token),
        now,
      )
    : null;
  if (path === '/me' && req.method === 'GET') return json({ user, curriculum });
  if (!user) fail(401, 'ログインしてください');
  if (path === '/auth/logout' && req.method === 'POST') {
    await run(db, 'DELETE FROM sessions WHERE token_hash=?', await hash(token));
    return json({ ok: true }, 200, {
      'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    });
  }
  const questions = (
    await all(
      db,
      "SELECT * FROM questions WHERE status='published' AND explanation_status='publishable'",
    )
  ).filter(publishable);
  if (path === '/history' && req.method === 'GET')
    return json({
      answers: await all(
        db,
        'SELECT * FROM answers WHERE user_id=? ORDER BY created_at,id',
        user.id,
      ),
      days: await all(db, 'SELECT * FROM days WHERE user_id=? ORDER BY day', user.id),
      exams: await all(
        db,
        'SELECT id,status,result,created_at FROM exams WHERE user_id=? ORDER BY created_at DESC',
        user.id,
      ),
    });
  if (path === '/catalog' && req.method === 'GET')
    return json({ questions: questions.map(safe), count: questions.length });
  if (path === '/review' && req.method === 'GET') {
    const h = await all(db, 'SELECT * FROM answers WHERE user_id=? ORDER BY created_at', user.id);
    return json({ questions: reviewQueue(questions, h).map(safe) });
  }
  if (path === '/answers' && req.method === 'POST') {
    const b = await body(req);
    const q = questions.find((q) => q.id === b.question_id);
    if (!q) fail(404, '公開可能な問題が見つかりません');
    if (
      !Number.isInteger(b.selected) ||
      b.selected < 0 ||
      b.selected > 3 ||
      !['study', 'review'].includes(b.mode) ||
      typeof b.id !== 'string' ||
      !/^[a-zA-Z0-9-]{10,80}$/.test(b.id)
    )
      fail(400, '回答形式が不正です');
    const old = await first(db, 'SELECT * FROM answers WHERE id=?', b.id);
    if (
      old &&
      (old.user_id !== user.id ||
        old.question_id !== q.id ||
        old.selected !== b.selected ||
        old.mode !== b.mode)
    )
      fail(409, '回答IDが競合しています');
    await run(
      db,
      'INSERT OR IGNORE INTO answers VALUES(?,?,?,?,?,?,?)',
      b.id,
      user.id,
      q.id,
      b.selected,
      b.selected === q.answer ? 1 : 0,
      new Date(now).toISOString(),
      b.mode,
    );
    return json({ ...reveal(q), correct: b.selected === q.answer });
  }
  if (path === '/days/complete' && req.method === 'POST') {
    const { day } = await body(req);
    if (!Number.isInteger(day) || day < 1 || day > 14) fail(400, '学習日が不正です');
    const done = await all(db, 'SELECT day FROM days WHERE user_id=?', user.id);
    const expected = Array.from({ length: 14 }, (_, i) => i + 1).find(
      (n) => !done.some((d) => d.day === n),
    );
    if (day !== expected) fail(409, '未完了の学習から進めてください');
    const evidence = await first(
      db,
      "SELECT COUNT(*) AS n FROM answers WHERE user_id=? AND created_at>COALESCE((SELECT MAX(completed_at) FROM days WHERE user_id=?),'')",
      user.id,
      user.id,
    );
    if (!evidence.n) fail(400, '学習後に完了してください');
    await run(
      db,
      'INSERT OR IGNORE INTO days VALUES(?,?,?)',
      user.id,
      day,
      new Date(now).toISOString(),
    );
    return json({ ok: true });
  }
  if (path === '/exams' && req.method === 'POST') {
    const b = await body(req);
    if (typeof b.split !== 'boolean') fail(400, '試験形式が不正です');
    if (questions.length < 100)
      fail(409, `検証済み問題が100問必要です（現在${questions.length}問）`);
    const active = await first(
      db,
      "SELECT id FROM exams WHERE user_id=? AND status IN ('running','paused')",
      user.id,
    );
    if (active) return json({ id: active.id });
    const shuffled = questions
      .map((q) => ({ q, r: crypto.getRandomValues(new Uint32Array(1))[0] }))
      .sort((a, b) => a.r - b.r)
      .slice(0, 100)
      .map((x) => x.q.id);
    const id = crypto.randomUUID();
    await run(
      db,
      'INSERT INTO exams(id,user_id,question_ids,split,running_since,created_at) VALUES(?,?,?,?,?,?)',
      id,
      user.id,
      JSON.stringify(shuffled),
      b.split ? 1 : 0,
      now,
      new Date(now).toISOString(),
    );
    return json({ id });
  }
  if (path.startsWith('/exams/')) {
    const id = path.split('/')[2],
      action = path.split('/')[3];
    let e = await first(db, 'SELECT * FROM exams WHERE id=? AND user_id=?', id, user.id);
    if (!e) fail(404, '試験が見つかりません');
    const ids = JSON.parse(e.question_ids),
      qs = ids.map((id) => questions.find((q) => q.id === id));
    if (qs.some((q) => !q)) fail(409, '試験問題の公開状態が変更されました');
    let left = remaining(e, now);
    let selections = JSON.parse(e.selections);
    // Split mode pauses at the 60-minute boundary even if the browser was closed.
    if (e.split && e.status === 'running' && e.remaining > 3600000 && left <= 3600000) {
      left = 3600000;
      await run(
        db,
        "UPDATE exams SET status='paused',remaining=3600000,running_since=NULL WHERE id=? AND user_id=? AND status='running'",
        id,
        user.id,
      );
      e.status = 'paused';
      e.remaining = left;
      e.running_since = null;
    }
    if (req.method === 'POST' && action === 'answer') {
      if (e.status !== 'running' || left <= 0) fail(409, '回答受付時間外です');
      const b = await body(req);
      if (
        !ids.includes(b.question_id) ||
        !Number.isInteger(b.selected) ||
        b.selected < 0 ||
        b.selected > 3
      )
        fail(400, '回答が不正です');
      selections[b.question_id] = b.selected;
      await run(
        db,
        "UPDATE exams SET selections=? WHERE id=? AND user_id=? AND status='running'",
        JSON.stringify(selections),
        id,
        user.id,
      );
      return json({ ok: true });
    }
    if (req.method === 'POST' && action === 'resume') {
      if (e.status !== 'paused') fail(409, '再開できません');
      await run(
        db,
        "UPDATE exams SET status='running',running_since=? WHERE id=? AND user_id=? AND status='paused'",
        now,
        id,
        user.id,
      );
      return json({ ok: true });
    }
    if (
      (req.method === 'POST' && action === 'submit') ||
      (req.method === 'GET' && left <= 0 && e.status === 'running')
    ) {
      if (e.status !== 'submitted') {
        const result = score(qs, selections);
        const statements = [
          db
            .prepare(
              "UPDATE exams SET status='submitted',result=?,remaining=?,running_since=NULL WHERE id=? AND user_id=? AND status!='submitted'",
            )
            .bind(JSON.stringify(result), left, id, user.id),
        ];
        for (const q of qs)
          if (Number.isInteger(selections[q.id]))
            statements.push(
              db
                .prepare('INSERT OR IGNORE INTO answers VALUES(?,?,?,?,?,?,?)')
                .bind(
                  id + '-' + q.id,
                  user.id,
                  q.id,
                  selections[q.id],
                  selections[q.id] === q.answer ? 1 : 0,
                  new Date(now).toISOString(),
                  'exam',
                ),
            );
        await db.batch(statements);
        e.status = 'submitted';
        e.result = JSON.stringify(result);
      }
    }
    if (req.method === 'GET' || action === 'submit')
      return json({
        id,
        status: e.status,
        remaining: left,
        selections,
        questions: qs.map(safe),
        result: e.result ? JSON.parse(e.result) : null,
        ...(e.status === 'submitted'
          ? { solutions: qs.map((q) => ({ id: q.id, ...reveal(q) })) }
          : {}),
      });
  }
  if (path.startsWith('/admin')) {
    if (user.role !== 'admin') fail(403, '管理者権限が必要です');
    if (path === '/admin/learners' && req.method === 'GET') {
      const learners = await all(
        db,
        'SELECT u.id,u.email,u.started_at,COUNT(a.id) AS total,COALESCE(SUM(a.correct),0) AS correct,MAX(a.created_at) AS last_study,(SELECT COUNT(*) FROM days d WHERE d.user_id=u.id) AS completed_days FROM users u LEFT JOIN answers a ON a.user_id=u.id GROUP BY u.id',
      );
      for (const u of learners) {
        u.domains = await all(
          db,
          'SELECT q.domain,COUNT(*) AS total,SUM(a.correct) AS correct FROM answers a JOIN questions q ON q.id=a.question_id WHERE a.user_id=? GROUP BY q.domain',
          u.id,
        );
        u.stalled = !u.last_study || now - Date.parse(u.last_study) > 3 * 86400000;
      }
      return json({ learners });
    }
    if (path === '/admin/data' && req.method === 'GET')
      return json({
        counts: await all(
          db,
          'SELECT status,explanation_status,COUNT(*) AS count FROM questions GROUP BY status,explanation_status',
        ),
        publishable: questions.length,
      });
  }
  fail(404, '見つかりません');
}
