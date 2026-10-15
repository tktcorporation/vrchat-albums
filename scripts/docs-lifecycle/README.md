# docs-lifecycle

ドキュメントの鮮度、リンク切れ、削除済みドキュメントへの参照を検査する。
実装・依存宣言・lockfile・テストをこのディレクトリにまとめ、同期先リポジトリの
JavaScript パッケージ構成に依存せず実行できるようにしている。

```bash
# 検査
mise run lint-docs

# 違反していないドキュメントも表示
mise run lint-docs -- --list

# テスト
bun scripts/docs-lifecycle/run.ts test
```

`mise run lint-docs` は bun を用意してから `run.ts` を呼ぶ。bun が入っている環境では
`bun scripts/docs-lifecycle/run.ts` を直接叩いてもよく、`--list` や `--json` も同じように渡せる。
ただし `bun.lock` は lockfileVersion 2 で、これを読めない古い bun では動かない。必要な
バージョンは `package.json` の `packageManager` が決め、`run.ts` が起動時に確かめて、
下回っていればその場で止める。手元の bun が古いときは `mise run lint-docs` を使う。

`run.ts` は本体やテストの起動前に `bun install --frozen-lockfile` を実行する。初回実行時は
npm registry への接続が必要だが、依存はこのディレクトリの `node_modules` だけに置かれ、
リポジトリルートのパッケージ構成には追加されない。Bun のグローバルキャッシュがあれば、
2 回目以降の同期にネットワークは要らない。

依存を更新するときはこのディレクトリで `bun install --lockfile-only` を実行し、
`package.json` と `bun.lock` を同じ変更に含める。
