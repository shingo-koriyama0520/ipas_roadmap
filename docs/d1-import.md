# D1への問題データ投入

2026年11月5日の実環境調査では、Pages名は `ipas-roadmap`、URLは
`https://ipas-roadmap.pages.dev/` でした。`wrangler.toml` の `name` と依頼にある
`it-passport-14days` ではPagesプロジェクトは見つかりませんでした。
本番D1 `it-passport` のIDは `c5b85813-572f-4566-9bd8-05db723c4c77` と一致し、
`0001_init.sql` 適用済み、問題・利用者・回答・完了日・模試は各0件でした。
本番へのデータ投入は未実施です。

## 安全性と入力

`npm run db:validate` は入力を検証するだけでDBを変更しません。
`npm run db:import -- --input <JSON>` はローカルSQLiteへの登録とSQL生成のみを行います。
本番D1へ接続する処理はありません。

入力は構造化済み問題のJSON配列です。必須項目は以下です。

- `id`: `2026-001` のような年度・3桁番号。年度2021〜2026、番号1〜100。
- `year`, `number`, `prompt`, 4要素の文字列配列 `choices`。
- `answer`: 0〜3（ア〜エ）。`official_answer` があれば対応する記号と一致。
- `domain`: ストラテジ／マネジメント／テクノロジ。
- `status`: needs_review／draft／verified／published。
- `explanation_status`: not_generated／generated／needs_review／verified／publishable。
- `explanation`: `answer`、4要素の `reasons`、用語配列 `terms`、文字列 `point`。
- 公開時は `reviewer` と有効な日時 `reviewed_at`、公開可能な解説が必要。
- 任意の `source` オブジェクト、`issues` 文字列配列。

1件でも不正な入力があれば全体を停止します。未構造化のOCR原文は投入できません。
空入力も停止します。年度別の100問充足は検証報告で別途確認します。

## ローカル準備

```powershell
npm ci
npm test
npm run check
npm run db:validate -- --input data/questions-reviewed.json
npm run db:import -- --input data/questions-reviewed.json
```

出力は `.local/import/<入力SHA-256>/` の `validation.json` と `questions.sql`。
不正入力では報告だけを出し、SQLを生成しません。
既存ローカルDBはVACUUM INTOでバックアップします。
ローカルの既存問題と完全一致すればスキップし、内容衝突なら全件ロールバックします。
生成SQLはインメモリSQLiteで2回実行し、件数・外部キーを検証します。
生成SQLはIDまたは年度・番号が既存なら追加しません。既存内容の更新・削除は行いません。
このため既存問題を修正する用途には使えません。

## 本番前の読み取り・バックアップ

`wrangler.toml` のDB名・IDと、Cloudflareから取得した実体を一致させます。

```powershell
npx wrangler d1 info it-passport --json
npx wrangler d1 execute it-passport --remote --command "SELECT COUNT(*) FROM questions; SELECT year, COUNT(*) FROM questions GROUP BY year; SELECT status, explanation_status, COUNT(*) FROM questions GROUP BY status, explanation_status;" --json
npx wrangler d1 export it-passport --remote --output .local/backups/it-passport-before-import.sql
```

バックアップを一時SQLiteへ復元し、integrity_check・foreign_key_checkと件数を確認します。
バックアップのSHA-256を記録し、投入SQLをその復元DBへ2回適用して既存データが維持されることを確認します。
投入直前に本番件数・問題内容の衝突を再確認してください。
同一IDの内容が異なる場合はSQLを実行せず、修正方針を決めてください。

## 承認後のみ実行

有効な入力・SQL・バックアップ・対象ID・予定追加件数・衝突なしを報告し、ユーザー承認後に実行します。

```powershell
npx wrangler d1 execute it-passport --remote --file .local/import/<承認対象の入力SHA-256>/questions.sql
```

現状データが検証失敗なら、上記は実行可能なコマンドではありません。
承認前には本番でINSERT／UPDATE／DELETEを実行しません。

## 投入後の検証

- 総件数、年度別件数、重複ID・年度番号、外部キー整合性を照合。
- APIの公開可能数はステータス集計だけでなく `publishable()` と一致することを確認。
- テストアカウントでメールログイン、問題取得、正誤判定、履歴再取得を確認。
- 未完了の学習日を繰り越せること、模試100問と時間管理、管理者以外のアクセス拒否を確認。

本番ログイン・回答は認証データや学習履歴を書き込むため、承認前の読み取り確認には含めません。
本番メール送信サービスと環境変数は別途設定が必要です。

## Git管理

過去問、解答、元データ、生成SQL、バックアップ、認証情報はコミットしません。
`.gitignore` は既存履歴からファイルを消す機能を持ちません。以前公開したデータの履歴削除は別作業です。
