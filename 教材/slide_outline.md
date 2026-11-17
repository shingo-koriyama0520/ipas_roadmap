# ITパスポート勉強会：全4回のスライド構成

全15枚、16:9、日本語。図・表・テキストはPowerPointで編集可能。授業時間・時間配分は未設定。

講師用の補足説明は各スライドのノートにも収録。

## Slide 01｜ITパスポート勉強会

全4回を通じて、既存Webアプリを読み解き、AIと改修・検証する。授業時間は未確定のため配分しない。

## Slide 02｜勉強会の目的

構造を理解し、DBとAPIの関係を説明する。AIに変更範囲と期待結果を伝え、受講生自身で調査・修正・検証する。

## Slide 03｜学習の基本方針

必要な知識を学びながら、理解・操作・AIへの指示・検証を繰り返す。AIの出力は差分と動作で確認する。

## Slide 04｜全4回のロードマップ

第1回で全体像、第2回でDB、第3回でAPI、第4回で全体統合と自走を学ぶ。時間配分は設定しない。

## Slide 05｜第1回：全体像の把握

テーマ：何がどこに書かれているのか。HTMLは画面構造、CSSは見た目、JavaScriptは操作や表示更新。APIはサーバーでDBを参照する。主要ファイルを実際に開いて確認する。

参照：public/index.html:1-12、public/style.css、public/app.js:1-4、public/learning.mjs:1-40、functions/api/[[path]].js:1-2

## Slide 06｜Webアプリの全体構成

利用者の操作をフロントエンドが受け、公開APIにGETし、APIがD1のquestionsをSELECTしてJSONを返す。履歴はブラウザのlocalStorageへ保存する別経路。APIを通じたD1への履歴書込はない。

参照：functions/api/[[path]].js:1-2、lib/public-api.mjs:12-36、public/learning.mjs:1-40、wrangler.toml:1-9

## Slide 07｜第2回：DBの構造

DBはデータを整理して保存する仕組み。テーブルは表、カラムは項目、レコードは1件。questions.idが主キー。既存スキーマのanswers.question_idはquestions.idを参照する外部キーだが、公開版はanswersテーブルへ履歴を書かない。SQLは検索等の指示言語。

参照：migrations/0001_init.sql:2-10、lib/public-api.mjs:17-32

## Slide 08｜DBの実践演習

migrations/0001_init.sqlを読み、テーブルとカラムを探す。講師が用意した合成データの検証環境を読み取り専用で使い、SELECTを実行する。下のSQLは説明用で、公開APIの対象条件を再現するものではない。本番DBへの接続・変更は禁止。npm startはローカルDBを作成するため、DBを変更しない調査では実行しない。

参照：migrations/0001_init.sql:6、lib/public-api.mjs:14-19、scripts/dev.mjs:9-18

## Slide 09｜第3回：APIの仕組み

APIは画面からサーバーの機能を呼び出す窓口。GETは取得、POSTは送信・登録等に用いる。公開版はGETだけを許可しPOSTは405で拒否する。画面内の/answers処理はlearning.mjs内のローカル処理でHTTPのPOST APIではない。JSONはキーと値でデータを表す形式。

参照：lib/public-api.mjs:12-36、public/learning.mjs:30-40、public/learning.mjs:132-155

## Slide 10｜APIの実践演習

Functions入口からhandlePublicを追う。開発者ツールのNetworkでURL・GET・ステータス・JSONを観察する。ローカルコピーで表示メッセージ等を1か所だけ修正し、差分と表示を確認する。APIの実装変更や本番の公開条件変更を演習の前提にしない。

参照：functions/api/[[path]].js:1-2、lib/public-api.mjs:16-36、tests/public.test.mjs:64-95

## Slide 11｜第4回：全体統合

第1〜3回を使って、画面・API・DB・ブラウザ保存のつながりを説明する。未完成箇所は実機で確認してから決め、存在を推測しない。課題、期待する動作、変更箇所、検証結果を提出する。

参照：public/app.js、public/learning.mjs、lib/public-api.mjs、tests/public.test.mjs

## Slide 12｜AIを活用した開発

受講生が方針と最終判断を持つ。AIはコードや修正案・解説・テストの作成を補助する。講師は技術解説・ヒント・レビュー・安全管理を担う。指示には対象ファイル、課題、期待動作、変更範囲、検証方法を含める。

## Slide 13｜自走するための4ステップ

問題が残れば再び課題発見へ戻る循環。原因を調べる前に大きく書き換えず、小さな差分を作って期待動作と回帰を検証する。

## Slide 14｜完成と自走の評価

アプリの完成度と受講生の自走能力を別々に評価する。完成度は実装・テスト・重大不具合で確認。自走能力は説明、特定、AI指示、差分確認、結果判断を実演して評価する。

## Slide 15｜最終ゴール

受講生自身が、AIを活用しながら開発を進め、完成したと判断できることを最終目標とする。

## 演習準備と未確認事項

- 演習で使うローカルコピー、合成データのDB、ブラウザのプロファイルを講師が用意する。
- 未完成機能の具体的な一覧、授業時間、受講生の端末環境、演習DBの配布方法は要確認。
- 本番の稼働状態や実DBの内容・件数は、この制作作業では確認していない。
- SQL・JSON・表の値は説明用の例。実DBから抽出した問題データではない。
- 公開APIの学習利用可否と、人による問題内容の承認は別扱い。公開条件の変更を演習の前提にしない。
