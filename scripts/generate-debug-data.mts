#!/usr/bin/env node

/**
 * # デバッグデータ生成スクリプト
 *
 * このスクリプトは、VRChatのログファイルと写真ファイルを自動生成するためのものです。アプリケーションのテストやデバッグに役立ちます。
 *
 * ## 機能
 *
 * - VRChatのログファイルを `debug/logs/` ディレクトリに生成
 * - VRChatの写真ファイルを `debug/photos/VRChat/YYYY-MM/` ディレクトリに生成
 * - ランダムなワールド情報とプレイヤー情報を含むログを作成
 * - 実際のVRChatログと互換性のある形式でログを出力
 * - 異なる解像度の写真ファイルを生成
 *
 * ## 使い方
 *
 * ```bash
 * # npmスクリプト経由で実行
 * yarn generate:debug-data
 *
 * # または直接実行
 * node scripts/generate-debug-data.mts
 * ```
 *
 * ## 生成されるデータ
 *
 * ### ログファイル
 *
 * ログファイルは以下の形式で生成されます：
 * ```
 * output_log_YYYY-MM-DD_HH-MM-SS.txt
 * ```
 *
 * ログファイルには以下の情報が含まれます：
 * - VRC初期化情報
 * - ワールドへの参加情報 (ワールドID、インスタンスID、ワールド名)
 * - プレイヤーの参加・退出情報
 *
 * ### 写真ファイル
 *
 * 写真ファイルは以下の形式で生成されます：
 * ```
 * VRChat_YYYY-MM-DD_HH-MM-SS.SSS_WIDTHxHEIGHT.png
 * ```
 *
 * 写真ファイルは異なる解像度でランダムに生成されます：
 * - 1280x720
 * - 1920x1080
 * - 2560x1440
 * - 1280x1920 (たて長)
 * - 1440x2560 (たて長)
 *
 * ## 補足
 *
 * このスクリプトで生成したデータをアプリケーションに読み込ませるには、アプリケーションを起動し、ギャラリー画面の更新ボタンをクリックしてください。
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'date-fns';

// ES moduleでの__dirnameの代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 設定
const DEBUG_DIR = path.join(path.resolve(__dirname, '..'), 'debug');
const LOGS_DIR = path.join(DEBUG_DIR, 'logs');
const PHOTOS_DIR = path.join(DEBUG_DIR, 'photos', 'VRChat');

// 現在の日時
const _NOW = new Date();
const _DATE_FORMAT = 'yyyy-MM-dd';
const _TIME_FORMAT = 'HH-mm-ss';

// 型定義
interface WorldInfo {
  worldId: string;
  worldName: string;
  instanceId: string;
}

interface UserInfo {
  userId: string;
  userName: string;
}

interface LogInfo {
  logFilePath: string;
  worldInfo: WorldInfo;
  joinDate: Date;
  playerInfo: UserInfo;
  playerJoinDate: Date;
  playerLeaveDate: Date;
}

// イベント時間の定義
interface EventTimes {
  // VRChatの起動時間（Analytics初期化）
  initTime: Date;
  // ワールド参加時間
  worldJoinTime: Date;
  // プレイヤー参加時間
  playerJoinTime: Date;
  // 写真撮影時間
  photoTakenTime: Date;
  // プレイヤー退出時間
  playerLeaveTime: Date;
}

/**
 * イベント時間を生成する関数
 * すべての時間はコマンド実行時間（現在時刻）を基準に設定されます
 */
function generateEventTimes(): EventTimes {
  const now = new Date();

  // ワールド参加時間 = 現在時刻
  const worldJoinTime = now;

  // VRC起動時間 = ワールド参加の30秒前
  const initTime = new Date(worldJoinTime.getTime() - 30 * 1000);

  // 写真撮影時間 = ワールド参加の1秒後
  const photoTakenTime = new Date(worldJoinTime.getTime() + 1 * 1000);

  // プレイヤー参加時間 = ワールド参加の5秒後
  const playerJoinTime = new Date(worldJoinTime.getTime() + 5 * 1000);

  // プレイヤー退出時間 = プレイヤー参加の10秒後
  const playerLeaveTime = new Date(playerJoinTime.getTime() + 10 * 1000);

  return {
    initTime,
    worldJoinTime,
    playerJoinTime,
    photoTakenTime,
    playerLeaveTime,
  };
}

// ランダムなワールド情報を生成する関数
function generateRandomWorldInfo(): WorldInfo {
  const worldIds = [
    'wrld_6fecf18a-ab96-43f2-82dc-ccf79f17c34f', // はじまりタウン ⁄ Dawnville
    'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b', // The Black Cat
    'wrld_791ebf58-54ce-4d3a-a0a0-39f10e1b20b2', // SUNSET ROOFTOP
    'wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b', // The Great Pug
    'wrld_5b89c79e-c340-4510-be1b-476e9fcdedcc', // Void Club
  ];

  const worldNames = [
    'はじまりタウン ⁄ Dawnville',
    'The Black Cat',
    'SUNSET ROOFTOP',
    'The Great Pug',
    'Void Club',
  ];

  const index = Math.floor(Math.random() * worldIds.length);
  return {
    worldId: worldIds[index],
    worldName: worldNames[index],
    instanceId: `${Math.floor(Math.random() * 99999)}~region(jp)`,
  };
}

// ランダムなユーザー情報を生成する関数
function generateRandomUserInfo(): UserInfo {
  const userIds = [
    'usr_3ba2a992-724c-4463-bc75-7e9f6674e8e0',
    'usr_b1b9f790-c3f1-4b9d-9823-5146c92e1110',
    'usr_5b89c79e-c340-4510-be1b-476e9fcdedcc',
    'usr_4cf554b4-430c-4f8f-b53e-1f294eed230b',
    'usr_791ebf58-54ce-4d3a-a0a0-39f10e1b20b2',
  ];

  const userNames = ['tkt', 'ばーゆ ⁄ VarYU', 'Player1', 'Player2', 'Player3'];

  const index = Math.floor(Math.random() * userIds.length);
  return {
    userId: userIds[index],
    userName: userNames[index],
  };
}

// ログファイルを生成する関数
function generateLogFile(eventTimes: EventTimes): LogInfo {
  const logDate = format(new Date(), 'yyyy-MM-dd');
  const logTime = format(new Date(), 'HH-mm-ss');
  const logFilename = `output_log_${logDate}_${logTime}.txt`;
  const logFilePath = path.join(LOGS_DIR, logFilename);

  console.log(`Generating log file: ${logFilename}`);

  // 時間フォーマット
  const formattedInitTime = `${format(
    eventTimes.initTime,
    'yyyy.MM.dd',
  )} ${format(eventTimes.initTime, 'HH:mm:ss')}`;

  const formattedJoinTime = `${format(
    eventTimes.worldJoinTime,
    'yyyy.MM.dd',
  )} ${format(eventTimes.worldJoinTime, 'HH:mm:ss')}`;

  const formattedPlayerJoinTime = `${format(
    eventTimes.playerJoinTime,
    'yyyy.MM.dd',
  )} ${format(eventTimes.playerJoinTime, 'HH:mm:ss')}`;

  const formattedPlayerLeaveTime = `${format(
    eventTimes.playerLeaveTime,
    'yyyy.MM.dd',
  )} ${format(eventTimes.playerLeaveTime, 'HH:mm:ss')}`;

  // ワールド情報
  const worldInfo = generateRandomWorldInfo();

  // プレイヤー情報
  const playerInfo = generateRandomUserInfo();

  // ログファイルの内容
  const logContent = [
    `${formattedInitTime} Debug      -  VRC Analytics Initialized`,
    `${formattedJoinTime} Debug      -  [Behaviour] Joining ${worldInfo.worldId}:${worldInfo.instanceId}`,
    `${formattedJoinTime} Debug      -  [Behaviour] Joining or Creating Room: ${worldInfo.worldName}`,
    `${formattedPlayerJoinTime} Debug      -  [Behaviour] OnPlayerJoined ${playerInfo.userName} (${playerInfo.userId})`,
    `${formattedPlayerLeaveTime} Debug      -  [Behaviour] OnPlayerLeft ${playerInfo.userName} (${playerInfo.userId})`,
  ].join('\n');

  // ディレクトリが存在しない場合は作成
  if (!fs.existsSync(path.dirname(logFilePath))) {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  }

  // ファイル書き込み
  fs.writeFileSync(logFilePath, logContent);

  return {
    logFilePath,
    worldInfo,
    joinDate: eventTimes.worldJoinTime,
    playerInfo,
    playerJoinDate: eventTimes.playerJoinTime,
    playerLeaveDate: eventTimes.playerLeaveTime,
  };
}

// 写真ファイルを生成する関数
function generatePhotoFile(
  eventTimes: EventTimes,
  _worldInfo: WorldInfo,
): string | null {
  // 写真撮影日時を使用
  const photoDate = eventTimes.photoTakenTime;
  const photoMonth = format(photoDate, 'yyyy-MM');
  const photoDateFormatted = format(photoDate, 'yyyy-MM-dd');
  const photoTimeFormatted = format(photoDate, 'HH-mm-ss');
  const photoMillis = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');

  // ランダムな解像度
  const resolutions = [
    '1280x720',
    '1920x1080',
    '2560x1440',
    '1280x1920',
    '1440x2560',
  ];
  const resolution =
    resolutions[Math.floor(Math.random() * resolutions.length)];
  const [width, height] = resolution.split('x').map(Number);

  const photoFilename = `VRChat_${photoDateFormatted}_${photoTimeFormatted}.${photoMillis}_${resolution}.png`;
  const photoDir = path.join(PHOTOS_DIR, photoMonth);
  const photoFilePath = path.join(photoDir, photoFilename);

  console.log(`Generating photo file: ${photoFilename}`);

  // ディレクトリが存在しない場合は作成
  if (!fs.existsSync(photoDir)) {
    fs.mkdirSync(photoDir, { recursive: true });
  }

  // ランダムな背景色とテキスト色
  const bgColor = Math.floor(Math.random() * 16777215)
    .toString(16)
    .padStart(6, '0');
  const textColor = Math.floor(Math.random() * 16777215)
    .toString(16)
    .padStart(6, '0');

  // placehold.jpを使用して画像を生成
  try {
    const url = `https://placehold.jp/${textColor}/${bgColor}/${width}x${height}.png`;
    const curlCommand = `curl -s "${url}" -o "${photoFilePath}"`;
    execSync(curlCommand);
    console.log(`Created photo: ${photoFilePath}`);
    return photoFilePath;
  } catch (error) {
    console.error(
      `Failed to generate photo: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

// メイン関数
function main(): void {
  try {
    // イベント時間を生成
    const eventTimes = generateEventTimes();

    // ログファイルを生成
    const logInfo = generateLogFile(eventTimes);
    console.log(`Generated log file: ${logInfo.logFilePath}`);

    // 写真ファイルを生成
    const photoPath = generatePhotoFile(eventTimes, logInfo.worldInfo);
    console.log(`Generated photo file: ${photoPath}`);

    console.log('Debug data generation completed successfully!');

    // 時間情報を表示
    console.log('\nイベントタイムライン:');
    console.log(
      `VRC起動時間: ${format(eventTimes.initTime, 'yyyy-MM-dd HH:mm:ss.SSS')}`,
    );
    console.log(
      `ワールド参加: ${format(
        eventTimes.worldJoinTime,
        'yyyy-MM-dd HH:mm:ss.SSS',
      )}`,
    );
    console.log(
      `写真撮影時間: ${format(
        eventTimes.photoTakenTime,
        'yyyy-MM-dd HH:mm:ss.SSS',
      )}`,
    );
    console.log(
      `プレイヤー参加: ${format(
        eventTimes.playerJoinTime,
        'yyyy-MM-dd HH:mm:ss.SSS',
      )}`,
    );
    console.log(
      `プレイヤー退出: ${format(
        eventTimes.playerLeaveTime,
        'yyyy-MM-dd HH:mm:ss.SSS',
      )}`,
    );
  } catch (error) {
    console.error(
      'Error generating debug data:',
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

// スクリプト実行
main();
