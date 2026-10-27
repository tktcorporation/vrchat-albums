Codex CLI (`codex`) はセカンドオピニオンを得るためのツール。判断が分かれる場面では Codex に壁打ちする。

## 必ず使う場面

- **PR 作成・push 前のレビューループを収束させる最後のラウンド**（条件は `pr-self-review.md` の「仕組み」節）: `codex review --base <default-branch>`。ループでは各ラウンドの修正をコミットしてから次に渡すため、`--uncommitted` では対象が空になる。`--uncommitted` はコミット前の手元確認にだけ使う
- **設計方針が 2 つ以上あり迷う**: `codex exec "2案のトレードオフを分析して: ..."`
- **バグ原因が 10 分以上特定できない**: `codex exec "このエラーの原因を調査して: ..."`

リファクタ案の比較、エッジケースの洗い出し、SQL の妥当性チェック、既存コードの解読でも積極的に使う。

## 使い方

```bash
codex exec -c sandbox_mode='"danger-full-access"' "プロンプト"                        # 非インタラクティブ実行
codex review -c sandbox_mode='"danger-full-access"' --uncommitted                     # ワークツリーのレビュー
codex exec -c sandbox_mode='"danger-full-access"' "エッジケースを洗い出して" < file   # ファイル渡し

# default branch 差分のレビュー。ブランチ名は origin/HEAD から導出する（worktree.md 参照）
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')"
codex review -c sandbox_mode='"danger-full-access"' --base "$default_branch"
```

インタラクティブモード（引数なし `codex`）は使わない。大きなプロンプトは `timeout 120` を付ける。Codex の出力は参考意見で、最終判断は自分が行う。

## サンドボックスを無効化する条件

`-c sandbox_mode='"danger-full-access"'` は Codex 側のサンドボックスを無効化する指定で、次の 2 条件を両方満たす環境でだけ付ける。

1. `codex sandbox -- /bin/true` が `bwrap: No permissions to create a new namespace` で失敗する（kernel が nested user namespace を許可しない）
2. 実行環境そのものがコンテナ・VM の内側にあり、host から隔離されている

判定はコンテナの rebuild 後と Codex の更新後に毎回やり直す。判定が通る環境ではフラグを外し、Codex の隔離をそのまま使う。隔離されていない host で 1 が失敗するなら、無効化ではなく bubblewrap が動く条件を整える（unprivileged user namespace の許可、setuid の bubblewrap 等）。

無効化すると、ホストカーネルは外側のコンテナ・VM が引き続き守るが、ワークスペース・実行環境内の認証情報・ネットワークを Codex から守る境界は無くなる。認証情報を置いた環境では、その到達範囲を許容できることが前提になる。

1 が失敗する環境では、Codex は `sandbox: workspace-write` と表示したまま隔離なしで実行し、フラグを忘れても exit 0 で完走する。表示を防御と読み替えず、その環境ではフラグを常時付ける。

コンテナの seccomp を緩めて user namespace を解禁する対処はしない。失う防御が実行環境の全プロセスに及ぶ一方、得られるのは Codex 単体の隔離だけで、共有テンプレート経由で外側に VM を持たない環境にも緩和が届く。

`-c` で config を上書きする方式に揃えるのは、`--dangerously-bypass-approvals-and-sandbox` が `codex exec` 専用で、`codex review` では `-c` でしか sandbox を切り替えられないため。`approval_policy` は非インタラクティブ実行で既定が `never` なので省略する。
