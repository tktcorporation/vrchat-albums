import * as neverthrow from 'neverthrow';
import { z } from 'zod';
import { getData } from '../../lib/getData';
import type { VRChatWorldId } from './valueObject';

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
export const getVrcWorldInfoByWorldId = async (
  worldId: VRChatWorldId,
): Promise<
  neverthrow.Result<VRChatWorldInfoFromApi, Error | 'WORLD_NOT_FOUND'>
> => {
  const reqUrl = `https://api.vrchat.cloud/api/1/worlds/${worldId.value}`;
  const response = await getData(reqUrl);
  if (!response.isOk()) {
    if (response.error.status === 404) {
      return neverthrow.err('WORLD_NOT_FOUND' as const);
    }
    return neverthrow.err(
      new Error(`getVrcWorldInfoByWorldId: ${response.error.message}`),
    );
  }
  const result = VRChatWorldInfoFromApiSchema.safeParse(response.value);
  if (!result.success) {
    return neverthrow.err(
      new Error(`fail to parse VRChatWorldInfoFromApi: ${result.error.errors}`),
    );
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
 * Auth してからじゃないと使えなさそう
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
        throw new Error(`fail to parse UsersSchema: ${result.error.errors}`);
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
