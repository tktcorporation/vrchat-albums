/**
 * VRChat ID の検証パターンと関数を集約したモジュール
 *
 * このモジュールは VRChat の各種 ID の検証ロジックを一元管理し、
 * 複数のモジュール間で共有できるようにします。
 */

/**
 * VRChat World ID のパターン
 * 形式: wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export const VRCHAT_WORLD_ID_PATTERN =
  /^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * VRChat Player ID のパターン
 * 形式: usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export const VRCHAT_PLAYER_ID_PATTERN =
  /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * VRChat World Instance ID のパターン
 * 形式:
 * - 英数字のみ (例: 12345, 83c39dd3c3)
 * - UUID形式 (例: 0abb3e08-82db-43f1-b6fe-ee59c2ffc335)
 * - 上記 + ~region(region_code) などの接尾辞
 */
export const VRCHAT_WORLD_INSTANCE_ID_PATTERN =
  /^([a-zA-Z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(~.+)?$/i;

/**
 * VRChat World ID の検証関数
 */
export const isValidVRChatWorldId = (value: string): boolean =>
  VRCHAT_WORLD_ID_PATTERN.test(value);

/**
 * VRChat Player ID の検証関数
 */
export const isValidVRChatPlayerId = (value: string): boolean =>
  VRCHAT_PLAYER_ID_PATTERN.test(value);

/**
 * VRChat World Instance ID の検証関数
 */
export const isValidVRChatWorldInstanceId = (value: string): boolean =>
  VRCHAT_WORLD_INSTANCE_ID_PATTERN.test(value);

/**
 * VRChat Player Name の検証関数
 * 空文字列ではない文字列
 */
export const isValidVRChatPlayerName = (value: string): boolean =>
  value.trim().length > 0;

/**
 * VRChat World Name の検証関数
 * 空文字列ではない文字列
 */
export const isValidVRChatWorldName = (value: string): boolean =>
  value.trim().length > 0;
