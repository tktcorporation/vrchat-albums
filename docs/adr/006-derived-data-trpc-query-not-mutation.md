# ADR-006: 副作用のない導出データの tRPC procedure は mutation ではなく query にする

- **ステータス**: accepted
- **日付**: 2026-09-12
- **関連コード**: `electron/module/imageGenerator/imageGeneratorController.ts`, `src/v2/components/LocationGroupHeader/ShareDialog.tsx`
- **関連ルール**: なし（レビューで強制。`.mutation()` の呼び出しがサーバー側の状態変更を伴わないケースを機械的に検出するのは困難なため）

## コンテキスト

Share プレビュー画像生成 `generateSharePreview` は `(worldName, imageBase64, players, showAllPlayers) → pngBase64` という決定的な入力→出力の写像であり、サーバー側の状態変更を一切伴わない。にもかかわらず tRPC の `mutation` として実装されていた。

`mutation` は React Query 上では手動でいつ実行するか（`mutate`/`mutateAsync` の呼び出しタイミング）を呼び出し側が管理する必要がある。呼び出し側の `ShareDialog.tsx` はこれを `useEffect` + `useCallback` で駆動していたが、`useCallback` の依存配列に含まれる `useMutation` の戻り値オブジェクト（`isPending` 等の状態が変わるたびに新しい参照になる）と、親コンポーネントで毎レンダー再生成される `players` 配列が、意図せず `useEffect` の再実行条件に混入した。結果として「入力が変わっていなくても、レンダーのたびに画像生成が再実行される」自己増殖的なループが発生し、ADR-005 が扱う Main プロセスの重い同期処理と組み合わさってアプリ全体がフリーズする不具合につながった。

根本的には、「同じ入力に対しては1回しか計算しない」という不変条件を、手続き的な `useEffect` の依存配列管理という壊れやすい仕組みに委ねていたことが問題だった。この不変条件を守る責務がコード上のどこにも明示されておらず、`players` のようなオブジェクト参照の安定性という実装都合にデータフローの正しさが依存していた。

## 決定

**サーバー側の状態変更を伴わない、入力から出力への決定的な導出計算は、tRPC の `query` として実装する。** `mutation` は副作用（DB 書き込み、ファイル操作、外部 API への状態変更リクエスト等）を伴う操作にのみ用いる。

フロントエンド側は、このような導出データを `useQuery` で取得する。`useQuery` の `queryKey` は値の構造的ハッシュで比較されるため、以下が自動的に保証される。

- 呼び出し元のオブジェクト参照が毎レンダー変わっても、内容が同じであれば再フェッチされない（例: `players.map(...)` が生成する新しい配列でも、要素の内容が同じなら同一の queryKey とみなされる）。
- 「同じ入力に対しては1回しか計算しない」という不変条件が、`useEffect` の手動管理ではなく React Query のキャッシュ機構そのものによって構造的に保証される。

これにより、`ShareDialog.tsx` から `useEffect` / `useCallback` / 生成結果を保持する `useState` が不要になり、コンポーネントは宣言的なデータフローのみで完結する。

## 根拠

- **不正な状態を表現不可能にする**: 「入力が同じなら1回だけ計算する」という契約を、呼び出し側の実装規律（依存配列の書き方、参照の安定化）ではなく、データ取得の仕組み自体（queryKey の構造比較）に持たせることで、同種の不具合が別の呼び出し元で再発する可能性を構造的に排除する。
- **責務の一致**: `query`/`mutation` という tRPC の語彙自体が「副作用の有無」を表現するためのものであり、実装をこの語彙に正しく合わせることで、コードを読む側が「これは呼ぶたびに何かが起きるのか、それとも値を取得するだけなのか」を型・API から判断できるようになる。
- **手続き的オーケストレーションの削減**: `useEffect` + `useCallback` + 手動 `useState` という組み合わせは、依存配列の管理を誤ると容易にループや二重実行を引き起こす壊れやすいパターン。宣言的なデータ取得に置き換えることでこのクラスの不具合を出力から排除する。

## 許容される例外

- 同じ入力に対して毎回サーバー側に新しい処理を要求したい場合（例: キャッシュを無視して強制的に再生成したい「再生成」ボタン等）は、`query` の `refetch()` を明示的に呼び出す形にし、`mutation` は用いない。
- 本当に副作用を伴う処理（ファイル書き込み・クリップボード操作・外部システムの状態変更）は引き続き `mutation` とする（例: `downloadImageAsPhotoLogPng`, `copyImageDataByBase64`）。

## 結果

- `generateSharePreview` が `query` になったことで、`ShareDialog.tsx` から手動オーケストレーション用の `useEffect`/`useCallback`/`useState` が削除され、コードが単純になった。
- `players` 配列の参照が毎レンダー変わっても、内容が同じであれば `generateSharePreview` は再実行されない（回帰テスト: `src/v2/components/LocationGroupHeader/ShareDialog.test.tsx`）。

## 反証条件（ADR を見直すべき状況）

- tRPC/React Query が `query` の副作用フリーな決定性を前提としない設計に変わった場合。
- サーバー側の計算コストが極めて高く、React Query のキャッシュ無効化条件だけでは呼び出し頻度を制御しきれない場合（その場合でも `mutation` に戻すのではなく、`query` の `staleTime`/`enabled` の調整を優先検討する）。
