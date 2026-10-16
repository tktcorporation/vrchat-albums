import { describe, expect, it } from 'vitest';

import {
  type AppEntry,
  checkExternalUrl,
  decideNavigation,
} from './externalUrl';

describe('checkExternalUrl', () => {
  it('https の URL は正規化した href で許可する', () => {
    expect(
      checkExternalUrl('https://vrchat.com/home/world/wrld_abc/info'),
    ).toEqual({
      ok: true,
      url: 'https://vrchat.com/home/world/wrld_abc/info',
    });
  });

  it('大文字のスキームも https として許可する', () => {
    expect(checkExternalUrl('HTTPS://Example.com/path')).toEqual({
      ok: true,
      url: 'https://example.com/path',
    });
  });

  it.each([
    ['http://example.com/', 'http:'],
    ['javascript:alert(1)', 'javascript:'],
    ['file:///C:/Windows/System32/calc.exe', 'file:'],
    ['ms-settings:privacy', 'ms-settings:'],
    ['smb://attacker.example/share', 'smb:'],
    ['mailto:someone@example.com', 'mailto:'],
  ])('%s はスキーム %s のため拒否する', (input, protocol) => {
    expect(checkExternalUrl(input)).toEqual({
      ok: false,
      rejection: { type: 'DISALLOWED_SCHEME', input, protocol },
    });
  });

  it.each(['', 'not a url', 'vrchat.com/home', '//example.com'])(
    '%j は URL として解釈できないため拒否する',
    (input) => {
      expect(checkExternalUrl(input)).toEqual({
        ok: false,
        rejection: { type: 'MALFORMED_URL', input },
      });
    },
  );
});

describe('decideNavigation', () => {
  const devEntry: AppEntry = {
    kind: 'devServer',
    origin: 'http://localhost:3000',
  };
  const fileEntry: AppEntry = {
    kind: 'file',
    filePath:
      'C:\\Program Files\\VRChatAlbums\\resources\\src\\out\\index.html',
    windows: true,
  };
  const posixFileEntry: AppEntry = {
    kind: 'file',
    filePath: '/opt/VRChatAlbums/resources/src/out/index.html',
    windows: false,
  };

  it('開発時は dev server と同じ origin への遷移を許可する', () => {
    expect(
      decideNavigation('http://localhost:3000/some/path?x=1#y', devEntry),
    ).toEqual({ action: 'allow' });
  });

  it('開発時に別ポートの localhost へは遷移させない', () => {
    expect(decideNavigation('http://localhost:4000/', devEntry)).toEqual({
      action: 'block',
      reason: {
        type: 'NOT_APP_AND_NOT_EXTERNAL',
        input: 'http://localhost:4000/',
        protocol: 'http:',
      },
    });
  });

  it('本番時は読み込んだ index.html への遷移だけを許可する', () => {
    expect(
      decideNavigation(
        'file:///C:/Program%20Files/VRChatAlbums/resources/src/out/index.html#/photos',
        fileEntry,
      ),
    ).toEqual({ action: 'allow' });
  });

  it('Windows ではドライブレターや大文字小文字が違っても同じファイルとして許可する', () => {
    expect(
      decideNavigation(
        'file:///c:/program%20files/vrchatalbums/resources/src/out/INDEX.html',
        fileEntry,
      ),
    ).toEqual({ action: 'allow' });
  });

  it('パーセントエンコードの仕方が違っても同じファイルとして許可する', () => {
    const entry: AppEntry = {
      kind: 'file',
      filePath: 'C:\\Users\\a%b\\app\\index.html',
      windows: true,
    };
    expect(
      decideNavigation('file:///C:/Users/a%25b/app/index.html', entry),
    ).toEqual({ action: 'allow' });
  });

  it('POSIX では大文字小文字を区別して比較する', () => {
    expect(
      decideNavigation(
        'file:///opt/VRChatAlbums/resources/src/out/index.html',
        posixFileEntry,
      ),
    ).toEqual({ action: 'allow' });
    expect(
      decideNavigation(
        'file:///opt/vrchatalbums/resources/src/out/index.html',
        posixFileEntry,
      ),
    ).toMatchObject({ action: 'block' });
  });

  it('ファイルパスとして表せない file URL は遷移させない', () => {
    const input = 'file://attacker.example/share/index.html';
    expect(decideNavigation(input, posixFileEntry)).toEqual({
      action: 'block',
      reason: { type: 'NOT_APP_AND_NOT_EXTERNAL', input, protocol: 'file:' },
    });
  });

  it('本番時に同じディレクトリでも別の file へは遷移させない', () => {
    const input =
      'file:///C:/Program%20Files/VRChatAlbums/resources/src/out/other.html';
    expect(decideNavigation(input, fileEntry)).toEqual({
      action: 'block',
      reason: { type: 'NOT_APP_AND_NOT_EXTERNAL', input, protocol: 'file:' },
    });
  });

  it('https の外部 URL はウィンドウを遷移させず外部で開く', () => {
    expect(
      decideNavigation(
        'https://github.com/tktcorporation/vrchat-albums/issues/new',
        fileEntry,
      ),
    ).toEqual({
      action: 'openExternal',
      url: 'https://github.com/tktcorporation/vrchat-albums/issues/new',
    });
  });

  it('アプリ外の http や独自スキームは遷移も外部起動もしない', () => {
    expect(decideNavigation('ms-settings:privacy', devEntry)).toEqual({
      action: 'block',
      reason: {
        type: 'NOT_APP_AND_NOT_EXTERNAL',
        input: 'ms-settings:privacy',
        protocol: 'ms-settings:',
      },
    });
    expect(decideNavigation('http://example.com/', fileEntry)).toMatchObject({
      action: 'block',
    });
  });

  it('URL として解釈できない文字列は拒否する', () => {
    expect(decideNavigation('not a url', devEntry)).toEqual({
      action: 'block',
      reason: { type: 'MALFORMED_URL', input: 'not a url' },
    });
  });
});
