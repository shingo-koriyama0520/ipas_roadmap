# 本番D1への2026年度98問登録

実施日: 2026-11-06。今回のユーザー指示に基づき、本番D1への登録まで実施した。

## 実施結果

| 項目 | 結果 |
| --- | --- |
| D1 | it-passport |
| データベースID | c5b85813-572f-4566-9bd8-05db723c4c77 |
| 登録前の問題数 | 0 |
| 登録後の問題数 | 98 |
| 年度 | 2026 |
| 問題番号 | 1〜100のうち9・29を除く98番号 |
| 問9・29の登録数 | 0 |
| ID重複 | 0 |
| 全カラムが投入データと一致 | 98問 |
| 人による承認済み | 0 |
| 公開条件を満たす問題 | 0 |
| スキーマ変更 | なし |
| 他テーブルの内容変更 | なし |
| 復元後のSQLite integrity_check | ok |
| 復元後の外部キー違反 | 0 |

すべて `status=needs_review`、`explanation_status=needs_review`、`reviewer=NULL`、`reviewed_at=NULL` で登録した。人による承認を付与していない。

実在するPagesプロジェクトは、以前の環境説明にあった `it-passport-14days` ではなく **ipas-roadmap**。
公開URLは https://ipas-roadmap.pages.dev 。Cloudflareから取得した本番設定で、バインディングDBの接続先IDが上記D1であることを確認した。
公開デプロイの元コミットは `ae0d13b` で、ローカルリポジトリのコミットと一致。設定変更・再デプロイは行っていない。

## バックアップと事前検証

登録前バックアップ: `.local/production-import-2026/before.sql`

SHA-256: `7d88a6228b38826ff24c75812662b6ea7cd52d11579caa40151a9e4bad382482`

バックアップをインメモリSQLiteへ復元し、整合性チェックを実施。登録前は問題・ユーザー・セッション・回答・進捗・試験がすべて0件、マイグレーション管理行が1件だった。
本番のsqlite_masterも読み取り、既存スキーマがアプリと一致し、トリガーがないことを確認した。

98問は既存の `selectMvpQuestions` で抽出。内容フィンガープリント・問題別と4選択肢別の根拠確認・未解決事項なし・人による承認未実施を確認した。
元の100問や品質判定データは変更していない。

既存の `generateSql` を使用し、INSERT SELECTとNOT EXISTSによる追加専用SQLを生成した。IDまたは年度・番号が存在する場合には追加せず、UPDATE・DELETE・REPLACE・DDLは実行しない。
復元したDBでSQLを2回実行しても98問のままであること、全カラムが一致すること、他テーブルが変わらないことを確認した。

登録SQL: `.local/production-import-2026/questions-98.sql`

SHA-256: `9fa42d1388a38d093363335a39ceaf0debe50e264e03eee3f52bf5ce9373f98e`

書き込み直前にも本番の問題数0件・トリガー不在を再確認した。

## 公開防止の確認

- 実際の本番サイトで、未認証の `/api/catalog`・`/api/review` は401。`/api/me` は未ログイン。開発用メール受信箱も未認証で利用できない。
- 公開中コミットそのもののAPIと公開判定コードを読み出し、復元DBに98問を入れた状態で認証済み学習者としてローカル実行した。
- この検証では一覧0問、復習0問、未承認問題への回答404、模試開始409となった。テスト用ユーザー・セッションはインメモリDBだけに作成し、本番には作成していない。
- 公開中APIは `status='published' AND explanation_status='publishable'` と `publishable()` の両方で問題を制限する。管理者APIにも未承認問題の本文を返す経路はない。
- 登録後も全98問が公開条件を満たさず、本番公開APIの未認証拒否を再確認した。

本番の実アカウントでログインして画面操作する検証は未実施。認証後の非公開判定は、公開中の実装と同じコードをローカルで実行した結果による。
したがって、**DB登録完了であり、一般利用者向けの学習開始・公開完了ではない**。公開画面で98問を学習できるようにする設定変更は行っていない。

## 実行コマンド

Cloudflare公式の[インポート・エクスポート手順](https://developers.cloudflare.com/d1/best-practices/import-export-data/)に従い、プロジェクトのWranglerを使用した。

```powershell
node_modules/.bin/wrangler.cmd d1 info it-passport --json
node_modules/.bin/wrangler.cmd d1 export it-passport --remote --output .local/production-import-2026/before.sql
node .local/production-import-2026/preflight.mjs
node_modules/.bin/wrangler.cmd d1 execute it-passport --remote --file .local/production-import-2026/questions-98.sql --json
node_modules/.bin/wrangler.cmd d1 export it-passport --remote --output .local/production-import-2026/after.sql
node .local/production-import-2026/postflight.mjs
```

登録SQLの本番実行は1回。登録後は全問SELECTとエクスポートを使って検証した。再実行の検証はローカルだけで行った。
Wranglerの書込メトリクスにはインデックス等も含まれるため、登録件数はメトリクスではなく実際のquestions行数と全件比較で確定した。

## 保存した証跡

すべて `.local/production-import-2026/` に保存し、Git管理対象外であることを確認済み。

- `before.sql` / `after.sql`: 登録前後のDBエクスポート。
- `before-inspection.json` / `immediate-before.json`: スキーマ・登録前件数・直前確認。
- `selected-98.json` / `questions-98.sql`: 対象98問と実行SQL。
- `preflight.json`: バックアップ復元、再実行、公開ゲートの検証結果。
- `import-result.json`: 本番SQL実行結果。
- `after-inspection.json` / `postflight.json`: 全問読み戻しと全カラム一致、他テーブル・スキーマ保全の検証結果。
- `public-check.json`: 実サイトの未認証アクセス確認結果。

GitHubへのcommit・pushや、問題原文・正答・SQLの公開は行っていない。

## 未実施・残作業

- 人による98問の承認、および本番画面で学習を許可するための運用判断。
- 本番ログイン後の画面操作、実メール配送、回答・進捗保存の確認。
- 問9・29の対応、他年度への展開。

今回はアプリの実装コードを変更していない。登録に関する実データ検証はすべて成功。前回MVPで実行した30件のテストと14学習単位のブラウザー検証は今回の本番画面の動作確認には数えていない。
