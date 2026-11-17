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
