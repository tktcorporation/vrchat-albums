# PR 本文の書き方（pr-impact-review / pr-first-reader-check / technical-writing-style 準拠）

PR を作るときは、本文を次の 3 スキルの観点で書き、投稿前に 3 スキルでセルフチェックする。観点の詳細はスキル本体を読む。

| スキル | 本文で満たすこと |
| --- | --- |
| `pr-impact-review` | 冒頭 1〜2 文の全体像、ユーザー価値の before → after（➕ 良くなること / ➖ 失うこと / 👁 見える変化の両面）、依頼・Issue の意図との整合、宣言していない挙動変化 |
| `pr-first-reader-check` | 別チーム・入社直後のレビュアーが PR だけで意味を取れる。内輪の呼称・未定義の略語・暗黙の前提を出さず、関連 Issue は番号＋1 行要約で参照する |
| `technical-writing-style` | LLM 口調・空虚な形容を使わず、因果には機構を添え、一段落一トピックで冗長を削る |

ユーザーが受け取る価値が変わらない PR（内部リファクタ・typo・コメントのみ）は「ユーザー価値の変化なし」と一言で結論づけてよい。

## PR 作成前のセルフチェック

本文だけでなく、差分に含まれるコメント/docstring も点検する。別クローンや YAML など `evergreen-documentation.md` が自動ロードされない場所で書いたコメントを取りこぼさないためである。

1. **evergreen-comment チェック**: 差分の全コメント（`.yml`/`.yaml` の CI 設定・Dockerfile を含む）が「現在の WHY」だけになっているか。履歴・経緯（「以前は〜」「従来は」）、変更前を前提にした理由（「X を追加したので〜」）、WHAT の重複、コミット SHA / PR 番号 / 個人名への参照が混じっていたら、現在の状態だけで意味が通る形に直し、理由は PR 本文／コミットへ移す
2. **初見レビュアビリティ チェック**: `pr-first-reader-check` の観点を通す
3. **文章規範チェック**: `technical-writing-style` の観点を通す

見つけたものは投稿前に直す。このルールを正本として、作成前に必ず実行する。

## 関連ルール

- `conclusion-only-output.md`: 過程・対比・自己言及を本文に残さない
- `pr-self-review.md`: PR 作成前のレビューループ
- `ci-workflow.md`: push 前の CI 再現と、PR 作成後の CI 監視
