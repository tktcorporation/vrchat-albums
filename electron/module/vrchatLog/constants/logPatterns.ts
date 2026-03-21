/**
 * VRChatログパターンの一元管理
 * フィルタとパーサーで共通利用される定数を定義
 */

export const LOG_PATTERNS = {
  /** [Behaviour] タグ自体。未知パターン検出のフィルタに使用 */
  BEHAVIOUR_TAG: '[Behaviour]' as const,

  // アプリ起動
  APP_START: 'VRC Analytics Initialized' as const,

  // ワールド参加
  WORLD_JOIN: '[Behaviour] Joining ' as const,

  /** ワールド名抽出用。worldJoinParser が後続行から取得する */
  WORLD_NAME: '[Behaviour] Joining or Creating Room:' as const,

  // プレイヤー参加
  PLAYER_JOIN: '[Behaviour] OnPlayerJoined ' as const,

  // プレイヤー退出
  PLAYER_LEAVE: '[Behaviour] OnPlayerLeft ' as const,

  // アプリ終了
  APP_EXIT: 'VRCApplication: HandleApplicationQuit' as const,
} as const;

// フィルタで使用されるパターンのリスト
// パフォーマンスのため具体的なパターンのみ指定し、パーサーに不要な行を渡さない。
// [Behaviour] タグの広範囲フィルタは使わないこと（未知パターン検出は別経路で行う）。
export const FILTER_PATTERNS = [
  LOG_PATTERNS.APP_START,
  LOG_PATTERNS.WORLD_JOIN,
  LOG_PATTERNS.PLAYER_JOIN,
  LOG_PATTERNS.PLAYER_LEAVE,
  LOG_PATTERNS.APP_EXIT,
] as const;

/**
 * パーサーが処理する既知の [Behaviour] パターン一覧
 *
 * 未知パターン検出で使用: この一覧のどれにもマッチしない [Behaviour] 行は
 * VRChat の仕様変更の可能性があるため Sentry に送信される。
 * 新しいパーサーを追加した場合はここにもパターンを追加すること。
 *
 * 注: 'OnPlayerLeft' は 'OnPlayerLeftRoom' にもマッチする（substring matching）。
 * OnPlayerLeftRoom はパーサーで明示的に除外されるが、既知パターンとして
 * Sentry への未知パターン通知を抑制する（意図的な動作）。
 */
export const KNOWN_BEHAVIOUR_PATTERNS = [
  'Joining wrld_',
  'Joining or Creating Room:',
  'OnPlayerJoined',
  'OnPlayerLeft', // OnPlayerLeftRoom も包含する（意図的）
] as const;
