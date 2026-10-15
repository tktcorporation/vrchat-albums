# ziku — `.claude` 設定のテンプレート同期

`npx ziku`（OSS: [`tktcorporation/ziku`](https://github.com/tktcorporation/ziku)）は、リポジトリの `.claude/` 配下の設定（skills / hooks / rules / guides など）を**テンプレートリポジトリ `tktcorporation/.github` と双方向に同期する CLI**。

## なぜ使うのか

複数のリポジトリで同じエージェント設定（共通スキル・hook・rule、および Cursor / Codex 向けアダプタ）を使い回したい。各リポジトリで手コピーするとすぐにズレるため、テンプレートを単一の正本（source of truth）にして `ziku` で配布・取り込みする。

## 設定ファイル

| ファイル           | 役割                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| `.ziku/ziku.jsonc` | 同期対象の `include` 列挙（と `exclude`）。同期したいファイルはここに載る |
| `.ziku/lock.json`  | base-ref とファイルハッシュ。pull/push のたびに更新される（手で触らない） |

## サブコマンド

| コマンド                   | 動作                                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| `npx ziku init`            | 初期化（`.ziku/` を作成）                                                  |
| `npx ziku track <path...>` | ファイルを `include` に登録して同期対象にする                              |
| `npx ziku status`          | ローカルとテンプレートの差分を表示                                         |
| `npx ziku pull`            | テンプレート側の更新を取り込む（auto-merge / コンフリクト解決あり）        |
| `npx ziku push`            | track 済みファイルをテンプレートリポジトリへ反映（テンプレ側に PR が立つ） |
| `npx ziku aggregate`       | このテンプレートを利用するリポジトリの未同期差分を一覧化（読み取り専用）   |

## 落とし穴

- **wildcard include は直下のみ**: `.claude/hooks/*.ts` や `.claude/rules/*.md`、`.cursor/rules/*.mdc` はサブディレクトリにマッチしない。プロジェクト固有ファイル（テンプレに流したくないもの）は `hooks/project/` `rules/project/` / `.cursor/rules/project/` のようにサブディレクトリへ退避して同期対象から外す。
- **Cursor / Codex アダプタも track する**: `.claude/hooks/manifest.json`・生成スクリプト・`.cursor/` / `.codex/` のアダプタは共有設定の一部。配線の手編集はせず `pnpm agent-adapters:generate` で揃える（手順は `.claude/guides/tools/cursor.md`）。
- **社内固有の呼称をテンプレに流さない**: push するファイルから社内限定の略語・呼称を排除し、架空例に置き換えてから push する（初見レビュアーに通じる状態を保つ）。
- `pull` の auto-merge はローカルの差分を巻き込むことがある。push 前に `status` で差分を確認する。

## 典型ワークフロー

```bash
# 同期対象に追加
npx ziku track .claude/skills/<skill-name>

# テンプレの最新を取り込む
npx ziku pull

# ローカルの変更をテンプレへ反映（PR が立つ）
npx ziku push
```

## 利用先の改善をテンプレートへ取り込む

テンプレートリポジトリで `npx ziku aggregate --out=/tmp/ziku-aggregate.json` を実行し、報告された `pendingPush` と `conflicts` の実ファイルを利用先のリポジトリで確認する。集計は読み取り専用で、差分の採用や同期は行わない。既定では最近更新された候補を一部だけ調べるため、必要なら `--recent-days` と `--max-candidates` を指定する。

`localOnly` は「テンプレートへそのままコピーしてよい」という意味ではない。テンプレートの現行版と利用先の内容を比較し、共通の動作だけをここで実装・検証する。特に `.claude/skills/` と `.claude/rules/` は、利用先固有の運用やホスト名が混ざっていないか確認する（`.claude/rules/template-sync-boundary.md`）。

## push の落とし穴（--files の厳密絞り・偽 conflict 回避）

特定ファイルだけをテンプレへ送りたいとき、`ziku push` の非自明な挙動を知らないと、共有テンプレに無関係なローカル固有ファイルが漏れたり、push 全体が中断したりする。

### `--files` でのスコープは「実 push」でのみ効く

特定ファイルだけ送るときは非対話で指定する。

```bash
npx ziku push --yes --files=<path[,path...]> -m "<PR title>"
```

| 操作            | `--files` の効き方                                             |
| --------------- | -------------------------------------------------------------- |
| 実 push         | **厳密に絞る**（指定ファイルだけが対象）                       |
| `push --dryRun` | **`--files` を無視して全候補を表示**（スコープ確認に使えない） |

スコープ確認は dry-run ではなく、**実 push 直前に出る「N file(s) selected via --files」とファイル表**で行う。`mise.toml` / `settings.json` / `devcontainer.json` のようなローカル固有ファイルを共有テンプレに漏らさないため、skill / rules だけを `--files` で明示指定する。

### 偽 conflict とその回避

過去に push 済みだが `lock.json` の `baseHashes` に未記録のファイルは、次回 push で `conflicts` 扱いになる。`--files` に含めると `unresolvedConflictError` で push 全体が中断する（`ziku pull` は無関係ファイルも巻き込むので、ここでは使いたくない）。

回避: `lock.json` の `baseHashes[<path>]` に**テンプレ現行内容のハッシュ**を手動記録すると、そのファイルが `localOnly` 化してクリーンに push できる。push 内容は常にローカル側なので、`baseHashes` の値が誤っていても誤配は起きない。

```bash
# テンプレ現行内容のハッシュを取得して baseHashes に記録する
gh api repos/tktcorporation/.github/contents/<path> --jq .content | base64 -d | sha256sum
```

ハッシュ算法は `sha256(file content, utf-8).hex` ＝ `sha256sum <file>` と一致する。

### push 後の lock.json と新規ファイルの track

- push しても `lock.json` の `baseRef` は更新されない。テンプレ側 PR がマージされた後に `ziku pull` を実行して初めて baseRef/hash が追従し、`status` の push pending が消える。
- 新規ルール等は `npx ziku track <path>` で include に追記してから push する。未 track でも wildcard `.claude/rules/*.md` でマッチはするが、`status` では modified・`diff` では untracked と表示が割れるため、明示 track が確実。
- `npx ziku` を `/tmp` 等のラッパーシェルスクリプト経由で実行すると auto-mode classifier に拒否される。`npx ziku <cmd>` を直接コマンドとして叩く。
- ziku ツール自体の改善要望は `tktcorporation/ziku` リポジトリに Issue を出す（業務 Issue の集約先とは別）。
