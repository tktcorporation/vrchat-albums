---
name: structured-doc-writing
description: 調査を伴う長いMarkdown文書を、目的定義、根拠整理、構成設計、章単位の執筆、レビューに分けて作る。一度に完成稿を書くと構成の混乱、重複、過剰記述が起きやすい振り返り、調査報告、設計文書、企画書で使う。短い回答や既存文書の局所修正には使わない。
---

# 段階的な文書作成

完成稿を一度に書かない。各段階の成果物を保存し、次の段階へ進む条件を満たしたところで一度ユーザーへ返す。

## ワークフロー

1. **目的を定義する**：読者、読後に理解してほしいこと、対象範囲、対象外を `brief.md` に書く。
2. **根拠を集める**：事実、出典、確実性を `evidence.md` に分離する。この段階では本文を書かない。
3. **構成を設計する**：読者の問いが解消される順序を `outline.md` に書く。各章には、問い、伝える結論、使う根拠、書かないことを定める。
4. **章ごとに執筆する**：承認された構成に従い、`sections/` の一ファイルだけを書く。未承認の章や全文を先回りして書かない。
5. **組み立ててレビューする**：章を `draft.md` に組み立て、構造、根拠、可読性を別々に検査する。
6. **確定する**：採用する指摘だけを反映し、`final.md` を作る。

成果物の具体的な書式は [artifact-schemas.md](references/artifact-schemas.md) を読む。承認条件とレビューの分担は [review-gates.md](references/review-gates.md) を読む。

## 実行上の制約

- 調査と執筆を同じ段階で行わない。
- `outline.md` の承認前に本文を書かない。
- アウトラインを見出し一覧だけにしない。各章の責務と非責務を決める。
- 複数の情報を扱う章では、アウトライン時点で最重要事項を一つ決め、それ以外を支える情報または補足に分ける。文章で列挙を整える前に、情報同士の関係を設計する。
- 文章だけでつなげることを既定にしない。短く確認する文書では、結論を一、二文で示し、詳細は見出しと階層化した箇条書きで表す。段落、表、箇条書きは情報の性質に合わせて選ぶ。
- 一つの事実や主張を複数章の主役にしない。必要な再言及は参照にとどめる。
- 根拠のない内容を文章として補わない。不足は未確認として残す。
- 読者が成果物から参照先へ到達できるリンクだけを載せる。作成者のローカルファイルパスや一時的な作業ブランチURLを、共有文書の参照リンクにしない。
- 根拠へのリンクは、読者が内容と集計条件を直接確認できる業務上の正本を優先する。データ集計はRedashの保存済みクエリ、方針や議事録は共有ドキュメントまたは社内Wiki、実装はIssue・PRの順に検討する。GitHub上の分析ファイルは、より直接的な共有先がない場合の補助資料として使う。
- 出典名やローカルパスを示すだけでなく、リンク先で何を確認できるかが分かるラベルを付ける。共有先がない根拠はリンクに見せず、未共有であることと保存場所を区別して記録する。
- 一般語に見えても集計条件や社内固有の意味を持つ言葉は、初出より前に定義する。関連する分類語は一語だけでなく、同じ分類体系としてまとめて定義する。
- 全章を一度に生成しない。章ごとに読み手の問いが解消されたかを確認する。
- 表現の推敲で構造問題を隠さない。構造、根拠、可読性の順でレビューする。
- ユーザーが一括実行を明示した場合も、中間成果物と検査は省略しない。ユーザー確認だけを省略できる。

## CLI

段階の状態管理には同梱のCLIを使う。

```bash
bun .claude/skills/structured-doc-writing/scripts/docflow.ts init <project-dir> --title "文書名"
bun .claude/skills/structured-doc-writing/scripts/docflow.ts status <project-dir>
bun .claude/skills/structured-doc-writing/scripts/docflow.ts approve <project-dir> <brief|evidence|outline|draft|review>
bun .claude/skills/structured-doc-writing/scripts/docflow.ts add-section <project-dir> <section-id> --title "章名"
bun .claude/skills/structured-doc-writing/scripts/docflow.ts assemble <project-dir>
bun .claude/skills/structured-doc-writing/scripts/docflow.ts finalize <project-dir>
bun .claude/skills/structured-doc-writing/scripts/docflow.ts validate <project-dir>
```

`approve`は機械的な最低条件だけを検査する。内容が妥当だという判断は、ユーザーまたはレビュー担当が行う。

## 既存スキルとの分担

- 発言や提供資料への忠実性が必要なら、根拠整理と執筆時に `faithful-doc-writing` を使う。
- 日本語文書の論証と読みやすさは、最終レビューで `technical-writing-style` を使う。
- 初見の読者が理解できるかを重視する場合は、構造レビューと可読性レビューで `pr-first-reader-check` の考え方を使う。
- 長期間参照する文書では、確定前に `evergreen-writing` を使う。
