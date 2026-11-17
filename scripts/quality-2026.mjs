// Local QA only: no DB connection, SQL generation, publishing or human approval updates.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { extractAnswerKey } from './verify-repair.mjs';
import {
  checkCoverage,
  contentFingerprint,
  qualityClassification,
} from '../lib/question-quality.mjs';

export function buildQualityReport(rows, reviews, key, options = {}) {
  const errors = checkCoverage(rows, key, options);
  const reviewIds = new Set(reviews.map((r) => r.id));
  if (reviews.length !== rows.length || reviewIds.size !== rows.length)
    errors.push({ code: 'review_coverage_mismatch' });
  const records = rows.map((q) => {
    const review = reviews.find((r) => r.id === q.id);
    if (!review || review.fingerprint !== contentFingerprint(q))
      errors.push({ id: q.id, code: 'missing_or_stale_review' });
    if (
      !review?.choiceReviews ||
      review.choiceReviews.length !== 4 ||
      review.choiceReviews.some((r, i) => r.symbol !== 'アイウエ'[i] || !r.note?.trim())
    )
      errors.push({ id: q.id, code: 'incomplete_choice_review' });
    if (review?.auditVersion === 2) {
      const evidence = review.evidence || [];
      const choices = review.choiceReviews || [];
      const validEvidence = (choice) =>
        choice.status === 'evidence_checked' &&
        Boolean(choice.method?.trim()) &&
        Array.isArray(choice.evidenceRefs) &&
        choice.evidenceRefs.length > 0 &&
        choice.evidenceRefs.every((index) => {
          const source = Number.isInteger(index) && evidence[index];
          return source?.supports?.trim() && source.access?.trim() && (source.url || source.local);
        });
      if (choices.some((choice) => choice.status === 'evidence_checked' && !validEvidence(choice)))
        errors.push({ id: q.id, code: 'missing_choice_evidence' });
      const complete = choices.length === 4 && choices.every(validEvidence);
      if (
        (review.explanation === 'evidence_checked') !== complete ||
        (complete && review.unresolved?.length)
      )
        errors.push({ id: q.id, code: 'inconsistent_evidence_decision' });
    }
    // This audit must not introduce or silently accept a fabricated approval.
    if (
      q.reviewer !== null ||
      q.reviewed_at !== null ||
      review?.human?.status !== 'pending' ||
      review?.human?.reviewer !== null ||
      review?.human?.reviewed_at !== null ||
      q.status !== 'needs_review' ||
      q.explanation_status !== 'needs_review'
    )
      errors.push({ id: q.id, code: 'unexpected_approval' });
    const automaticPassed = !errors.some((e) => !e.id || e.id === q.id);
    return {
      id: q.id,
      number: q.number,
      automatic: automaticPassed ? 'passed' : 'failed',
      ai: review || null,
      classification: qualityClassification(q, review, automaticPassed),
    };
  });
  // Global or late errors must affect all relevant records, irrespective of input order.
  for (const r of records) {
    if (errors.some((e) => !e.id || e.id === r.id)) {
      r.automatic = 'failed';
      if (r.classification === '公開可能') r.classification = '要確認';
    }
  }
  return {
    errors,
    records,
    summary: {
      total: rows.length,
      sourceComparedByAI: records.filter((r) => r.ai?.source === 'matched_ai_visual').length,
      officialAnswerMatched: rows.filter(
        (q) =>
          key.get(q.number) === q.official_answer && key.get(q.number) === 'アイウエ'[q.answer],
      ).length,
      explanationsReadByAI: records.filter((r) => r.ai?.choiceReviews?.length === 4).length,
      explanationEvidenceComplete: records.filter(
        (r) => r.automatic === 'passed' && r.ai?.explanation === 'evidence_checked',
      ).length,
      humanApproved: records.filter((r) => r.ai?.human?.status === 'approved').length,
      modifiedQuestions: records.filter((r) => r.ai?.changes?.length).length,
      classifications: Object.fromEntries(
        ['公開可能', '要確認', '公開不可'].map((c) => [
          c,
          records.filter((r) => r.classification === c).length,
        ]),
      ),
    },
  };
}

function main() {
  const args = process.argv.slice(2);
  const options = { year: 2026, start: 1, end: 100, strategyEnd: 34, managementEnd: 54 };
  const paths = {};
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--summary-only') paths.summaryOnly = true;
    else if (
      ['--year', '--start', '--end', '--strategy-end', '--management-end'].includes(name) &&
      args[i + 1]
    ) {
      const key = name.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      options[key] = Number(args[++i]);
    } else if (
      ['--input', '--reviews', '--answers', '--out', '--review-output'].includes(name) &&
      args[i + 1]
    )
      paths[name.slice(2)] = args[++i];
    else throw Error(`Unknown or missing argument: ${name}`);
  }
  if (
    options.year !== 2026 &&
    (!args.includes('--strategy-end') || !args.includes('--management-end'))
  )
    throw Error('Confirm booklet boundaries for this year');
  if (!(
    Number.isInteger(options.year) &&
    options.year >= 2021 &&
    options.year <= 2026 &&
    options.start >= 1 &&
    options.start <= options.end &&
    options.end <= 100 &&
    options.strategyEnd > 0 &&
    options.strategyEnd < options.managementEnd &&
    options.managementEnd < 100
  ))
    throw Error('Invalid year or range');
  const year = options.year;
  const folder = `data/repair/${year}`;
  const input = paths.input || `${folder}/questions-repaired.json`;
  const out = paths.out || `${folder}/quality-report.json`;
  const reviewOutput = paths['review-output'] || `.local/repair/${year}/review.md`;
  for (const output of [out, reviewOutput]) {
    const absolute = resolve(output);
    if (
      ![resolve(`data/repair/${year}`), resolve(`.local/repair/${year}`)].some((root) =>
        absolute.startsWith(root + sep),
      )
    )
      throw Error('Output must stay in this year private directory');
  }
  const rows = JSON.parse(readFileSync(input, 'utf8')).filter(
    (q) => q.number >= options.start && q.number <= options.end,
  );
  const decisions = JSON.parse(
    readFileSync(paths.reviews || `${folder}/quality-decisions.json`, 'utf8'),
  );
  const reviews = decisions.records.filter((r) => rows.some((q) => q.id === r.id));
  const items = JSON.parse(
    readFileSync(paths.answers || `.local/repair/${year}/answers/extracted-text.json`, 'utf8'),
  )[0].items;
  const report = buildQualityReport(rows, reviews, extractAnswerKey(items), options);
  report.inputSha256 = createHash('sha256').update(readFileSync(input)).digest('hex');
  report.method = decisions.method;
  report.sourceHashes = decisions.sourceHashes;
  for (const [path, expected] of Object.entries(report.sourceHashes)) {
    if (
      !existsSync(path) ||
      createHash('sha256').update(readFileSync(path)).digest('hex') !== expected
    )
      report.errors.push({ code: 'source_hash_mismatch', path });
  }
  if (paths.summaryOnly) {
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report.summary, errorCount: report.errors.length }, null, 2));
    if (report.errors.length) process.exitCode = 1;
    return;
  }
  const sections = rows.map((q) => {
    const r = report.records.find((r) => r.id === q.id);
    const a = r.ai;
    const source = `../../../過去問/${q.source.question_pdf.split('/').at(-1)}#page=${q.source.page}`;
    const answerSource = `../../../解答/${q.source.answer_pdf.split('/').at(-1)}#page=${q.source.answer_page}`;
    return (
      `## 問${q.number}\n\n` +
      `分野：${q.domain}系 ／ 公式正答：${q.official_answer} ／ 判定：${r.classification}\n\n` +
      `### 問題文\n\n\`\`\`text\n${q.prompt}\n\`\`\`\n\n### 選択肢と解説\n\n` +
      q.choices
        .map(
          (c, i) =>
            `**${'アイウエ'[i]}** ${c}\n\n解説：${q.explanation.reasons[i]}\n\nAI確認：${a.choiceReviews[i].status} — ${a.choiceReviews[i].note}` +
            (a.choiceReviews[i].method
              ? `\n\n確認方法：${a.choiceReviews[i].method} ／ 根拠番号：${a.choiceReviews[i].evidenceRefs.map((index) => index + 1).join('、') || '未確定'}`
              : ''),
        )
        .join('\n\n') +
      `\n\n重要用語：${q.explanation.terms.join('、')}\n\n覚えるポイント：${q.explanation.point}\n\n` +
      `### 原本参照\n\n[問題PDF・ファイルページ${q.source.page}](<${source}>) ／ [切り出し画像](crops/q${String(q.number).padStart(3, '0')}.png) ／ [解答PDF・ページ${q.source.answer_page}](<${answerSource}>)\n\n` +
      `原本位置：${JSON.stringify(q.source.regions)}\n\n` +
      `上記リンクはローカル専用。本番公開可能な画像URL：未設定（配信先・再配布条件の確認待ち）。source内のsources/は提供ZIP内の参照名であり、本番URLではない。\n\n` +
      `### 検証結果\n\n自動検証：${r.automatic} ／ 原本：${a.source} ／ 解説：${a.explanation}\n\n` +
      `原本照合の範囲：${a.sourceNote}\n\n` +
      `人の承認：pending ／ 確認者：未設定 ／ 確認日時：未設定\n\n` +
      `根拠：${a.evidence.length ? a.evidence.map((e, index) => `${index + 1}. ` + (e.url ? `[${e.supports}](${e.url})（${e.access}）` : e.supports)).join(' ／ ') : '原本・公式解答とのAI意味照合。外部資料による独立した裏付けは未完了。'}\n\n` +
      `修正内容：${a.changes.join(' ／ ') || '今回の本文・選択肢・解説の修正なし。'}\n\n` +
      `未解決事項：${[...a.unresolved, '人による本文・解説の承認が未実施。'].join(' ／ ')}\n\n` +
      `照合対象フィンガープリント：\`${a.fingerprint}\`\n`
    );
  });
  const header =
    `# ${year}年度${rows.length}問 最終品質レビュー（ローカル専用）\n\n` +
    `集計：\n\n\`\`\`json\n${JSON.stringify(report.summary, null, 2)}\n\`\`\`\n\n` +
    `AIによる照合は人の承認ではありません。「解説検証完了」は4選択肢の理由を再計算または参照した一次資料で裏付けた問題のみを数えます。AIが矛盾を見つけなかっただけの問題は含めません。原本照合では空白・句読点・改行・括弧の字体を正規化し、表・コードは意味を保つテキスト表現と比較しています。画像のピクセル一致や人による逐字校正を意味しません。\n\n` +
    `原本の取得・照合範囲は各問題とsourceHashesを参照してください。人による承認とAI確認は別状態です。本番DBは変更していません。入力SHA-256：\`${report.inputSha256}\`\n\n`;
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(reviewOutput, header + sections.join('\n'));
  console.log(JSON.stringify({ ...report.summary, errors: report.errors }, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
