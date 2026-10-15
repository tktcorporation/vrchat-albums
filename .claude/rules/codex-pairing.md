Codex CLI (`codex`) はセカンドオピニオンを得るためのツール。判断が分かれる場面では Codex に壁打ちする。

## 必ず使う場面（MUST）

- **PR 作成・push 前のレビューループを収束させる最後のラウンド**（条件は `pr-self-review.md` の「仕組み」節）: `codex review --base <default-branch>`。ループでは各ラウンドの修正をコミットしてから次に渡すため、`--uncommitted` では対象が空になる。`--uncommitted` はコミット前の手元確認にだけ使う
- **設計方針が2つ以上あり迷う**: `codex exec "2案のトレードオフを分析して: ..."`
- **バグ原因が10分以上特定できない**: `codex exec "このエラーの原因を調査して: ..."`

## 積極的に使う場面（SHOULD）

リファクタ案比較、エッジケース洗い出し、SQL妥当性チェック、既存コード解読

## 使い方

`-c sandbox_mode='"danger-full-access"'` は Codex 側のサンドボックスを無効化する指定で、次節の条件に当てはまる環境でだけ付ける。当てはまらない環境では外して使う。

```bash
codex exec -c sandbox_mode='"danger-full-access"' "プロンプト"                        # 非インタラクティブ実行
codex review -c sandbox_mode='"danger-full-access"' --uncommitted                     # ワークツリーのレビュー
codex exec -c sandbox_mode='"danger-full-access"' "エッジケースを洗い出して" < file   # ファイル渡し

# default branch 差分のレビュー。ブランチ名は origin/HEAD から導出する（worktree.md 参照）
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')"
codex review -c sandbox_mode='"danger-full-access"' --base "$default_branch"
```

### サンドボックスを無効化する条件

kernel が nested user namespace を許可しない環境では、Codex 内蔵の bubblewrap が `bwrap: No permissions to create a new namespace` で exit 1 する。この症状が出て、**かつ実行環境そのものが host から隔離されている（コンテナ・VM の内側にいる）**場合にだけ、Codex 側のサンドボックスを明示的に無効化して使う。

どちらか一方でも満たさないなら無効化しない。症状が出ない環境ではフラグを外し、Codex のファイルシステム隔離をそのまま使う。隔離されていない host で症状が出る場合は、無効化ではなく bubblewrap が動く条件を整える（host 側で unprivileged user namespace を許可する、setuid の bubblewrap を使う等）。

どちらの環境かは記憶に頼らず、次で判定する。コンテナの rebuild 後と Codex の更新後に毎回実行する。

```bash
codex sandbox -- /bin/true   # bwrap のエラーが出なければサンドボックスは機能している
```

### 表示を防御と読み替えない

サンドボックスの構築に失敗した Codex は、`sandbox: workspace-write` と表示したまま隔離なしでコマンドを実行する。表示された範囲の外への書き込みも通る。上の判定が失敗する環境では `workspace-write` を防御として扱わない。

この状態で最も危ないのは、フラグを付け忘れた実行が守られているように見えることなので、正規の実行例はすべて無効化を明示した形に揃える。

### 無効化で何を受け入れるか

ホストカーネルへの防御は外側（コンテナ・VM）が引き続き担う。一方、**Codex からワークスペース・実行環境内の認証情報・ネットワークを守る境界は無くなる**。外側の隔離はこれらを守らない。認証情報を置いた環境で使うなら、その到達範囲を許容できることが前提になる。

### コンテナ側で user namespace を解禁して直さない

実行環境の seccomp プロファイルを緩めれば bubblewrap は動くが、失う防御は実行環境の全プロセスに及ぶ一方、得られるのは Codex 単体の隔離に限られる。適用範囲が釣り合わない。共有テンプレートで配る設定なら、外側に VM を持たない環境へも同じ緩和が届く。

Codex のサンドボックスが必要になったときの再検討案は、上流の既定プロファイルから差分を生成し、bubblewrap が要求する syscall だけを足す形になる。固定コピーを持つと上流の更新を取り込めず防御が劣化するので避ける。許可粒度は粗くなりうる（`clone3` は引数構造体の中の namespace フラグを通常の引数フィルタで判定できない）ため、少数の syscall に絞れることをもって安全とは評価しない。

`-c` で config を上書きする方式に統一する理由: `--dangerously-bypass-approvals-and-sandbox` フラグは `codex exec` 限定で、`codex review` には対応フラグが無く `-c` でしか sandbox を切り替えられない。書き分けると writeup と allowlist が増えるので、両サブコマンドで通る `-c sandbox_mode='"danger-full-access"'` に揃える。`approval_policy` は非インタラクティブ実行で default `never` のため省略。

フラグを忘れても実行は失敗しない。`bwrap: No permissions to create a new namespace` を出しながら exit 0 で完走する。エラー行を見落とすと、隔離されたつもりの実行がそのまま隔離なしで通る。判定で無効化が要ると分かった環境では、フラグを常時付ける。

**注意**: インタラクティブモード（引数なし `codex`）は使わない。大きなプロンプトは `timeout 120` を付ける。Codex の出力は参考意見、最終判断は自分が行う。
