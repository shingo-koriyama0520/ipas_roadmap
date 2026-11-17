# 教材のソース参照

確認日：2026-11-12。ワークスペース内のファイルを読み、旧認証版整理後の構成を採用。

## 調査範囲

ルートのREADME・AGENTS.mdは見つからなかった。package.json、public/、functions/、lib/、migrations/、scripts/、tests/、docs/、wrangler.tomlを確認した。data/・.local/の問題内容や既存DBは教材へ転載していない。

## 実ファイルと参照箇所

| ファイル・行 | 確認内容 | 使用スライド |
| --- | --- | --- |
| `package.json:1-23` | 実行・テスト・構文チェックの定義 | 05, 11 |
| `public/index.html:1-12` | HTMLからCSSとapp.jsを読み込む | 05 |
| `public/style.css:1-55` | 画面の配色・レイアウト | 05 |
| `public/app.js:1-4` | createLearningClient(localStorage)を利用 | 05, 06 |
| `public/learning.mjs:1-38` | 履歴保存キー、ブラウザ保存、GETによるAPI取得 | 05, 06, 09 |
| `public/learning.mjs:87-145` | 画面の操作と履歴処理。/answersはローカル処理 | 09, 11 |
| `functions/api/[[path]].js:1-2` | 公開APIの入口はhandlePublic | 06, 10 |
| `lib/public-api.mjs:3-16` | GET以外は405、学習利用の対象条件 | 06, 09 |
| `lib/public-api.mjs:18-28` | 目録はid・year・number・domain等を返す | 09, 10 |
| `lib/public-api.mjs:29-40` | 単問・正答解説の取得。SQLのbind、JSON変換 | 06, 09, 10 |
| `migrations/0001_init.sql:1-10` | 8テーブルと主キー・外部キーの定義 | 07, 08 |
| `wrangler.toml:1-9` | public配信、D1のDBバインディング、migration配置 | 06 |
| `scripts/dev.mjs:1-21` | 公開APIを使用。起動時にローカルDBを作成・初期化するため読取専用調査では実行しない | 08 |
| `tests/public.test.mjs:1-62` | 合成データ・メモリ内DB・SELECTだけ許可するAPIテスト環境 | 08, 10, 11 |
| `tests/public.test.mjs:64-95` | 公開範囲と書込メソッド拒否 | 09, 10 |
| `tests/public.test.mjs:97-172` | ブラウザ保存・再読込・保存失敗等 | 11, 14 |
| `tests/public.test.mjs:174-260` | 旧98問履歴の維持・2年度200問の合成データ検証 | 11, 14 |
| `lib/domain.mjs:1-35` | 取込・品質検査に必要なpublishable判定を維持 | 講師補足 |
| `lib/importer.mjs:1-55` | 問題の検証・取込処理。制作中は実行しない | 講師補足 |
| `docs/public-mvp.md:1-26` | 現行公開版の構成説明（実装と照合） | 05, 06 |
| `docs/auth-removal.md:1-10` | 制作途中のユーザー追加依頼による旧認証版整理 | 講師補足 |

## 確認したAPI

| メソッド・パス | 応答 |
| --- | --- |
| GET /api/catalog | questions、count、contentApproval: pending、learningAvailable: true |
| GET /api/questions/2026-001 | id・year・number・domain・prompt・choices |
| GET /api/questions/2026-001/solution | answer・explanation |

IDは2025または2026年度の3桁番号。実装の対象条件は1〜100、ID形式一致、問題・解説ともneeds_review、reviewer・reviewed_atはNULL。GET以外は405、対象外パス・未該当問題は404。実サイトを呼び出して確認したものではない。

## DBとブラウザ保存の区別

- スキーマ定義はusers、login_tokens、sessions、rate_limits、questions、answers、days、examsの8テーブル。
- 公開APIが参照するのはquestions。idが主キー。choices・explanationはTEXTで保存し、APIでJSONとして解釈する。
- answers.question_idからquestions.idへの参照は既存スキーマの外部キー例。公開版の履歴保存では未使用。
- 回答・進捗・模試結果はlocalStorageのipas-learning-v1へ保存し、D1へ書き込まない。
- 旧認証コードを削除しても既存DB・スキーマは変更していない。旧テーブルの削除や本番migrationは行っていない。

## 旧認証版の削除範囲

削除：lib/api.mjs、tests/app.test.mjs、docs/mvp-verification-report.md、docs/production-mvp-release-readiness.md。旧版専用のフォルダはソースツリーでは見つからなかったため、共通フォルダのlib/・tests/・docs/は維持。lib/domain.mjsはpublishableのみ残し、専用関数を除去。承認判定テストをtests/domain.test.mjsへ移し、tests/mvp.test.mjsのデータ選別テストは維持。package.jsonとscripts/dev.mjsの不要参照を除去。過去のリリース報告・.local/内の既存ログとバックアップ・DBは履歴として未変更。

## 検証結果と制限

- npm test：23件成功。テストは合成データのメモリ内DBおよびOS一時領域のテスト専用DBを使用。既存DB・本番DBは変更していない。
- npm run check、npm run format:check、git diff --check：成功。
- PowerPoint 16.0で生成・保存後、ファイルを再オープンし全15枚、960×540pt（16:9）を確認。
- PowerPointで全15ページを1600×900pxのPNGへ出力し、全ページの文字切れ・重なりを目視確認。表見出しと図の線を修正済み。テキスト枠の高さ超過は検出なし。
- PowerPointからプレビューPDFを出力。PDFのページ内容を別のPDFビューアーで確認する検証は未実施。
- 既存プロジェクトの依存関係は追加・更新していない。指定スキルのartifact-toolが利用できず、インストール済みPowerPointのCOMで編集可能なネイティブ図形・表・テキストとして生成した。
- アプリの起動・実ブラウザでの動作・本番API・本番デプロイは未実施。実DBの件数と未完成箇所の一覧は要確認。
