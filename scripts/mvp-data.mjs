import { validateQuestions } from '../lib/importer.mjs';
import { contentFingerprint } from '../lib/question-quality.mjs';

// Validation-only eligibility. Never assigns publication or human approval.
export function selectMvpQuestions(rows, decisions) {
  const validation = validateQuestions(rows);
  if (validation.rejected.length || rows.length !== 100)
    throw new Error('MVP input must contain 100 valid review records');
  const selected = rows.filter((q) => q.year === 2026 && ![9, 29].includes(q.number));
  if (selected.length !== 98) throw new Error('MVP requires exactly 98 eligible questions');
  for (const q of selected) {
    const review = decisions.records.find((r) => r.id === q.id);
    if (
      q.status !== 'needs_review' ||
      q.explanation_status !== 'needs_review' ||
      q.reviewer !== null ||
      q.reviewed_at !== null ||
      review?.fingerprint !== contentFingerprint(q) ||
      review?.source !== 'matched_ai_visual' ||
      review?.explanation !== 'evidence_checked' ||
      review?.unresolved?.length !== 0 ||
      review?.choiceReviews?.length !== 4 ||
      review.choiceReviews.some((r) => r.status !== 'evidence_checked') ||
      review?.human?.status !== 'pending' ||
      review.human.reviewer !== null ||
      review.human.reviewed_at !== null
    )
      throw new Error(`MVP evidence is missing, stale or unexpectedly approved: ${q.id}`);
  }
  return selected;
}
