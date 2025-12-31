import * as neverthrow from 'neverthrow';
import { match } from 'ts-pattern';
import { z } from 'zod';
import { getData } from '../../lib/getData';
import type { VRChatWorldId } from '../vrchatLog/model';

/**
 * VRChat API エラー型
 */
export type VRChatApiError =
  | { type: 'WORLD_NOT_FOUND'; worldId: string }
  | { type: 'API_REQUEST_FAILED'; message: string }
  | { type: 'PARSE_ERROR'; issues: string };

/**
 * VRChatApiError からユーザー向けメッセージを取得
 */
export const getVRChatApiErrorMessage = (error: VRChatApiError): string =>
  match(error)
    .with(
      { type: 'WORLD_NOT_FOUND' },
      (e) => `ワールドが見つかりません: ${e.worldId}`,
    )
    .with(
      { type: 'API_REQUEST_FAILED' },
      (e) => `VRChat API リクエストに失敗しました: ${e.message}`,
    )
    .with(
      { type: 'PARSE_ERROR' },
      (e) => `VRChat API レスポンスの解析に失敗しました: ${e.issues}`,
    )
    .exhaustive();

/**
 * id: 'wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f',
 * name: 'はじまりタウン ⁄ Dawnville',
 * description: 'Public設定のホームワールドにして、みんなが集まる最初の街みたいになればいいなプロジェクト ［24․03․20 Update］Quest⁄PC姿確認カメラをアップデートǃ',
 * authorId: 'usr_b1b9f790-c3f1-4b9d-9823-5146c92e1110',
 * authorName: 'ばーゆ ⁄ VarYU',
 * releaseStatus: 'public',
 * featured: false,
 * capacity: 20,
 * recommendedCapacity: 20,
 * imageUrl: 'https://api.vrchat.cloud/api/1/file/file_bc000ef2-482d-4598-90d9-1f487be52322/4/file',
 * thumbnailImageUrl: 'https://api.vrchat.cloud/api/1/image/file_bc000ef2-482d-4598-90d9-1f487be52322/4/256',
 * version: 187,
 * organization: 'vrchat',
 * previewYoutubeId: null,
 * udonProducts: [],
 * favorites: 1474,
 * visits: 52328,
 * popularity: 6,
 * heat: 4,
 * publicationDate: '2023-07-30T15:18:46.763Z',
 * labsPublicationDate: '2023-07-30T06:45:55.412Z',
 * instances: [],
 * publicOccupants: 0,
 * privateOccupants: 0,
 * occupants: 0,
 * unityPackages: [],
 * tags: [ 'author_tag_quest', 'author_tag_night', 'system_approved' ],
 * created_at: '2023-06-21T13:30:58.720Z',
 * updated_at: '2024-03-20T05:59:42.558Z'
 */
export type VRChatWorldInfoFromApi = z.infer<
  typeof VRChatWorldInfoFromApiSchema
>;
/**
 *  {
 *    "assetUrl": "https://api.vrchat.cloud/api/1/file/file_e5014a77-4403-4b62-bf6d-3e16bcd6851b/6/file",
 *    "assetVersion": 4,
 *    "created_at": "2024-12-31T08:25:58.745Z",
 *    "id": "unp_c89824dc-92d2-4d99-a368-2a81f9ef0f9a",
 *    "platform": "android",
 *    "unitySortNumber": 20220322000,
 *    "unityVersion": "2022.3.22f1",
 *    "worldSignature": "AK7LJzmBVYb+jw6Ixz7N7lX3s79ngTzOEGZyfEh7VO/Glkr+Gg=="
 *  },
 */
const VRChatWorldInfoUnityPackagesSchema = z.array(
  z.object({
    assetUrl: z.string(),
    assetVersion: z.number(),
    created_at: z.string(),
    id: z.string(),
    platform: z.enum(['android', 'ios', 'standalonewindows']),
    unitySortNumber: z.number(),
    unityVersion: z.string(),
    worldSignature: z.string(),
  }),
);
const VRChatWorldInfoFromApiSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  releaseStatus: z.string(),
  featured: z.boolean(),
  capacity: z.number(),
  recommendedCapacity: z.number(),
  imageUrl: z.string(),
  thumbnailImageUrl: z.string(),
  version: z.number(),
  organization: z.string(),
  previewYoutubeId: z.string().nullable(),
  udonProducts: z.array(z.string()),
  favorites: z.number(),
  visits: z.number(),
  popularity: z.number(),
  heat: z.number(),
  publicationDate: z.string(),
  labsPublicationDate: z.string(),
  instances: z.array(z.string()),
  publicOccupants: z.number(),
  privateOccupants: z.number(),
  occupants: z.number(),
  unityPackages: VRChatWorldInfoUnityPackagesSchema,
  tags: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
/**
 * VRChat API からワールド情報を取得する
 * ワールドプレビュー生成などで使用される
 */
export const getVrcWorldInfoByWorldId = async (
  worldId: VRChatWorldId,
): Promise<neverthrow.Result<VRChatWorldInfoFromApi, VRChatApiError>> => {
  const reqUrl = `https://api.vrchat.cloud/api/1/worlds/${worldId}`;
  const response = await getData(reqUrl);
  if (!response.isOk()) {
    if (response.error.status === 404) {
      return neverthrow.err({ type: 'WORLD_NOT_FOUND', worldId });
    }
    return neverthrow.err({
      type: 'API_REQUEST_FAILED',
      message: response.error.message,
    });
  }
  const result = VRChatWorldInfoFromApiSchema.safeParse(response.value);
  if (!result.success) {
    return neverthrow.err({
      type: 'PARSE_ERROR',
      issues: JSON.stringify(result.error.issues),
    });
  }
  return neverthrow.ok(result.data);
};

export const UserSchema = z.object({
  bio: z.string().optional(),
  bioLinks: z.array(z.string()).optional(),
  currentAvatarImageUrl: z.string(),
  currentAvatarTags: z.array(z.string()),
  currentAvatarThumbnailImageUrl: z.string(),
  developerType: z.string(),
  displayName: z.string(),
  friendKey: z.string().optional(),
  id: z.string(),
  isFriend: z.boolean(),
  last_login: z.string().optional(),
  last_platform: z.string(),
  profilePicOverride: z.string().optional(),
  pronouns: z.string().optional(),
  status: z.string(),
  statusDescription: z.string().optional(),
  tags: z.array(z.string()),
  userIcon: z.string().optional(),
});
const UsersSchema = z.array(UserSchema);

const requestQueue: (() => Promise<void>)[] = [];
let isProcessingQueue = false;
/**
 * API へのリクエストを順番に処理するための内部キュー
 * 連続リクエストによる制限回避目的で getVrcUserInfoByUserName から使用
 */
const processQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (request) {
      console.log('processQueue', requestQueue.length);
      await request();
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Delay of 1 second
    }
  }
  isProcessingQueue = false;
};

/**
 * ユーザー名からVRChatユーザー情報を取得する
 * 非公開APIのため一定間隔で processQueue 経由でリクエストされる
 */
export const getVrcUserInfoByUserName = async (
  userName: string,
): Promise<
  neverthrow.Result<z.infer<typeof UserSchema>, Error | 'USER_NOT_FOUND'>
> => {
  return new Promise((resolve) => {
    requestQueue.push(async () => {
      const reqUrl = `https://vrchat.com/api/1/users?sort=relevance&fuzzy=false&search=${userName}`;
      const response = await fetch(reqUrl);
      if (!response.ok) {
        throw new Error(`getVrcUserInfoByUserName: ${response.statusText}`);
        // resolve(neverthrow.err(new Error(`getVrcUserInfoByUserName: ${response.statusText}`)));
        // return;
      }
      const json = await response.json();
      const result = UsersSchema.safeParse(json);
      if (!result.success) {
        throw new Error(
          `fail to parse UsersSchema: ${JSON.stringify(result.error.issues)}`,
        );
        // resolve(neverthrow.err(new Error(`fail to parse UsersSchema: ${result.error.errors}`)));
        // return;
      }
      if (result.data.length === 0 || result.data[0].displayName !== userName) {
        resolve(neverthrow.err('USER_NOT_FOUND' as const));
        return;
      }
      resolve(neverthrow.ok(result.data[0]));
    });
    if (!isProcessingQueue) {
      processQueue();
    }
  });
};
