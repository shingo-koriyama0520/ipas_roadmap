# このプログラムの構成とファイル配置

ITパスポートの問題演習・復習・14日間の進捗管理・100問模試を行うWebアプリです。
画面はHTMLとJavaScript、問題の取得はAPI、問題の保存はDBが担当します。

## 全体の流れ

```text
GitHub：ソースコードの管理・本番デプロイの元
                       ↓
             Cloudflare Pages：画面の配信

ブラウザ
  public/index.html     画面の土台
  public/style.css      見た目
  public/app.js         画面表示・操作
          ↓
  public/learning.mjs   問題取得・採点・進捗・模試の処理
          ├─ 学習履歴 → ブラウザのlocalStorageに保存
          └─ 問題・正解・解説 → HTTPでAPIへ
                                  ↓
  本番：functions/api/[[path]].js（Cloudflare Pages Functions）
  手元：scripts/dev.mjs（Node.jsのローカルサーバー）
                                  ↓
                lib/public-api.mjs（共通のAPI処理・SQL）
                                  ↓
  本番：Cloudflare D1 ／ 手元：.local/app.sqlite（SQLite）
```

GitHubは通常の問題取得を処理するサーバーではありません。
本番とローカルは同じAPI処理を使い、入口と接続先DBが異なります。

## どこに何があるか

| 場所 | 役割 |
|---|---|
| `public/index.html` | 最初に開くページ。アプリの画面の土台 |
| `public/app.js` | 学習・復習・成績・模試などの画面表示と操作 |
| `public/learning.mjs` | APIから問題を取得し、ブラウザ内で採点・履歴保存・模試管理を実行 |
| `public/style.css` | 画面の色・配置などのデザイン |
| `public/_headers` | Cloudflareで配信するときのHTTPヘッダー設定 |
| `functions/api/[[path]].js` | 本番の `/api/*` を受け付け、共通のAPI処理へ渡す入口 |
| `lib/public-api.mjs` | 問題一覧・問題・正解と解説をDBから取得してJSONで返す |
| `scripts/dev.mjs` | ローカルで画面とAPIを配信し、SQLiteをAPIから使える形につなぐ |
| `migrations/0001_init.sql` | DBのテーブル定義。中心は問題を保存する `questions` |
| `.local/app.sqlite` | 通常のローカル起動で使うDBファイル |
| `scripts/import.mjs` | 問題JSONの検証、ローカルDBへの登録、投入用SQLの生成 |
| `lib/importer.mjs` | 問題データの形式検証・登録処理の共通部分 |
| `lib/domain.mjs`、`lib/question-quality.mjs` | 公開可否や問題の品質確認に使う判定処理 |
| `data/` | 問題の入力JSON、修復済みデータ、品質確認の記録。Git管理対象外 |
| `.local/repair/2026/review.html` | 問題・解説を確認するためのローカル資料。学習画面とは別 |
| `scripts/repair_2026.py`、`scripts/quality-2026.mjs` など | 問題データの修復・検証・確認資料を作る補助ツール |
| `tests/` | API・問題登録・採点・履歴・模試などの自動テスト |
| `docs/` | 構成、公開手順、データ投入、品質確認などの説明 |
| `package.json` | 起動・テストなどのコマンドと必要なNode.jsのバージョン |
| `package-lock.json` | インストールする依存パッケージのバージョンを固定 |
| `wrangler.toml` | Cloudflareの配信フォルダーとD1接続設定 |

## APIと保存先

実際にサーバーへ送るAPIは、次の読み取り専用APIです。

| リクエスト例 | 返す内容 |
|---|---|
| `GET /api/catalog` | 問題の一覧（ID・年度・番号・分野） |
| `GET /api/questions/2026-001` | 1問の問題文と4つの選択肢 |
| `GET /api/questions/2026-001/solution` | その問題の正解と解説 |

問題・正解・解説はDBにあります。回答履歴・14日間の進捗・模試結果は
ブラウザのlocalStorage（キー：`ipas-learning-v1`）に保存します。
`learning.mjs` にある `/answers` や `/exams` などの処理名は、ブラウザ内の処理であり、
サーバーへの書き込みAPIではありません。
DB定義には利用者・回答・模試などのテーブルも残っていますが、現在の学習機能はそこへ保存しません。

## ローカル起動と問題の追加

Node.js 22.13以上が必要です。プロジェクトのフォルダーで実行します。

```powershell
npm ci
npm start
```

ブラウザで `http://127.0.0.1:8788` を開きます。
サーバーは同じPCからの接続だけを受け付けます。
起動時にDBとテーブルは作成されますが、通常起動では問題を自動投入しません。

問題を追加する流れは次のとおりです。

```text
AIなどで問題・選択肢・正解・解説を作成／修正
  → 内容を確認してJSONに整理
  → scripts/import.mjs で形式検証
  → ローカルDBへ登録
  → APIを通して画面に表示
```

アプリからAIを直接呼び出す機能は現在ありません。
既存の登録処理は追加用で、同じIDの異なる内容を上書きしません。

## 教材化するときの注意点

- 現在のAPIは2025・2026年度の各100問に限定され、さらに状態の条件で取得対象を絞ります。300～600問に広げるにはAPIの条件などの変更が必要です。
- `data/` と `.local/` はGit管理対象外です。GitHubのソースだけでは問題データは配布されません。
- DBに問題があってもAPIの取得条件に合わなければ、画面の問題一覧は空になります。
- 学習履歴はブラウザごと・アクセス先ごとに保存され、本番とローカルでは共有されません。

詳しい既存の説明： [公開MVP](public-mvp.md) ／ [データ投入](d1-import.md)

## 受講生向けの配布版

配布ZIPには、別の起動ファイル `起動.cmd` と [受講生用手順](workshop-student.md) を同梱します。
同じ手順をZIP直下の `はじめに.md` にも配置します。
`scripts/workshop-start.mjs` から `scripts/dev.mjs --workshop` を起動し、
`http://127.0.0.1:8790` で利用します。

- DBは `.local/workshop/app.sqlite`、入力は `workshop/questions.json` です。
- 初回起動時に同梱の2024～2026年度300問を登録します。
- このローカルモードだけは2021～2026年度・最大600問を取得できます。通常起動・公開版のAPI条件は従来どおりです。
- 元プロジェクトの `scripts/package-workshop.mjs` で配布フォルダーを生成します。既存DB・Git履歴・Cloudflare設定はコピーしません。

## GitHubに保存するもの

ソースコード・テスト・設定・`docs/` の手順書・配布フォルダーを作るスクリプトを保存します。
`教材/`・`配布用/`・`過去問/`・`解答/`・`data/`・`.local/` はローカル保管です。
配布ZIPの再作成には、別途ローカルの問題JSONが必要です。
起動トラブル対処手順の管理用原本は `docs/workshop-troubleshooting.md` で、
ZIP作成時に `教材/ローカル環境_起動トラブル対処手順.md` として同梱します。
