# 2026年度100問：修復・検証結果

作業日：2026年11月5日。対象は2026年度のみ。本番D1への接続・投入は行っていない。
問題原文・解答・生成データをGitHubへ追加していない。

## 原因

元JSONとCSVの2026年度100件は、問題と選択肢をまとめたOCR文字列が全件一致した。
元データ100件には改行があるが、既存stagingのrawは100件全てで改行を除去した文字列と一致した。

初期の `csv.DictReader(text.splitlines())` はセル内改行を失わせた。
行頭の選択肢記号を前提とした抽出が失敗し、問題文までnullにしていた。
CSV読込は既に `io.StringIO(text)` を使用する形へ修正されている。

これとは別に、元OCRにも選択肢の脱落、記号の誤認識、横並びの読み順の崩れ、
表・空欄・下線・数式・擬似コードの情報脱落がある。
改行を戻すだけで原文の正確性が保証されるわけではない。
単純な分離で4つの非空選択肢が得られた候補は45件だったが、誤った分離も含み得る。
原本画像を確認し、64件で4選択肢を明示的に転記した。

元データには出題分野と解説が収録されておらず、空欄は取込だけでは埋まらない。
分野は本年度の冊子2・16・26ページに記載された区分を採用した。
問1〜34がストラテジ、問35〜54がマネジメント、問55〜100がテクノロジ。

## 修復方法と結果

- 原本問題PDF全56ページと解答PDF1ページを画像化した。問題PDFは文字抽出0文字の画像PDF。
- 元JSONのページ・座標を使い100問を切り出し、AIが原本画像と照合した。
- 欠けた選択肢等は画像から転記した。前後の問題から推測したり、正答から逆算して原文を補完したりしていない。
- 表・数式・コードを含む18問はセル関係、主キー・外部キー、空欄等を文字で明記した。
  原本の画像そのもののレイアウトと同一ではない。最終レビューでは意味の保存と画面表示を確認する必要がある。
- `prompt`・4つの `choices`・`answer`・`domain` を100問分作成した。
- 正解理由・誤答3件の理由・重要用語・覚えるポイントを100問分AIで作成し、各選択肢と照合した。
- 正答表はPDF文字座標から別途抽出し、番号・記号を100件照合。一致100、不一致0。
- ID重複0、年度・問題番号不整合0。既存の形式検証では100件受入・エラー0。
- 計算・コード8問は再計算・実行・全ケース比較等を実施し、公式正答との一致を確認した。
- 元のCSVと600件staging JSONはGitの旧blobとの一致で未変更を確認した。

| 判定 | 件数 | 意味 |
|---|---:|---|
| 原本から復元できた問題 | 100 | AIの原本画像照合を含む修復 |
| 原本不足等による修復不能 | 0 | この範囲で修復不能と判断したものはない |
| 公開可能 | 0 | 人による最終検証を未実施 |
| 要確認 | 100 | 原文転記・表現・解説の最終レビューが必要 |
| 公開不可 | 0 | 現時点で構造不足等により使用不可としたものはない |

`status=needs_review`、`explanation_status=needs_review`、`reviewer=null`、`reviewed_at=null`。
既存の公開条件は変更せず、学習者へ配信されない状態を維持している。
AIによる照合は人による検証の完了を意味しない。「解説に誤情報が絶対にない」とは保証していない。

## 年度別・エラー種別

| 年度 | 元件数 | 修復前の本文未分離 | 選択肢不足 | 分野未設定 | 解説なし | 今回修復 |
|---|---:|---:|---:|---:|---:|---:|
| 2021 | 100 | 100 | 100 | 100 | 100 | 0 |
| 2022 | 100 | 100 | 100 | 100 | 100 | 0 |
| 2023 | 100 | 100 | 100 | 100 | 100 | 0 |
| 2024 | 100 | 100 | 100 | 100 | 100 | 0 |
| 2025 | 100 | 100 | 100 | 100 | 100 | 0 |
| 2026 | 100 | 100 | 100 | 100 | 100 | 100 |

2026年の修復後は上記4種類の構造エラーが各0件。
残る確認項目は「人による本文・解説レビュー」100件。
2021〜2025年は修復を実施しておらず、2026年の結果を自動適用していない。

## 保存先（Git対象外）

- `data/repair/2026/questions-repaired.json`：既存アプリの構造に対応した修復100問。
- `data/repair/2026/edits.json`：問題ごとの転記・補正・解説・AI確認記録。
- `data/repair/2026/changes.json`：旧stagingとの比較、変更内容。
- `data/repair/2026/summary.json`、`analysis-summary.json`：年度・分類・エラー集計。
- `data/repair/2026/verification.json`：PDF正答照合、形式・公開条件の検証。
- `data/repair/2026/calculation-checks.json`：計算・プログラムの実行結果。
- `data/repair/2026/references.json`：一部解説の一次資料と確認の制限。
- `.local/repair/2026/review.html`：原本切出し・修復文・解説を並べた100問の確認票。
- `.local/repair/2026/crops/`：原本画像。確認票と同じ場所に保持する。

確認票のチェック欄は印刷用であり、チェックしてもJSONやDBは更新しない。
人によるレビュー後、具体的な確認者・日時・修正内容を記録する工程が必要。

## 解説の根拠の確認

一般的な用語・正誤理由は各選択肢の意味をAIが再確認した。
法務や分類上の留意事項については、次の一次資料も参照した。
全100問の全記述を外部資料で独立検証したものではない。

- [文化庁：AIと著作権の生成・利用段階](https://www.bunka.go.jp/seisaku/bunkashingikai/chosakuken/pdf/94057901_01.pdf)
- [特許庁：ビジネス関連発明](https://www.jpo.go.jp/system/patent/gaiyo/sesaku/biz_pat.html)
- [個人情報保護委員会：仮名加工情報・匿名加工情報編](https://www.ppc.go.jp/personalinfo/legal/guidelines_anonymous/)
- [経済産業省：パブリシティ権判例を含む資料](https://www.meti.go.jp/press/2026/04/20260409001/20260409001-1.pdf)
- [経済産業省：システム管理基準](https://www.meti.go.jp/policy/netsecurity/sys-kansa/sys-kanri-2023.pdf)
- [著者らの研究報告：体験の価値を考慮したデザイン・パターンの研究](https://www.jstage.jst.go.jp/article/jssd/64/0/64_62/_pdf/-char/en)
- [Open Source Initiative：Open Source Definition](https://opensource.org/osd)

民法の現行条文の本文、システム管理基準の本文など、閲覧制限等で取得できなかった資料もある。
該当資料は検索結果等の確認範囲を `references.json` に明記し、人による再確認対象としている。

## 再実行

```powershell
py -3 -X utf8 scripts/repair_2026.py
node scripts/verify-repair.mjs
node data/repair/2026/checks.mjs
node scripts/build-repair-review.mjs
node scripts/import.mjs --validate-only --input data/repair/2026/questions-repaired.json
py -3 -X utf8 -m unittest discover -s tests -p test_repair.py
npm test
npm run check
```

修復は既存600件を更新せず、独立した私有データディレクトリへ出力する。
画像の再生成にはGit対象外 `.tools/pdf/` のPDF.jsとCanvasを使用する。
公開済みの学習DBへの登録や本番D1への投入は実施しない。

## 公開Git履歴の削除対象

`ae0d13b` で最新ツリーの追跡から外したが、その親 `7de26d6` と
データ追加コミット `d314e7d` の履歴には以下23ファイルが残る。

- `data/import.sql`
- `data/questions-staging.json`
- `data/received.zip`
- `data/received/it_passport_2021_2026.json`
- `data/received/manifest.json`
- `data/received/validation.json`
- `it_passport_2021_2026.csv`
- `reports/data-audit.json`
- `reports/repair-queue.csv`
- `過去問/2021r03_ip_qs.pdf`〜`過去問/2026r08_ip_qs.pdf`（6ファイル）
- `過去問/過去問.zip`
- `解答/2021r03_ip_ans.pdf`〜`解答/2026r08_ip_ans.pdf`（6ファイル）
- `解答/2021r03_ip_ans.zip`

上記をPublic履歴から除去するには、全ブランチ・タグ等を対象とした履歴修正と
リモート反映、共同利用者の再取得、GitHubの残存参照等の確認が必要。
通常の削除コミットや `.gitignore` だけでは過去履歴から消えない。
フォークや既存クローンからの回収までは保証できない。
履歴修正・force pushは今回実施していない。削除対象と影響範囲の承認後に別作業で行う。
