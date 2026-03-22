import { describe, expect, it } from 'vitest';

import { VRChatLogLineSchema } from '../model';
import {
  extractWorldLeaveInfoFromLog,
  inferWorldLeaveEvents,
} from './worldLeaveParser';

const createLogLine = (value: string) => VRChatLogLineSchema.parse(value);

describe('extractWorldLeaveInfoFromLog', () => {
  it('アプリケーション終了ログを正しく検出する', () => {
    const logEntry = createLogLine(
      '2024.01.01 10:30:00 Debug - VRCApplication: HandleApplicationQuit',
    );

    const result = extractWorldLeaveInfoFromLog(logEntry);

    expect(result).not.toBeNull();
    expect(result?.logType).toBe('worldLeave');
    expect(result?.reason).toBe('applicationQuit');
    expect(result?.leaveDate).toEqual(new Date('2024-01-01T10:30:00'));
  });

  it('接続切断ログを正しく検出する', () => {
    const logEntry = createLogLine(
      '2024.01.01 10:25:00 Error - Lost connection to server',
    );

    const result = extractWorldLeaveInfoFromLog(logEntry);

    expect(result).not.toBeNull();
    expect(result?.logType).toBe('worldLeave');
    expect(result?.reason).toBe('disconnect');
    expect(result?.leaveDate).toEqual(new Date('2024-01-01T10:25:00'));
  });

  // TODO: 実際のVRChatログパターンが見つかったらテストを追加
  // it('手動退出ログを正しく検出する', () => {
  //   const logEntry = createLogLine(
  //     '2024.01.01 10:20:00 Debug - Left Room manually',
  //   );
  //
  //   const result = extractWorldLeaveInfoFromLog(logEntry);
  //
  //   expect(result).not.toBeNull();
  //   expect(result?.logType).toBe('worldLeave');
  //   expect(result?.reason).toBe('userAction');
  //   expect(result?.leaveDate).toEqual(new Date('2024-01-01T10:20:00'));
  // });

  it('無関係なログは無視される', () => {
    const logEntry = createLogLine(
      '2024.01.01 10:15:00 Debug - Some unrelated log message',
    );

    const result = extractWorldLeaveInfoFromLog(logEntry);

    expect(result).toBeNull();
  });

  it('日時フォーマットが不正な場合はnullを返す', () => {
    const logEntry = createLogLine(
      'Invalid date format - VRCApplication: HandleApplicationQuit',
    );

    const result = extractWorldLeaveInfoFromLog(logEntry);

    expect(result).toBeNull();
  });
});

describe('inferWorldLeaveEvents', () => {
  it('複数のワールド参加がある場合、各セッション終了を推測する', () => {
    const logLines = [
      createLogLine('2024.01.01 10:00:00 Debug - [Behaviour] Joining wrld_001'),
      createLogLine('2024.01.01 10:05:00 Debug - Some activity'),
      createLogLine('2024.01.01 10:10:00 Debug - More activity'),
      createLogLine('2024.01.01 10:15:00 Debug - [Behaviour] Joining wrld_002'),
      createLogLine('2024.01.01 10:20:00 Debug - Some activity'),
      createLogLine('2024.01.01 10:25:00 Debug - Final activity'),
    ];

    const worldJoinIndices = [0, 3]; // index 0と3でワールド参加

    const result = inferWorldLeaveEvents(logLines, worldJoinIndices);

    expect(result).toHaveLength(2);

    // 最初のセッション終了
    expect(result[0].leaveDate).toEqual(new Date('2024-01-01T10:10:00'));
    expect(result[0].reason).toBe('userAction');

    // 最後のセッション終了
    expect(result[1].leaveDate).toEqual(new Date('2024-01-01T10:25:00'));
    expect(result[1].reason).toBe('applicationQuit');
  });

  it('ワールド参加が1回のみの場合、ログ終了時に終了と判定', () => {
    const logLines = [
      createLogLine('2024.01.01 10:00:00 Debug - [Behaviour] Joining wrld_001'),
      createLogLine('2024.01.01 10:05:00 Debug - Some activity'),
      createLogLine('2024.01.01 10:10:00 Debug - Final activity'),
    ];

    const worldJoinIndices = [0];

    const result = inferWorldLeaveEvents(logLines, worldJoinIndices);

    expect(result).toHaveLength(1);
    expect(result[0].leaveDate).toEqual(new Date('2024-01-01T10:10:00'));
    expect(result[0].reason).toBe('applicationQuit');
  });

  it('ワールド参加がない場合は空の配列を返す', () => {
    const logLines = [
      createLogLine('2024.01.01 10:00:00 Debug - Some activity'),
      createLogLine('2024.01.01 10:05:00 Debug - More activity'),
    ];

    const worldJoinIndices: number[] = [];

    const result = inferWorldLeaveEvents(logLines, worldJoinIndices);

    expect(result).toEqual([]);
  });

  it('日時が抽出できないログ行は無視される', () => {
    const logLines = [
      createLogLine('2024.01.01 10:00:00 Debug - [Behaviour] Joining wrld_001'),
      createLogLine('Invalid log format without date'),
      createLogLine('2024.01.01 10:10:00 Debug - Valid log'),
    ];

    const worldJoinIndices = [0];

    const result = inferWorldLeaveEvents(logLines, worldJoinIndices);

    // 有効な日時を持つログが見つかるまで処理される
    expect(result).toHaveLength(1);
    expect(result[0].leaveDate).toEqual(new Date('2024-01-01T10:10:00'));
  });
});
