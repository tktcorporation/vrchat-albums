# agent-fleet

並列で動く Claude Code / Codex のセッションを、元の指示・現在の作業・状態・要判断の 4 軸で 1 画面に並べる TUI。

```bash
mise run fleet            # TUI（Herdr の pane で常駐させる想定）
mise run fleet -- --once  # 1 回だけ素のテキストで出す
mise run fleet -- --json  # モデルを JSON で出す（Claude セッションから状況を聞くときに使う）
```

git submodule を `repo/` 以外に置く、または持たないリポジトリでは `AGENT_FLEET_SUBMODULE_DIR` でサブモジュール置き場のディレクトリ名を指定できる（未設定時は `repo`）。

## 何を読んでいるか

| 種別 | 元の指示 | 現在の作業 / 状態 | 紐づけ |
| --- | --- | --- | --- |
| Claude 背景セッション | `~/.claude/jobs/<id>/state.json` の `intent` | 同 `detail` / `state`、待ちの種別は `claude agents --json` | `worktreeBranch` |
| Claude 対話セッション | transcript の最初の human 発話 | 末尾の assistant 発話 / Herdr の状態、未回答の質問 | `herdr agent list` の `agent_session` |
| Codex | `~/.codex/history.jsonl` | rollout の最後の応答 / Herdr の状態 | 同上（thread id） |

モデルは、Claude 背景セッションでは `state.json` の `respawnFlags` の `--model` の次の要素、Claude 対話セッションでは transcript の最後の `assistant` レコードの `message.model`、Codex では rollout の最後の `turn_context` レコードの `payload.model` から取得する。

Herdr の状態（blocked / done）は画面パターンの推定なので、詳細ペインに最後の発話を並べて人が判断できるようにしている。
Codex の承認待ちは、サンドボックス無効の運用では発生しないため扱わない。

## 画面

1セッションを2行で描く: 1行目は名前・場所・エージェント種別・モデル・経過時間の識別情報、2行目は「いま何をしているか」（要判断の内容 / 直近の作業内容 / `(idle)`）。先頭のヘッダ行（グループ別の件数と最終収集からの経過時間）・区切り・詳細ペイン・ステータス行（キー操作の案内、絞り込み中の文字列、源のエラー）は画面内に固定され、一覧だけがスクロールする。TUI は alternate screen（vim や htop と同じ、終了すると元の端末表示に戻る画面）に描くため scrollback は汚さない。パイプや CI などの非 TTY 環境では Ink が alternate screen を自動的に無効化し、通常の標準出力に切り替わる。

`--once` も同じ2行形式で出す（TUI と共通の組み立て関数を通すため列がそろう）。状態は `⏸` 要判断 / `◐` 作業中 / `·` 待機 / `✔` 完了 / `✖` 失敗 / `■` 停止 の記号で表す。

## キー

`↑↓`（`j`/`k` でも可）で選択、`PgUp`/`PgDn` でページ単位、`Home`/`g` で先頭、`End`/`G` で末尾へ移動する。`Enter` はその行の pane へ移動する。pane が無い背景セッションは、Herdr 内なら現在の workspace に tab を作って `claude attach <id>` を開き（フォーカスは移さない）、Herdr の外なら実行すべきコマンドを詳細ペインに示すだけにする。pane も無く背景でもない対話セッションは `claude --resume <id>` の案内を出す。`a` 完了を確認済みにする、`c` その他を展開、`/` 絞り込み（`Esc` 解除。絞り込み中も `PgUp`/`PgDn`/`Home`/`End` は一覧移動として効く）、`r` 再収集、`q` 終了。

確認済みは `$XDG_STATE_HOME/agent-fleet/ack.json`（未設定か相対パスなら `~/.local/state/agent-fleet/ack.json`）に持つ。devcontainer を作り直すとこのディレクトリが永続化されず記録が消えるが、7 日より古い完了は最初から確認済み扱いになる。

## 構成

収集（`src/collect/`）→ モデル（`src/model/`）→ 描画（`src/tui/`）。Web に移すときは描画層だけを差し替える。
各データ源が持つ項目と `FleetRow` の型定義は `src/collect/*.ts` と `src/model/row.ts` を正とする。

## 設計上の判断

対象は cloud セッションと Remote Control セッションを除く：このマシンのファイルに記録が残らないため。
エージェントが動いていない worktree は一覧に出さない：俯瞰したいのはエージェントであって worktree ではないため。
サブエージェント（transcript の `isSidechain` が真の行）は対象外とする：親セッションの行に作業内容が含まれるため。
Herdr の pane 外で動く Codex は対象外とする：プロセスの生存と thread id を対応づける手段が無いため。
TUI からの返信機能は持たない：返信は移動先の pane で行うのが自然で、TUI 側に持たせると入力経路が二重になるため。

未確認の done は要対応グループに含める：done は人が見て初めて価値を失う状態で、見た記録が無ければ要対応として扱う必要があるため。
確認済みの記録が無くても、更新から 7 日を過ぎた done は「その他」に落とす：確認記録が失われたとき、古い完了が起動直後に要対応へ積み上がるのを避けるため。

Herdr の blocked と done は画面パターンの照合による推定である：誤判定の余地があるため「Herdr 検知」と明示し、最後の発話を並べて人が最終判断できるようにしている。

transcript は先頭と末尾の固定長だけを読む：ファイルが数十 MB に育ることがあり、全体を読むと収集のたびに重くなるため、先頭 256KB から最初の指示を、末尾 256KB から最新の状態を読む。

transcript や `state.json` の形式は Claude Code の内部仕様であり、版が変わると形が変わりうる：データ源ごとにパーサを分け、フィクスチャで守る。未知のフィールドは無視し、読めない源は行を欠けさせるだけに留める。
