---
name: package-upgrade
description: |
  npm (pnpm) / Cargo の依存パッケージをバージョンアップするスキル。
  サプライチェーン攻撃 (Shai-Hulud 系 worm) のリスクを抑えつつ、脆弱性のある
  パッケージを優先的に潰し、override (pnpm.overrides / [patch.crates-io]) という
  負債をなるべく増やさない / 既存の override を外せないか検討する、までを 1 セットで回す。
  以下の依頼で使う:
  「依存を上げて」「パッケージを更新して」「バージョンアップして」「audit を潰して」
  「脆弱性のあるパッケージを直して」「dependabot の PR を見て」「override を整理して」
  「outdated を解消して」。
  個別 1 パッケージの bump でも、まずこのワークフローを通して安全性と override 負債を確認する。
---

# Package Upgrade - 依存更新スキル

依存のバージョンアップを「ただ上げる」作業にしない。**①汚染版を掴まない ②脆弱性を優先で潰す ③override という負債を増やさない・減らす** の 3 つを毎回セットで回す。

このスキルは「どう動くか」の手順書。**設定値や受容した脆弱性の判断はここに複製しない** — それらはリポジトリ側の SSOT（`pnpm-workspace.yaml` / `Cargo.toml`、セキュリティ方針を記録している doc や台帳）が正。リポジトリに台帳が無ければ、受容判断は PR 説明文や tracking issue に残す。

## 前提として効いている防御 (触らない・無効化しない)

pnpm のサプライチェーン hardening が `pnpm-workspace.yaml` に設定されているリポジトリでは、更新作業中にこれらを「邪魔だから外す」のは禁止。設定されていなければ導入を検討する価値がある。

| 設定 | 効果 | 作業中の意味 |
|---|---|---|
| `minimumReleaseAge` (cooldown) | 公開後 N 分未満の version を解決対象外にする | `pnpm add/update` が「枯れていない最新版」を勝手に掴まない。これが効くから安全に更新できる |
| `strictDepBuilds: true` | 許可外の依存が build script を持つと install を **失敗** させる | 更新で新しい `postinstall` が紛れ込めば必ず炎上する。エラーが出たら歓迎すべきサイン |
| `allowBuilds` | build script 実行を許可する allowlist | 更新で build エラーが出たら「なぜこの package が script を要るのか」を確認してから足す。安易に追加しない |
| `blockExoticSubdeps` (pnpm 11 default true) | registry 外 (git / tarball) の subdep を拒否する | worm が exotic subdep として紛れ込むのを止める。エラーが出たら歓迎すべきサイン |

cooldown には escape hatch (`minimumReleaseAgeExclude`) があるが、常用しない（Phase 2-1）。リポジトリにこれらの設定値があるなら、必ずそちらを正として読む。

## Phase 1: 何を上げるか決める (脆弱性 > 古さ)

闇雲に全部上げない。優先順位をつける。

### 1-1. 脆弱性を起点に洗い出す (最優先)

```bash
pnpm audit                      # npm 側の既知脆弱性
pnpm audit --prod               # prod 依存だけに絞る (効かない構成では pnpm audit 単体で読む)
cargo audit                     # Rust を含むなら (cargo-audit 未導入なら cargo install cargo-audit)
```

検出されたものは、まず **既に受容済みかどうか** を確認する。リポジトリに受容アドバイザリの台帳（security doc / ADR 等）があれば突き合わせる。

- **受容済み** → 受容理由がまだ有効か確認する (Phase 3 の「override / 受容を外せるか」へ)。新規対応は不要。
- **新規** → これが最優先の更新対象。攻撃面が本当にあるか（その依存が実行時にどう使われるか、外部入力に晒されるか）を評価してから動く。

### 1-2. 古さで洗い出す (次点)

```bash
pnpm outdated -r                # workspace 全体の outdated 一覧
pnpm --filter <pkg> outdated    # 個別ワークスペース
cargo outdated                  # Rust を含むなら (cargo-outdated 未導入なら cargo install cargo-outdated)
```

脆弱性が絡まない単なる古さは優先度を下げる。major 跨ぎは breaking change のレビューコストが高いので、脆弱性 or 明確な必要性がない限り見送ってよい。

### 1-3. bot の PR を起点にする場合

dependabot / renovate が何を管理しているかは `.github/dependabot.yml` 等で毎回確認する。**管理対象外のエコシステム（多くは npm を手動運用にしている）は手動更新が原則** — このスキルの本体はそこ。

bot PR の auto-merge を**思い込みで前提にしない**。auto-merge を回しているワークフローの actor gate と、実際に PR を起こす bot の actor が噛み合っているかを毎回確認する（両者がズレていると「自動で入るはず」が永久に入らない事故になる）。確認の取れた範囲で patch/minor を任せ、major と CI が落ちたものは必ず人手で見る。

## Phase 2: 安全に上げる (Shai-Hulud リスク最小化)

### 2-1. 更新を実行する

```bash
pnpm update <pkg>                       # lockfile 更新を伴う = cooldown が効く経路 (current/root のみ)
pnpm -r update <pkg>                     # workspace 全体で更新 (子 workspace 限定の依存も拾う)
pnpm --filter <ws> update <pkg>          # 特定 workspace に絞って更新
pnpm add <pkg>@<version> --filter <ws>   # 特定版を狙う
```

cooldown が効くリポジトリなら、解決された version は最低でも cooldown 期間ぶん枯れている（具体値は `pnpm-workspace.yaml` の `minimumReleaseAge`）。**cooldown を跨いで最新版を掴むために `minimumReleaseAgeExclude` を安易に足さない** — 足すのは「上流が critical CVE の hotfix を出した直後」のような明確な理由があるときだけ。足したら PR 説明に理由を書き、取り込み後に掃除する。

### 2-2. 差分を必ず人間の目で確認する

更新後、lockfile の差分を読む。機械的に通さない。

```bash
git diff pnpm-lock.yaml          # 何が追加/変更されたか (Rust なら Cargo.lock)
```

確認する観点:

- **想定外の package が増えていないか** — 1 つ上げたつもりが大量の transitive dep が入れ替わっていないか。worm は新規 dep として紛れ込む。
- **build script を持つ新規 dep が入っていないか** — `strictDepBuilds` が `[ERR_PNPM_IGNORED_BUILDS]` で止めてくれる。**止まったら「許可リストに足して通す」前に、その script が何をするか確認する。** native binary の正当なビルド (sharp / esbuild 等) でなければ疑う。
- **registry 外 (git / tarball) の subdep が増えていないか** — `blockExoticSubdeps` が効いていればエラーで止まる。出たら歓迎すべきサイン。

少しでも怪しければ更新を取り消す。`pnpm add` は対象 workspace の `package.json` も書き換えるため、lockfile だけ戻すと次の install で疑わしい version が再解決される（frozen lockfile では失敗する）。**この更新が触れたファイルだけ**を名指しで戻す — `**/package.json` のような repo 全体グロブは dirty worktree / 並列エージェント環境で無関係な workspace の編集を巻き込んで消す（[`.claude/rules/worktree.md`](../../rules/worktree.md) / [`.claude/rules/parallel-work.md`](../../rules/parallel-work.md)）。

```bash
# --filter <ws> で更新したなら <ws>/package.json、root 更新なら ./package.json を名指しする
git checkout -- pnpm-lock.yaml <更新した workspace>/package.json
```

どのファイルが変わったか不明なら `git status` で更新由来の差分だけを確認してから、その path を個別に戻す。戻した上で、その package の公開元・メンテナ・直近リリース履歴を調べてから判断する。

### 2-3. ビルドとテストを通す

```bash
pnpm install                     # lockfile 整合を確認 (build script エラーがここで出る)
pnpm lint && pnpm test           # 既存の動作を壊していないか
```

Rust 側を上げたなら該当クレートの `cargo build` / `cargo test` も通す。

## Phase 3: override を増やさない・減らす (負債の管理)

**override (`pnpm.overrides` / Cargo の `[patch.crates-io]`) は最終手段。** transitive dep の version を強制的にねじ曲げる行為で、上流が直しても気づかず残り続け、別の依存と非互換を起こす負債になる。**override より上流追従を優先**する。

### 3-1. 新しく override を足したくなったら、まず代替を尽くす

transitive dep に脆弱性があって直接上げられないとき、override に飛びつく前に順に試す:

1. **直接依存を上げる** — 脆弱な transitive を引いている直接依存の新版が、内部で fix 版を引いていないか。これが一番きれい。
2. **上流に issue / PR があるか確認する** — 既に上流が動いているなら、待つ判断もある。受容台帳があれば「解消条件」に追記して監視対象にする。
3. **実害がないなら受容する** — 攻撃面が無い（例: dev-server 限定 CVE を loader 用途でしか使わない / known endpoint のみと通信）なら、override で消すより **受容として記録**する方が負債が小さい。台帳が無ければ PR 説明文 / tracking issue に残す。
4. **それでも塞ぐ必要があるなら override** — ここまでで解決できず、かつ攻撃面が実在する場合のみ。足すときは必ず:
   - 「なぜ override が必要か」「外せる条件（上流の何が直れば消せるか）」を記録する。
   - 期限・監視対象を明示し、「いつか外す」を放置しない。

override を足す判断は重い。迷ったら受容 + 記録に倒す。

### 3-2. 既存の override / 受容を外せないか毎回チェックする (このスキルの肝)

更新作業のたびに、**今ある負債を 1 つでも返せないか**を確認する。これをやらないと負債は溜まる一方。

棚卸し対象:

- `pnpm.overrides` / `[patch.crates-io]` の各エントリ
- `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` の各エントリ（cooldown を跨いだ一時例外）
- 受容台帳の各項目の「解消条件」

各エントリについて確認する:

```bash
# その override が押さえている transitive を、上流が fix 版で引くようになっていないか
pnpm why <package>               # 誰がその package を引いているか
pnpm outdated <親package>        # 親依存に新版が出ていないか
```

外せると判明したら:

- override / exclude エントリを削除し、`pnpm install` で lockfile を再解決。
- `pnpm audit` / test が通ることを確認。
- 受容台帳の該当項目を「解消済み」として落とす（記録があれば消す or 解消を記録）。

「外せた」も立派な成果。Phase 6 の報告に必ず含める。

## Phase 4: changeset (release pipeline を止めない)

changeset を使うリポジトリでは、依存更新が **runtime artifact（実行時に使うライブラリ / 配布物）の挙動を変える**なら bump 付き changeset が必須。パッケージ名は `package.json` の `name` を参照する（[`.claude/rules/pr-workflow.md`](../../rules/pr-workflow.md)）。

判断基準:

- ランタイムに乗る依存の更新 → **bump 付き**。security fix は通常 `patch`。
- devDependencies のみ・CI / lint / 型チェックツールだけの更新で runtime artifact が一切変わらない → changeset 不要。

迷ったら bump 付きに倒す（release が止まる事故の方が痛い）。

## Phase 5: セルフレビュー & CI

- [`.claude/rules/ci-workflow.md`](../../rules/ci-workflow.md): push 前に `.github/workflows/` の push/PR トリガーの run コマンドをローカルで通す（lint / test / knip / build）。
- [`.claude/rules/pr-self-review.md`](../../rules/pr-self-review.md): PR 作成前にセルフレビュー 2 回。lockfile 差分・override の追加/削除・受容記録の編集は特に丁寧に見る。
- [`.claude/rules/codex-pairing.md`](../../rules/codex-pairing.md): push 前に `codex review` でセカンドオピニオンを取る（サンドボックスフラグ要件もここ）。

## Phase 6: 報告

簡潔に。含めるもの（[`.claude/rules/conclusion-only-output.md`](../../rules/conclusion-only-output.md) に従い結論と根拠だけ）:

- 上げた package と version（脆弱性対応なら GHSA / RUSTSEC 番号）。
- lockfile 差分で確認した安全性（想定外の dep 増加・新規 build script の有無）。
- **override / 受容に対して行ったこと** — 新規に足したなら理由と外す条件、外せたなら何を返したか。「今回は触る余地が無かった」もそう書く。
- changeset を bump 付き / 不要のどちらにしたか、その理由。
- 残した宿題（上流待ちの受容アドバイザリ等）。

## アンチパターン

| やりがち | なぜダメか | 代わりに |
|---|---|---|
| `pnpm update` で全部最新に上げる | cooldown は効くが breaking change の山を一度に抱える / 脆弱性の優先順位が消える | 脆弱性起点で対象を絞る (Phase 1) |
| lockfile 差分を見ずに通す | worm は新規 transitive dep として紛れ込む | `git diff pnpm-lock.yaml` を必ず読む (Phase 2-2) |
| `strictDepBuilds` のエラーを allowlist 追加で即黙らせる | 後付け postinstall を見逃す = worm の主要伝播経路を素通り | その script が何をするか確認してから (Phase 2-2) |
| transitive 脆弱性に脊髄反射で override | 上流が直しても残る負債。別依存と非互換を起こす | 直接依存上げ → 上流確認 → 受容、を尽くす (Phase 3-1) |
| 既存 override / 受容を見ない | 負債が溜まる一方。外せるのに残り続ける | 毎回棚卸しして外せないか確認 (Phase 3-2) |
| cooldown が邪魔で `minimumReleaseAgeExclude` 常用 | hardening が骨抜き。汚染版を掴むリスクが戻る | hotfix の明確な理由があるときだけ、掃除前提で (Phase 2-1) |
| runtime 依存更新で changeset を省く | release が発火せず変更がユーザーに届かない | runtime artifact が変わるなら bump 付き (Phase 4) |
