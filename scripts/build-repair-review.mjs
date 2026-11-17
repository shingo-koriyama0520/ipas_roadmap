// Local, read-only review packet. Never copy its output into public/ or Git.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const rows = JSON.parse(readFileSync('data/repair/2026/questions-repaired.json', 'utf8'));
const quality = existsSync('data/repair/2026/quality-report.json')
  ? JSON.parse(readFileSync('data/repair/2026/quality-report.json', 'utf8'))
  : null;
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>2026年度100問 修復データ確認票</title>
<style>body{font-family:Meiryo,sans-serif;margin:25px;background:#f4f6f3;color:#243b34}header{max-width:1400px;margin:auto}nav{display:flex;gap:8px;flex-wrap:wrap}a{color:#206b59}section{background:white;max-width:1400px;margin:24px auto;padding:24px;border:1px solid #ccd8ce;border-radius:12px}section .pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}img{width:100%;height:auto;border:1px solid #ddd}pre{font-family:inherit;white-space:pre-wrap;line-height:1.8}li{line-height:1.8;margin:12px 0}label{display:block;margin:12px 0}.warning{padding:18px;background:#fff4d7}small{color:#687b70}@media(max-width:850px){section .pair{grid-template-columns:1fr}}@media print{section{break-before:page}nav{display:none}}</style>
<header><h1>2026年度100問：原本・修復結果・AI解説の確認票</h1><p class="warning">全問「要確認」です。原本画像とのAI照合と形式検証は実施しましたが、人による校正・解説確認は未実施です。このページのチェック操作はDB・JSONを更新しません。印刷または別途レビュー記録に確認者と日時を残してください。</p><nav>${rows.map((q) => `<a href="#q${q.number}">${q.number}</a>`).join(' ')}</nav></header>
${rows.map((q) => `<section id="q${q.number}"><h2>問${q.number}　${escape(q.domain)}　正答：${'アイウエ'[q.answer]}</h2><small>原本PDF ${escape(q.source.question_pdf)} / ページ${q.source.page}。表のセル境界・下線・空欄は文字で明記している問題があります。</small><div class="pair"><div><h3>原本からの切出し</h3><a href="crops/q${String(q.number).padStart(3, '0')}.png"><img loading="lazy" src="crops/q${String(q.number).padStart(3, '0')}.png" alt="問${q.number} 原本画像"></a></div><div><h3>修復した問題文</h3><pre>${escape(q.prompt)}</pre><ol>${q.choices.map((c, i) => `<li><b>${'アイウエ'[i]}</b> ${escape(c)}</li>`).join('')}</ol><h3>AI生成の解説（人による確認待ち）</h3><ol>${q.explanation.reasons.map((r, i) => `<li><b>${'アイウエ'[i]}</b> ${escape(r)}</li>`).join('')}</ol><p>重要用語：${q.explanation.terms.map(escape).join('・')}</p><p>覚えるポイント：${escape(q.explanation.point)}</p><label><input type="checkbox"> 原本と問題文・4選択肢の対応を確認</label><label><input type="checkbox"> 公式正答と解説4件の理由を確認</label><label><input type="checkbox"> 表・数式・コードの意味と表示を確認</label><p>確認者：________________　確認日：________________</p><p>修正・留意事項：________________________________________________</p></div></div></section>`).join('\n')}</html>`;
mkdirSync('.local/repair/2026', { recursive: true });
// Keep the readable HTML and the detailed Markdown review linked without making
// checkbox clicks look like saved or approved reviews.
const qualityLinks = quality
  ? `<p class="warning"><a href="review.md">最終品質レビューMarkdown</a>：原本AI照合 ${quality.summary.sourceComparedByAI}問、解説の根拠確認完了 ${quality.summary.explanationEvidenceComplete}問、人の承認 ${quality.summary.humanApproved}問。</p>`
  : '';
let output = html.replace('<nav>', `${qualityLinks}<nav>`);
for (const q of rows) {
  const r = quality?.records.find((r) => r.id === q.id);
  const link = `<p><a href="../../../過去問/2026r08_ip_qs.pdf#page=${q.source.page}">ローカル原本PDF・ページ${q.source.page}</a> ／ <a href="../../../解答/2026r08_ip_ans.pdf#page=1">ローカル公式解答</a></p><p>本番公開可能な画像URL：未設定。sources/ は提供ZIP内の参照名です。</p>`;
  const notes = r
    ? `<p>自動検証：${escape(r.automatic)} ／ 解説：${escape(r.ai.explanation)} ／ 人の承認：未実施</p><p>今回の修正：${escape(r.ai.changes.join(' ／ ') || 'なし')}</p><p>未解決：${escape([...r.ai.unresolved, '人による内容承認が未実施'].join(' ／ '))}</p>`
    : '';
  output = output.replace(
    `<section id="q${q.number}">`,
    `<section id="q${q.number}">${link}${notes}`,
  );
}
writeFileSync('.local/repair/2026/review.html', output);
console.log('Created .local/repair/2026/review.html (local only)');
