# ADR-005: Main プロセスの CPU バウンドなネイティブ処理は worker_threads にオフロードする

- **ステータス**: accepted
- **日付**: 2026-09-12
- **関連コード**: `electron/module/imageGenerator/renderWorker.ts`, `electron/module/imageGenerator/workerClient.ts`, `electron/module/imageGenerator/jobRunner.ts`
- **関連ルール**: なし（レビューで強制。将来的に `electron/module/**/service.ts` から `resvg`/`@napi-rs/image` の直接呼び出しを検出する ast-grep ルールを追加余地あり）

## コンテキスト

Share プレビュー画像生成（`generateSharePreview`）が Main プロセスの tRPC ハンドラ内で `@resvg/resvg-js` の `resvg.render()` を直接・同期的に呼び出していた。この処理は CPU バウンドなネイティブ処理であり、`feGaussianBlur` を含む SVG を 1600px 幅にラスタライズするため実行時間が無視できない。

Electron の Main プロセスはウィンドウメッセージポンプ・全 IPC と同一のイベントループを共有するシングルスレッドである。ここで同期的にブロックする処理を実行すると、その間 Main プロセスは他の一切の処理（ウィンドウ操作、他の IPC 応答）を受け付けなくなり、アプリ全体が「応答なし」の状態になる。

これは単発の重い呼び出しでも体感できる問題だが、実際には別の設計不備（ADR-006 が扱う、tRPC の mutation を `useEffect` から不安定な参照で駆動していた問題）と組み合わさり、この重い処理が連続して呼ばれ続ける無限ループが発生し、写真一覧のグループヘッダーからシェアダイアログを開くとアプリが完全にフリーズして復帰しない、という不具合として顕在化した。

呼び出し側のコードからは、あるサービス関数が「軽い問い合わせ」なのか「Main スレッドを長時間ブロックする重い処理」なのかを区別する手段が存在しなかった。これが根本原因であり、個々の呼び出し箇所を都度非同期化する対症療法では、今後 Main プロセスに重い処理が追加されるたびに同じ罠を再生産する。

## 決定

Main プロセスで同期的な CPU バウンドのネイティブ処理（画像レンダリング、大きな SVG のラスタライズ等）を行う場合、**必ず `worker_threads` の Worker 上で実行し、Main プロセスのイベントループを一切ブロックしない。**

具体的な構成:

- `jobRunner.ts`: 色抽出・SVG テンプレート生成・レンダリングをまとめた、Electron API に依存しない純粋な入力→出力の関数。worker からもユニットテストからも同一ロジックとして呼び出せる。
- `renderWorker.ts`: `worker_threads` の Worker エントリ。`parentPort` 経由でジョブを受け取り `jobRunner` を実行し、結果を `postMessage` で返す。Electron API には一切依存しない。
- `workerClient.ts`: Main プロセス側の薄いディスパッチャ。Worker を spawn し、ジョブを送信して結果を Effect として受け取る。Worker のクラッシュ・異常終了・タイムアウトは `WorkerCrashed` エラーとして扱う。message/error/exit のいずれのイベントでも必ず一度は settle し、応答が一定時間（30秒）内に届かない場合はタイムアウトとして worker を強制終了する（`message` も `error` も届かないまま worker が終了した場合や、resvg が実際にハングした場合に Effect が永久に未解決になることを防ぐ）。
- フォントパス解決（`loadFonts()`）など Electron API (`app.isPackaged` 等) に依存する処理は `fontPaths.ts` として Main プロセス側に分離し、解決済みの値のみを worker に渡す。worker 側の `renderSvg.ts`/`jobRunner.ts`/`renderWorker.ts` は Electron API を一切 import しない。
- worker との通信で送るエラーは `Data.TaggedError` インスタンスではなく `{ _tag, message }` のプレーンオブジェクトに変換して送る。`Data.TaggedError` は `Error` のサブクラスであり、`postMessage` の構造化クローンは Error 系の値について `_tag` 等の独自プロパティを保持しない（name/message/stack のみ転送される）ため、変換を怠ると受信側で一切のエラーが再分類不能になる。
- `renderWorkerProtocol.ts`: `renderWorker.ts` と `workerClient.ts` の双方が参照する `workerData` の目印（`RENDER_WORKER_KIND`）だけを持つ独立ファイル。Main プロセス側の `workerClient.ts` が `renderWorker.ts` を直接 import すると worker_threads 専用の副作用付きコードが Main のバンドルに巻き込まれるため、値の共有だけを目的に切り出している。この目印は、テストランナーが `pool: 'threads'` で動作した場合に `parentPort` の有無だけでは worker_threads の起動を判定できない（テストランナー自身のメッセージを誤って掴みうる）ことへの対策でもある。

`electron/vite.config.ts` の `build.lib.entry` に `renderWorker` を独立エントリとして追加し、`main/renderWorker.cjs` としてビルドする。Main プロセスは常にビルド済み `main/index.cjs` から起動される（dev/packaged 共通）ため、`workerClient.ts` は自身の `__dirname` からの相対パスで worker スクリプトを解決できる。ただしパッケージ済み (asar) 環境では `__dirname` が asar 内の仮想パスを指すため、`resolveWorkerScriptPath()` は `app.asar` を `app.asar.unpacked` に書き換えてから解決する（後述）。

## 根拠

- **責務の配置**: 「Main スレッドを長時間占有してよいか」はプロセスアーキテクチャ上の制約であり、個々のサービス関数の実装詳細に委ねるべきではない。worker_threads という別の実行コンテキストに切り出すことで、この制約を型やレビューではなくアーキテクチャそのもので強制する。
- **契約の明確化**: `jobRunner.ts` を Electron API 非依存の純粋関数として切り出したことで、「この関数は worker で実行可能」という契約がモジュール境界として表現される。
- **テスト容易性の両立**: `jobRunner.ts` 単体はモックを使った高速なユニットテスト（`jobRunner.spec.ts`）で検証し、`workerClient.ts` は実際にビルドした worker スクリプトを使った統合テスト（`workerClient.integration.test.ts`）でモックなしに end-to-end の動作を保証する。

## 許容される例外

- 数ミリ秒〜十数ミリ秒程度で完了する軽量な同期処理（例: 小さな JSON のパース、短い文字列操作）は対象外。「Main プロセスの応答性を体感的に損なうか」で判断する。
- ネイティブモジュールの読み込み自体（`require`）はブロッキングだが一過性のコストであり対象外。

パッケージ済み (asar) 環境では、`electron-builder.cjs` の `asarUnpack` に `main/**` を追加し、Main プロセスの全ビルド成果物（`renderWorker.cjs` を含む）を asar の外（`app.asar.unpacked/`）に展開する。worker_threads の Worker を asar 内のスクリプトパスから起動できるかは検証手段がなく未確認のため、そもそも asar 経由にしないことでこのリスクを構造的に排除する。

## 結果

- Share プレビュー画像生成は worker_threads 上で実行され、レンダリング中も Main プロセス・ウィンドウは応答可能な状態を維持する。
- 同じ画像生成パイプラインを使う `generateWorldJoinImage`（ワールド参加時の自動画像生成）も同じ経路に統一され、ログ同期処理中の Main プロセスブロックも解消される。
- 今後 Main プロセスに重い処理を追加する際、同じ `jobRunner` / `renderWorker` / `workerClient` の構成パターンを踏襲することで再発を防止できる。
- `pnpm pack`（electron-builder の `--dir` ビルド）で実際にパッケージし、`app.asar.unpacked/main/` に `renderWorker.cjs` を含む全ビルド成果物が展開されることを確認済み。実機での GUI 起動（インストーラ経由の起動確認）はこの開発環境に表示デバイスがないため未実施。

## 反証条件（ADR を見直すべき状況）

- 画像生成の呼び出し頻度が大幅に増加し、Worker の起動コスト（プロセス内スレッド生成、数十ms 程度）がボトルネックになる場合。その場合は使い捨て Worker ではなく永続的な Worker プールへの変更を検討する。
- Electron が Main プロセスのマルチスレッド化・別プロセス分離をより低コストに行える機構（`utilityProcess` の活用等）を標準的に採用する方針に切り替える場合。
