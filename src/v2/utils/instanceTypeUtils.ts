/**
 * VRChat インスタンスタイプを判定するユーティリティ
 */

/**
 * インスタンスタイプの信頼度レベル
 */
export type InstanceTypeConfidence = 'high' | 'medium' | 'low';

/**
 * パフォーマンス向上のため事前コンパイル済み正規表現
 */
const REGION_PATTERN = /^[a-z]{2,3}(\([a-z0-9]+\))?$/;

/**
 * 入力値の最大長制限（セキュリティ対策）
 */
const MAX_INSTANCE_ID_LENGTH = 1000;

/**
 * VRChatで使用される既知のリージョンコード
 */
const KNOWN_REGION_CODES = new Set([
  'us',
  'use',
  'usw',
  'eu',
  'jp',
  'au',
  'ap',
  'ase',
  'asw',
]);

/**
 * インスタンスタイプと信頼度を含む結果
 */
export interface InstanceTypeResult {
  type: string | null;
  confidence: InstanceTypeConfidence;
}

/**
 * インスタンスIDからインスタンスタイプと信頼度を取得する
 * @param instanceId インスタンスID文字列
 * @returns インスタンスタイプと信頼度
 */
export const getInstanceTypeWithConfidence = (
  instanceId: string | null,
): InstanceTypeResult => {
  if (!instanceId) return { type: null, confidence: 'low' };

  // セキュリティ：入力値の長さ制限チェック
  if (instanceId.length > MAX_INSTANCE_ID_LENGTH) {
    return { type: null, confidence: 'low' };
  }

  // インスタンスIDに~が含まれていない場合はPublicインスタンス（高信頼度）
  if (!instanceId.includes('~')) {
    return { type: 'public', confidence: 'high' };
  }

  // ~以降の部分を取得
  const parts = instanceId.split('~');
  if (parts.length < 2) {
    return { type: null, confidence: 'low' };
  }

  const typePart = parts[1];

  // 空のtypePartの場合は低信頼度でnullを返す
  if (typePart === '') {
    return { type: null, confidence: 'low' };
  }

  // 既知のプライベートインスタンスパターン（高信頼度）
  if (typePart.startsWith('friends('))
    return { type: 'friends', confidence: 'high' };
  if (typePart.startsWith('hidden('))
    return { type: 'friends+', confidence: 'high' };
  if (typePart.startsWith('private('))
    return { type: 'invite', confidence: 'high' };
  if (typePart.startsWith('group('))
    return { type: 'group', confidence: 'high' };
  if (typePart.startsWith('groupPublic('))
    return { type: 'group-public', confidence: 'high' };

  // リージョン情報のみの場合はPublic（中信頼度）
  if (REGION_PATTERN.test(typePart)) {
    // 既知のリージョンコードかチェック
    const regionMatch = typePart.match(/^([a-z]{2,3})/);
    if (regionMatch && KNOWN_REGION_CODES.has(regionMatch[1])) {
      return { type: 'public', confidence: 'medium' };
    }
    // 未知のリージョンコードの場合は低信頼度
    return { type: 'public', confidence: 'low' };
  }

  // その他の場合（低信頼度）
  return { type: 'unknown', confidence: 'low' };
};

/**
 * インスタンスIDからインスタンスタイプを取得する
 * @param instanceId インスタンスID文字列
 * @returns インスタンスタイプ
 */
export const getInstanceType = (instanceId: string | null): string | null => {
  const result = getInstanceTypeWithConfidence(instanceId);
  return result.type;
};

/**
 * インスタンスタイプのラベルを取得する
 * @param instanceId インスタンスID文字列
 * @returns インスタンスタイプのラベル
 */
export const getInstanceTypeLabel = (instanceId: string | null): string => {
  const type = getInstanceType(instanceId);
  switch (type) {
    case 'public':
      return 'Public';
    case 'friends':
      return 'Friends';
    case 'friends+':
      return 'Friends+';
    case 'invite':
      return 'Invite';
    case 'group':
      return 'Group';
    case 'group-public':
      return 'Group Public';
    case 'unknown':
      return 'Unknown';
    default:
      return '';
  }
};

/**
 * インスタンスタイプの色を取得する（Tailwind CSS用）
 * @param instanceId インスタンスID文字列
 * @returns Tailwind CSSクラス
 */
export const getInstanceTypeColor = (instanceId: string | null): string => {
  const type = getInstanceType(instanceId);
  switch (type) {
    case 'public':
      // パブリック: 緑（変更なし）
      return 'bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30';
    case 'friends':
      // フレンド: 黄色（VRChatサービスに準拠）
      return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/30';
    case 'friends+':
      // フレプラ: 黄色（フレンドと同系色）
      return 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/30';
    case 'invite':
      // インバイト: 紫（VRChatサービスに準拠）
      return 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/30';
    case 'group':
      // グループ: 薄めの灰色（VRChatサービスに準拠）
      return 'bg-gray-400/20 text-gray-600 dark:text-gray-300 border-gray-400/30';
    case 'group-public':
      // グループパブリック: 薄めの灰色（グループと同系色）
      return 'bg-gray-400/20 text-gray-600 dark:text-gray-300 border-gray-400/30';
    case 'unknown':
      return 'bg-gray-500/20 text-gray-700 dark:text-gray-300 border-gray-500/30';
    default:
      return 'bg-gray-500/20 text-gray-700 dark:text-gray-300 border-gray-500/30';
  }
};

/**
 * インスタンスタイプバッジを表示するかどうかを判定する
 * @param instanceId インスタンスID文字列
 * @returns バッジを表示するかどうか
 */
export const shouldShowInstanceTypeBadge = (
  instanceId: string | null,
): boolean => {
  const result = getInstanceTypeWithConfidence(instanceId);
  // 高信頼度または中信頼度の場合のみバッジを表示
  return result.confidence === 'high' || result.confidence === 'medium';
};
