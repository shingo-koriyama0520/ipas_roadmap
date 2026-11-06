export const STORAGE_KEY = 'ipas-learning-v1';
const blank = () => ({ version: 1, answers: [], days: [], exams: [] });

// Personal data lives only in this browser. No write requests go to D1.
export function createLearningClient(storage, fetcher = fetch, now = Date.now) {
  let catalog;
  const questionCache = new Map();
  const read = () => {
    let state;
    try {
      state = JSON.parse(storage.getItem(STORAGE_KEY) || 'null') || blank();
    } catch {
      throw Error('学習履歴を読み込めません。ブラウザの保存設定を確認してください');
    }
    if (state.version !== 1 || !['answers', 'days', 'exams'].every((k) => Array.isArray(state[k])))
      throw Error('学習履歴の形式を確認できません');
    return state;
  };
  const save = (state) => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      throw Error('履歴を保存できません。ブラウザの保存容量・設定を確認してください');
    }
  };
  const get = async (path) => {
    const r = await fetcher('/api' + path, { credentials: 'omit', cache: 'no-store' });
    const data = await r.json();
    if (!r.ok) throw Error(data.error || '問題を取得できません');
    return data;
  };
  const list = async () => (catalog ||= (await get('/catalog')).questions);
  const question = async (id) => {
    if (!questionCache.has(id))
      questionCache.set(id, await get('/questions/' + encodeURIComponent(id)));
    return questionCache.get(id);
  };
  const solution = (id) => get('/questions/' + encodeURIComponent(id) + '/solution');
  const validateChoice = (selected) => {
    if (!Number.isInteger(selected) || selected < 0 || selected > 3)
      throw Error('選択肢が不正です');
  };
  const stamp = () => new Date(now()).toISOString();
  const left = (exam) =>
    Math.max(0, exam.remaining - (exam.running_since === null ? 0 : now() - exam.running_since));
  async function finish(state, exam) {
    const solutions = [];
    // Bound concurrent requests; solutions are fetched only on submission.
    for (let start = 0; start < exam.ids.length; start += 6)
      solutions.push(
        ...(await Promise.all(
          exam.ids.slice(start, start + 6).map(async (id) => ({ id, ...(await solution(id)) })),
        )),
      );
    const domains = {};
    let correct = 0;
    for (const q of await list()) {
      if (!exam.ids.includes(q.id)) continue;
      const answer = solutions.find((s) => s.id === q.id).answer;
      const ok = exam.selections[q.id] === answer;
      const d = (domains[q.domain] ||= { correct: 0, total: 0 });
      d.total++;
      d.correct += Number(ok);
      correct += Number(ok);
      if (Number.isInteger(exam.selections[q.id]))
        state.answers.push({
          id: exam.id + '-' + q.id,
          question_id: q.id,
          selected: exam.selections[q.id],
          correct: ok,
          mode: 'exam',
          created_at: stamp(),
        });
    }
    exam.remaining = left(exam);
    exam.running_since = null;
    exam.status = 'submitted';
    exam.solutions = solutions;
    exam.result = JSON.stringify({
      correct,
      total: exam.ids.length,
      rate: Math.round((correct / exam.ids.length) * 100),
      domains,
    });
    save(state);
  }
  async function request(path, body) {
    const state = read();
    if (path === '/catalog') return { questions: await list() };
    if (path.startsWith('/questions/')) return question(path.slice(11));
    if (path === '/history') return state;
    if (path === '/review') {
      const stats = {};
      const domains = {};
      const questions = await list();
      for (const a of state.answers) {
        const s = (stats[a.question_id] ||= { wrong: 0, last: 0 });
        if (!a.correct) s.wrong++;
        s.last = Date.parse(a.created_at);
        const q = questions.find((q) => q.id === a.question_id);
        if (q) {
          const d = (domains[q.domain] ||= { n: 0, c: 0 });
          d.n++;
          d.c += Number(a.correct);
        }
      }
      return {
        questions: questions
          .filter(
            (q) =>
              stats[q.id]?.wrong ||
              (domains[q.domain] && domains[q.domain].c / domains[q.domain].n < 0.6),
          )
          .sort(
            (a, b) =>
              (stats[b.id]?.wrong || 0) - (stats[a.id]?.wrong || 0) ||
              (stats[a.id]?.last || 0) - (stats[b.id]?.last || 0),
          ),
      };
    }
    if (path === '/answers') {
      validateChoice(body.selected);
      if (!(await list()).some((q) => q.id === body.question_id))
        throw Error('問題が見つかりません');
      const result = await solution(body.question_id);
      const previous = state.answers.find((a) => a.id === body.id);
      if (
        previous &&
        (previous.question_id !== body.question_id || previous.selected !== body.selected)
      )
        throw Error('回答IDが競合しました');
      if (!previous) {
        state.answers.push({
          ...body,
          correct: body.selected === result.answer,
          created_at: stamp(),
        });
        save(state);
      }
      return { ...result, correct: body.selected === result.answer };
    }
    if (path === '/days/complete') {
      const expected = state.days.length + 1;
      if (body.day !== expected || expected > 14) throw Error('未完了の学習から進めてください');
      if (state.answers.length <= (state.days.at(-1)?.answeredThrough || 0))
        throw Error('学習後に完了してください');
      state.days.push({
        day: body.day,
        completed_at: stamp(),
        answeredThrough: state.answers.length,
      });
      save(state);
      return { ok: true };
    }
    if (path === '/exams') {
      const active = state.exams.find((e) => e.status !== 'submitted');
      if (active) return { id: active.id };
      const questions = await list();
      if (questions.length < 100) throw Error('模試には100問が必要です');
      const ids = questions
        .map((q) => ({ id: q.id, r: crypto.getRandomValues(new Uint32Array(1))[0] }))
        .sort((a, b) => a.r - b.r)
        .slice(0, 100)
        .map((q) => q.id);
      const exam = {
        id: crypto.randomUUID(),
        ids,
        selections: {},
        split: !!body.split,
        remaining: 7200000,
        running_since: now(),
        status: 'running',
        created_at: stamp(),
      };
      state.exams.push(exam);
      save(state);
      return { id: exam.id };
    }
    const match = path.match(/^\/exams\/([^/]+)(?:\/(answer|submit|resume))?$/);
    if (match) {
      const exam = state.exams.find((e) => e.id === match[1]);
      if (!exam) throw Error('模試が見つかりません');
      let remaining = left(exam);
      if (
        exam.split &&
        exam.status === 'running' &&
        exam.remaining > 3600000 &&
        remaining <= 3600000
      ) {
        exam.status = 'paused';
        exam.remaining = remaining = 3600000;
        exam.running_since = null;
        save(state);
      }
      if (exam.status === 'running' && remaining <= 0) await finish(state, exam);
      const action = match[2];
      if (action === 'answer') {
        if (exam.status !== 'running') throw Error('回答受付時間外です');
        validateChoice(body.selected);
        if (!exam.ids.includes(body.question_id)) throw Error('問題が不正です');
        exam.selections[body.question_id] = body.selected;
        save(state);
        return { ok: true };
      }
      if (action === 'resume') {
        if (exam.status !== 'paused') throw Error('再開できません');
        exam.status = 'running';
        exam.running_since = now();
        save(state);
        return { ok: true };
      }
      if (action === 'submit' && exam.status !== 'submitted') await finish(state, exam);
      const questions = [];
      for (let start = 0; start < exam.ids.length; start += 6)
        questions.push(...(await Promise.all(exam.ids.slice(start, start + 6).map(question))));
      return {
        ...exam,
        remaining: left(exam),
        questions,
        result: exam.result ? JSON.parse(exam.result) : null,
      };
    }
    throw Error('利用できない操作です');
  }
  return request;
}
