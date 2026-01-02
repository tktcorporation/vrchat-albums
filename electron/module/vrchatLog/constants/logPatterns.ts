/**
 * VRChatログパターンの一元管理
 * フィルタとパーサーで共通利用される定数を定義
 */

export const LOG_PATTERNS = {
  // アプリ起動
  APP_START: 'VRC Analytics Initialized' as const,

  // ワールド参加
  WORLD_JOIN: '[Behaviour] Joining ' as const,

  // プレイヤー参加
  PLAYER_JOIN: '[Behaviour] OnPlayerJoined ' as const,

  // プレイヤー退出
  PLAYER_LEAVE: '[Behaviour] OnPlayerLeft ' as const,

  // アプリ終了
  APP_EXIT: 'VRCApplication: HandleApplicationQuit' as const,
} as const;

// フィルタで使用されるパターンのリスト
export const FILTER_PATTERNS = [
  LOG_PATTERNS.APP_START,
  LOG_PATTERNS.WORLD_JOIN,
  LOG_PATTERNS.PLAYER_JOIN,
  LOG_PATTERNS.PLAYER_LEAVE,
  LOG_PATTERNS.APP_EXIT,
] as const;
