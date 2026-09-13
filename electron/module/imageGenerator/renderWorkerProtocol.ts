/**
 * renderWorker.ts と workerClient.ts の双方から参照される、worker_threads の
 * workerData の目印。
 *
 * 背景: テストランナー（vitest 等）が pool: 'threads' で動作する場合、
 * テストコード自体が worker_threads 上で実行され `parentPort` が非 null に
 * なりうる。renderWorker.ts 側で parentPort の有無だけを判定条件にすると、
 * テストランナー自身のメッセージを誤って掴んでしまう可能性がある。
 * workerData の一致も必須にすることでその依存を断つ。
 *
 * Main プロセス側の workerClient.ts が renderWorker.ts を直接 import すると、
 * worker_threads 起動時にのみ動くはずの副作用付きコードが Main プロセスの
 * バンドルに巻き込まれる。この定数を独立したファイルに切り出すことで、
 * workerClient.ts は renderWorker.ts の実体を import せずに済む。
 */
export const RENDER_WORKER_KIND = 'vrchat-albums-render-worker';
