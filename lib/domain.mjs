export const curriculum = [
  '初回診断・IT基礎',
  'コンピュータ・OS',
  'ネットワーク・データベース',
  '情報セキュリティ',
  '企業活動・法務',
  '経営戦略・システム戦略',
  'システム開発・プロジェクト管理',
  '3分野の総合演習',
  '苦手分野①',
  '苦手分野②',
  '過去問演習',
  '総合演習',
  '模擬試験',
  '最終復習・受験判定',
];
export function publishable(q) {
  let c, e;
  try {
    c = typeof q.choices === 'string' ? JSON.parse(q.choices) : q.choices;
    e = typeof q.explanation === 'string' ? JSON.parse(q.explanation) : q.explanation;
  } catch {
    return false;
  }
  return (
    q.status === 'published' &&
    q.explanation_status === 'publishable' &&
    typeof q.reviewer === 'string' &&
    !!q.reviewer.trim() &&
    typeof q.reviewed_at === 'string' &&
    Number.isFinite(Date.parse(q.reviewed_at)) &&
    typeof q.prompt === 'string' &&
    !!q.prompt.trim() &&
    ['ストラテジ', 'マネジメント', 'テクノロジ'].includes(q.domain) &&
    Array.isArray(c) &&
    c.length === 4 &&
    c.every((x) => typeof x === 'string' && x.trim()) &&
    Number.isInteger(q.answer) &&
    q.answer >= 0 &&
    q.answer < 4 &&
    e?.answer === q.answer &&
    Array.isArray(e.reasons) &&
    e.reasons.length === 4 &&
    e.reasons.every((x) => typeof x === 'string' && x.trim()) &&
    Array.isArray(e.terms) &&
    e.terms.length > 0 &&
    e.terms.every((term) => typeof term === 'string' && !!term.trim()) &&
    typeof e.point === 'string' &&
    !!e.point.trim()
  );
}
export function reviewQueue(questions, history) {
  const stats = {};
  for (const a of history) {
    const x = (stats[a.question_id] ??= { wrong: 0, correct: 0, last: 0 });
    a.correct ? x.correct++ : x.wrong++;
    x.last = Date.parse(a.created_at);
  }
  const ds = {};
  for (const a of history) {
    const q = questions.find((q) => q.id === a.question_id);
    if (q) {
      const d = (ds[q.domain] ??= { n: 0, c: 0 });
      d.n++;
      d.c += a.correct ? 1 : 0;
    }
  }
  return questions
    .filter((q) => stats[q.id]?.wrong || (ds[q.domain] && ds[q.domain].c / ds[q.domain].n < 0.6))
    .sort((a, b) => {
      const x = stats[a.id],
        y = stats[b.id];
      return (y?.wrong || 0) - (x?.wrong || 0) || (x?.last || 0) - (y?.last || 0);
    });
}
export function remaining(exam, now = Date.now()) {
  return Math.max(0, exam.remaining - (exam.running_since ? now - exam.running_since : 0));
}
export function score(questions, selections) {
  const domains = {};
  let correct = 0;
  for (const q of questions) {
    const ok = selections[q.id] === q.answer;
    correct += ok ? 1 : 0;
    const d = (domains[q.domain] ??= { correct: 0, total: 0 });
    d.total++;
    d.correct += ok ? 1 : 0;
  }
  return {
    correct,
    total: questions.length,
    rate: questions.length ? Math.round((correct / questions.length) * 100) : 0,
    domains,
  };
}
