どの作業をサブエージェントへ委譲し、どれをメインが自分でやるかは `agent-role-division.md` が決める。本ルールは、委譲したサブエージェントがどのモデルで動くかだけを扱う。

## Task/Agent ツールのサブエージェント・agent teams

`CLAUDE_CODE_SUBAGENT_MODEL` 環境変数は、Task/Agent ツールのサブエージェントと agent teams の既定モデルを決める。モデルの解決順は「呼び出し側の `model` パラメータ → サブエージェント定義の `model` frontmatter → 環境変数 → メインセッションのモデル」で、環境変数は明示指定が無いときの既定にすぎない（出典: https://code.claude.com/docs/en/sub-agents の Choose a model）。呼び出し側やサブエージェント定義（プラグインのものを含む）が `model` を指定していれば、そちらが勝つ。

`.claude/settings.json` の `env.CLAUDE_CODE_SUBAGENT_MODEL` でこの環境変数を固定している場合、効くのは呼び出し側と定義側のどちらにも `model` 指定が無い場合（`general-purpose` を `model` なしで呼ぶなど）だけで、`model` を frontmatter に持つサブエージェントの定義（プラグイン由来を含む）はそちらが勝つ。コスト抑制のつもりでこの環境変数を設定していても、想定外に高コストなモデルでサブエージェントが動いていないか、有効なプラグインのサブエージェント定義の frontmatter を確認する。組み込みの `Explore` / `Plan` もこの環境変数だけでは変わらない。

呼び出し側で `model` を指定するときは、この既定を意図して上書きしていることを自覚する。上位モデルが要るのは `agent-role-division.md` が定める設計判断・最終ジャッジの類だけで、実装・探索・一括変更では指定しない。

例外: `subagent_type: "fork"` は常に呼び出し元のモデルをそのまま継承し、`model` 指定にも `CLAUDE_CODE_SUBAGENT_MODEL` にも影響されない。

サブエージェントを定義や呼び出し側の指定に関係なく 1 つのモデルへ固定したい場合は `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` を併せて設定する（対応バージョンは上の公式 doc を参照。上の fork と、`model: inherit` を宣言するスキルの起動は対象外）。この状態では組み込みの `Explore` / `Plan` と Workflow の `agent()` を含む全定義の `model` が無視され、呼び出し側も `model` を渡せなくなるため、プラグインの高精度レビュー用エージェントも一律に格下げされる（FORCE だけを設定して `CLAUDE_CODE_SUBAGENT_MODEL` を設定しない場合は、`Explore` だけは自身のモデル上限を保つ）。この副作用を受け入れる判断をした上でだけ使う。

## Workflow ツールの `agent()` 呼び出し

Workflow ツール（ultracode で使う並列オーケストレーション）内の `agent()` 呼び出しについては、情報源が食い違う。`CLAUDE_CODE_SUBAGENT_MODEL` の環境変数一覧（https://code.claude.com/docs/en/model-config）は「モデルを別途割り当てていない workflow agents」にも適用されると明記する一方、Workflow ツール自身の説明は「`model` を省略するとメインセッションのモデルを継承する。ほぼ常にこれが正しい」としており、両者は一致しない。どちらが実際の挙動かをこのルールだけで断定しない。

実運用ではこの食い違いの影響を受けないよう、Workflow スクリプトでは `model` を省略せず明示指定する。既定は `agent(prompt, { model: "sonnet", ... })`。

以下のようなタスクは、確実性より上位モデルを優先したい。上の食い違いにより結果を断定できないので、`model` を省略して Workflow ツール自身の説明どおりの継承を狙うか、上位モデルを明示指定するかを選び、狙いどおり動いているかは `/tasks`（実行中のサブエージェントの行にモデル名が出る）で確認する:

- 複数案のトレードオフを比較して1つの方針に絞る設計判断
- 収集した知見を統合する最終シンセシスステージ
- 敵対的検証の最終ジャッジ（複数票の多数決ではなく、単独で結論を出す場合）
