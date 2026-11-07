import { describe, expect, it, vi } from 'vitest';

import type { MessageChannel } from '../../../shared/trpcTransport';
import { createTestHost } from '../host/testHost';
import { createHostRpcClient } from './client';
import type { HostRequest, HostResponse } from './protocol';
import { serveHostRpc } from './server';

/**
 * 処理本体と main の間の通信路を、プロセスの境界と同じく構造化複製を通す手元の 2 本でつなぐ。
 * 届くのは次のマクロタスクにして、実際の通信路と同じく送信の呼び出しの中では届かないようにする。
 */
const createInMemoryPair = () => {
  const toMain = new Set<(message: unknown) => void>();
  const toBackend = new Set<(message: unknown) => void>();
  const deliver = (
    listeners: Set<(message: unknown) => void>,
    message: unknown,
  ) => {
    const copy = structuredClone(message);
    setTimeout(() => {
      for (const listener of listeners) {
        listener(copy);
      }
    }, 0);
  };
  const backendSide: MessageChannel<HostRequest, unknown> = {
    send: (message) => deliver(toMain, message),
    onMessage: (listener) => {
      toBackend.add(listener);
      return () => toBackend.delete(listener);
    },
  };
  const mainSide: MessageChannel<HostResponse, unknown> = {
    send: (message) => deliver(toBackend, message),
    onMessage: (listener) => {
      toMain.add(listener);
      return () => toMain.delete(listener);
    },
  };
  return {
    backendSide,
    mainSide,
    /** main 宛てに任意の値を送る（形の壊れた要求を試すため） */
    sendRawToMain: (message: unknown) => deliver(toMain, message),
    onBackendReceive: (listener: (message: unknown) => void) =>
      toBackend.add(listener),
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('host RPC', () => {
  it('処理本体からの操作を main の実装で実行し、結果を返す', async () => {
    const pair = createInMemoryPair();
    const openPath = vi.fn(async (target: string) => `opened ${target}`);
    const showOpenDialog = vi.fn(async () => ({
      canceled: false as const,
      filePaths: ['/a', '/b'],
    }));
    const host = createTestHost({ shell: { openPath, showOpenDialog } });
    serveHostRpc(pair.mainSide, host);
    const client = createHostRpcClient(pair.backendSide);

    await expect(client.shell.openPath('/x')).resolves.toBe('opened /x');
    await expect(
      client.shell.showOpenDialog(['openDirectory']),
    ).resolves.toEqual({ canceled: false, filePaths: ['/a', '/b'] });
    await expect(client.updater.getStatus()).resolves.toEqual({
      updateDownloaded: false,
      availableVersion: null,
      canAutoInstall: false,
    });
    expect(openPath).toHaveBeenCalledWith('/x');
    expect(showOpenDialog).toHaveBeenCalledWith(['openDirectory']);
  });

  it('main の実装が失敗したら、処理本体の呼び出しがそのメッセージで reject する', async () => {
    const pair = createInMemoryPair();
    serveHostRpc(
      pair.mainSide,
      createTestHost({
        updater: {
          checkForUpdates: async () => {
            throw new Error('network down');
          },
        },
      }),
    );
    const client = createHostRpcClient(pair.backendSide);

    await expect(client.updater.checkForUpdates()).rejects.toThrow(
      'network down',
    );
  });

  it('外部で開いてよい URL だけを、正規化してから main の実装へ渡す', async () => {
    const pair = createInMemoryPair();
    const openExternal = vi.fn(async (_url: string) => {});
    serveHostRpc(pair.mainSide, createTestHost({ shell: { openExternal } }));
    const client = createHostRpcClient(pair.backendSide);

    await expect(
      client.shell.openExternal('HTTPS://example.com/a b'),
    ).resolves.toBeUndefined();
    expect(openExternal).toHaveBeenCalledWith('https://example.com/a%20b');
  });

  it('https 以外や形の壊れた URL は main の実装を呼ばずに reject する', async () => {
    const pair = createInMemoryPair();
    const openExternal = vi.fn(async (_url: string) => {});
    serveHostRpc(pair.mainSide, createTestHost({ shell: { openExternal } }));
    const client = createHostRpcClient(pair.backendSide);

    await expect(
      client.shell.openExternal('file:///C:/Windows/System32/calc.exe'),
    ).rejects.toThrow('DISALLOWED_SCHEME');
    await expect(client.shell.openExternal('not a url')).rejects.toThrow(
      'MALFORMED_URL',
    );
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('相対パスは main の実装を呼ばずに reject する', async () => {
    const pair = createInMemoryPair();
    const openPath = vi.fn(async (_target: string) => '');
    serveHostRpc(pair.mainSide, createTestHost({ shell: { openPath } }));
    const client = createHostRpcClient(pair.backendSide);

    await expect(client.shell.openPath('relative/dir')).rejects.toThrow(
      'relative path',
    );
    expect(openPath).not.toHaveBeenCalled();
  });

  it('知らない操作や引数の壊れた要求には実装を呼ばずに失敗を返す', async () => {
    const pair = createInMemoryPair();
    const writeClipboardText = vi.fn(async () => {});
    serveHostRpc(
      pair.mainSide,
      createTestHost({ shell: { writeClipboardText } }),
    );
    const responses: unknown[] = [];
    pair.onBackendReceive((message) => responses.push(message));

    pair.sendRawToMain({
      kind: 'hostRequest',
      id: 1,
      method: 'shell.deleteEverything',
      args: [],
    });
    pair.sendRawToMain({
      kind: 'hostRequest',
      id: 2,
      method: 'shell.writeClipboardText',
      args: [42],
    });
    await vi.waitFor(() => expect(responses).toHaveLength(2));

    expect(writeClipboardText).not.toHaveBeenCalled();
    expect(responses).toMatchObject([
      { kind: 'hostResponse', id: 1, ok: false },
      { kind: 'hostResponse', id: 2, ok: false },
    ]);
  });

  it('ID の読めない要求と、要求でないメッセージには応えない', async () => {
    const pair = createInMemoryPair();
    serveHostRpc(pair.mainSide, createTestHost());
    const responses: unknown[] = [];
    pair.onBackendReceive((message) => responses.push(message));

    pair.sendRawToMain({ kind: 'hostRequest', method: 'shell.reloadWindow' });
    pair.sendRawToMain({ kind: 'ready' });
    pair.sendRawToMain('garbage');
    await flush();

    expect(responses).toEqual([]);
  });

  it('処理本体のクライアントは、応答でないメッセージを無視する', async () => {
    const pair = createInMemoryPair();
    serveHostRpc(pair.mainSide, createTestHost());
    const client = createHostRpcClient(pair.backendSide);
    pair.mainSide.send({
      kind: 'hostResponse',
      id: 999,
      ok: true,
      value: 'unexpected',
    });

    await expect(client.shell.getOpenAtLogin()).resolves.toBe(false);
  });

  it('閉じると応答待ちの要求を reject し、以後の呼び出しも reject する', async () => {
    const pair = createInMemoryPair();
    // main は応答しない
    const client = createHostRpcClient(pair.backendSide);

    const pending = client.shell.reloadWindow();
    client.dispose();

    await expect(pending).rejects.toThrow('Host RPC connection closed');
    await expect(client.shell.reloadWindow()).rejects.toThrow(
      'Host RPC client is disposed',
    );
  });
});
