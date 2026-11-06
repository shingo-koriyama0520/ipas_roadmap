import { createHash } from 'node:crypto';
import { validateQuestions } from './importer.mjs';
import { publishable } from './domain.mjs';

// Bind a content review to exactly the text, answers and explanations that were read.
export function contentFingerprint(q) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        q.id,
        q.year,
        q.number,
        q.prompt,
        q.choices,
        q.answer,
        q.official_answer,
        q.domain,
        q.explanation,
        q.source,
      ]),
    )
    .digest('hex');
}

export function check2026Coverage(rows, answerKey) {
  const errors = validateQuestions(rows).rejected.flatMap((r) =>
    r.errors.map((code) => ({ id: r.id, code })),
  );
  const numbers = new Set(rows.map((q) => q.number));
  if (rows.length !== 100) errors.push({ code: 'expected_100_questions' });
  for (let n = 1; n <= 100; n++) {
    if (!numbers.has(n)) errors.push({ number: n, code: 'missing_number' });
    if (!answerKey.has(n)) errors.push({ number: n, code: 'missing_official_answer' });
  }
  if (answerKey.size !== 100) errors.push({ code: 'expected_100_official_answers' });
  for (const q of rows) {
    const expectedDomain =
      q.number <= 34 ? 'ストラテジ' : q.number <= 54 ? 'マネジメント' : 'テクノロジ';
    if (q.year !== 2026) errors.push({ id: q.id, code: 'wrong_year' });
    if (q.domain !== expectedDomain) errors.push({ id: q.id, code: 'domain_range_mismatch' });
    if (
      answerKey.get(q.number) !== q.official_answer ||
      answerKey.get(q.number) !== 'アイウエ'[q.answer]
    )
      errors.push({ id: q.id, code: 'answer_key_mismatch' });
    if (new Set(q.choices).size !== 4) errors.push({ id: q.id, code: 'duplicate_choices' });
    if (
      !q.source?.question_pdf ||
      !Number.isInteger(q.source?.page) ||
      q.source.page < 1 ||
      !q.source?.answer_pdf ||
      q.source?.answer_page !== 1
    )
      errors.push({ id: q.id, code: 'invalid_source_reference' });
  }
  return errors;
}

export function qualityClassification(q, review, automaticPassed) {
  if (
    !q.prompt?.trim() ||
    !Array.isArray(q.choices) ||
    q.choices.length !== 4 ||
    q.choices.some((c) => typeof c !== 'string' || !c.trim()) ||
    !Number.isInteger(q.answer) ||
    q.answer < 0 ||
    q.answer > 3
  )
    return '公開不可';
  if (
    automaticPassed &&
    review?.fingerprint === contentFingerprint(q) &&
    review.source === 'matched_ai_visual' &&
    review.explanation === 'evidence_checked' &&
    review.unresolved?.length === 0 &&
    review.human?.status === 'approved' &&
    review.human.reviewer === q.reviewer &&
    review.human.reviewed_at === q.reviewed_at &&
    publishable(q)
  )
    return '公開可能';
  return '要確認';
}
