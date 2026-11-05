import { publishable } from './domain.mjs';

export const columns = [
  'id',
  'year',
  'number',
  'prompt',
  'choices',
  'answer',
  'domain',
  'status',
  'explanation_status',
  'explanation',
  'reviewer',
  'reviewed_at',
  'source',
  'issues',
];
const nonempty = (value) => typeof value === 'string' && !!value.trim();
const domains = ['ストラテジ', 'マネジメント', 'テクノロジ'];
const statuses = ['needs_review', 'draft', 'verified', 'published'];
const explanationStatuses = [
  'not_generated',
  'generated',
  'needs_review',
  'verified',
  'publishable',
];

export function validateQuestions(rows) {
  if (!Array.isArray(rows)) throw new Error('Input must be a JSON array of structured questions');
  const ids = new Map(),
    identities = new Map();
  for (const q of rows) {
    if (!q || typeof q !== 'object' || Array.isArray(q)) continue;
    ids.set(q.id, (ids.get(q.id) || 0) + 1);
    const identity = `${q.year}-${q.number}`;
    identities.set(identity, (identities.get(identity) || 0) + 1);
  }
  const accepted = [],
    rejected = [],
    years = {},
    issues = {};
  rows.forEach((q, index) => {
    const errors = [];
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      rejected.push({ index, errors: ['invalid_record'] });
      return;
    }
    const expectedId = `${q.year}-${String(q.number).padStart(3, '0')}`;
    if (!Number.isInteger(q.year) || q.year < 2021 || q.year > 2026) errors.push('invalid_year');
    if (!Number.isInteger(q.number) || q.number < 1 || q.number > 100)
      errors.push('invalid_number');
    if (q.id !== expectedId) errors.push('id_year_number_mismatch');
    if (ids.get(q.id) > 1) errors.push('duplicate_id');
    if (identities.get(`${q.year}-${q.number}`) > 1) errors.push('duplicate_year_number');
    if (!nonempty(q.prompt)) errors.push('missing_prompt');
    if (!Array.isArray(q.choices) || q.choices.length !== 4 || !q.choices.every(nonempty))
      errors.push('invalid_choices');
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) errors.push('invalid_answer');
    if (q.official_answer !== undefined && q.official_answer !== 'アイウエ'[q.answer])
      errors.push('official_answer_mismatch');
    if (!domains.includes(q.domain)) errors.push('invalid_domain');
    if (!statuses.includes(q.status)) errors.push('invalid_status');
    if (!explanationStatuses.includes(q.explanation_status))
      errors.push('invalid_explanation_status');
    const e = q.explanation;
    if (
      !e ||
      typeof e !== 'object' ||
      Array.isArray(e) ||
      e.answer !== q.answer ||
      !Array.isArray(e.reasons) ||
      e.reasons.length !== 4 ||
      !e.reasons.every(nonempty) ||
      !Array.isArray(e.terms) ||
      !e.terms.length ||
      !e.terms.every(nonempty) ||
      !nonempty(e.point)
    )
      errors.push('invalid_explanation');
    if (q.status === 'published' && !publishable(q))
      errors.push('publication_requirements_not_met');
    if (q.issues !== undefined && (!Array.isArray(q.issues) || !q.issues.every(nonempty)))
      errors.push('invalid_issues');
    for (const code of errors) issues[code] = (issues[code] || 0) + 1;
    years[q.year] = (years[q.year] || 0) + 1;
    if (errors.length) rejected.push({ index, id: q.id, errors });
    else accepted.push(q);
  });
  return {
    accepted,
    rejected,
    summary: {
      total: rows.length,
      accepted: accepted.length,
      rejected: rejected.length,
      publishable: accepted.filter(publishable).length,
      years,
      issues,
    },
  };
}

export function values(q) {
  return [
    q.id,
    q.year,
    q.number,
    q.prompt,
    JSON.stringify(q.choices),
    q.answer,
    q.domain,
    q.status,
    q.explanation_status,
    JSON.stringify(q.explanation),
    q.reviewer || null,
    q.reviewed_at || null,
    JSON.stringify(
      q.source || {
        question_pdf: q.question_pdf,
        page: q.page,
        answer_pdf: q.answer_pdf,
        answer_page: q.answer_page,
      },
    ),
    JSON.stringify(q.issues || []),
  ];
}
const quote = (value) =>
  value === null
    ? 'NULL'
    : typeof value === 'number'
      ? String(value)
      : "'" + value.replaceAll("'", "''") + "'";
function assertValid(rows) {
  const checked = validateQuestions(rows);
  if (checked.rejected.length || !rows.length) throw new Error('Invalid or empty import input');
}
export function generateSql(rows) {
  assertValid(rows);
  return (
    '-- Insert only. Existing IDs or year/number pairs are never overwritten.\n' +
    rows
      .map((q) => {
        const v = values(q);
        return `INSERT INTO questions (${columns.join(', ')}) SELECT ${v.map(quote).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM questions WHERE id = ${quote(q.id)} OR (year = ${q.year} AND number = ${q.number}));`;
      })
      .join('\n') +
    '\n'
  );
}
export function importQuestions(db, rows) {
  assertValid(rows);
  let inserted = 0,
    skipped = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const q of rows) {
      const previous = db
        .prepare('SELECT * FROM questions WHERE id=? OR (year=? AND number=?)')
        .all(q.id, q.year, q.number);
      if (previous.length) {
        const v = values(q);
        if (previous.length !== 1 || columns.some((key, i) => previous[0][key] !== v[i]))
          throw new Error(`Existing data conflict: ${q.id}. No rows were changed.`);
        skipped++;
      } else {
        db.prepare(
          `INSERT INTO questions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        ).run(...values(q));
        inserted++;
      }
    }
    db.exec('COMMIT');
    return { inserted, skipped, total: db.prepare('SELECT COUNT(*) AS n FROM questions').get().n };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
