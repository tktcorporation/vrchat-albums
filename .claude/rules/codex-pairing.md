# Codex ペアプロ活用ルール

Codex CLI (`codex`) はセカンドオピニオンを得るためのツール。判断が分かれる場面では Codex に壁打ちする。

## 必ず使う場面（MUST）

- **PR 作成・push 前のレビュー**: `codex review --uncommitted` / `codex review --base main`
- **設計方針が2つ以上あり迷う**: `codex exec "2案のトレードオフを分析して: ..."`
- **バグ原因が10分以上特定できない**: `codex exec "このエラーの原因を調査して: ..."`

## 積極的に使う場面（SHOULD）

リファクタ案比較、エッジケース洗い出し、SQL妥当性チェック、既存コード解読

## 使い方

```bash
codex exec "プロンプト"                        # 非インタラクティブ実行
codex review --uncommitted                     # ワークツリーのレビュー
codex review --base main                       # main差分レビュー
codex exec "エッジケースを洗い出して" < file   # ファイル渡し
```

**注意**: インタラクティブモード（引数なし `codex`）は使わない。大きなプロンプトは `timeout 120` を付ける。Codex の出力は参考意見、最終判断は自分が行う。
