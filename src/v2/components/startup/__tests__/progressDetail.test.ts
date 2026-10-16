import { describe, expect, it } from 'vitest';

import en from '../../../i18n/locales/en';
import ja from '../../../i18n/locales/ja';
import {
  formatMonthName,
  formatProgressDetail,
  formatStatsSummary,
  formatYearMonthLabel,
} from '../progressDetail';

const jaTemplates = ja.initProgress.timeline.detail;
const enTemplates = en.initProgress.timeline.detail;

describe('formatProgressDetail', () => {
  it('写真インデックス中は撮影月と枚数を出す', () => {
    const details = {
      current: 3412,
      total: 8900,
      unit: 'photos',
      currentItem: '2024-08',
    } as const;
    expect(formatProgressDetail(details, 'ja', jaTemplates)).toBe(
      '2024年8月の写真　3,412 / 8,900 枚',
    );
    expect(formatProgressDetail(details, 'en', enTemplates)).toBe(
      'Aug 2024: 3,412 of 8,900 photos',
    );
  });

  it('撮影月が無ければ枚数だけを出す', () => {
    const details = { current: 3412, total: 8900, unit: 'photos' } as const;
    expect(formatProgressDetail(details, 'ja', jaTemplates)).toBe(
      '3,412 / 8,900 枚',
    );
    expect(formatProgressDetail(details, 'en', enTemplates)).toBe(
      '3,412 of 8,900 photos',
    );
  });

  it('撮影月として読めない値なら月を添えない', () => {
    const details = {
      current: 1,
      total: 2,
      unit: 'photos',
      currentItem: 'unknown',
    } as const;
    expect(formatProgressDetail(details, 'ja', jaTemplates)).toBe('1 / 2 枚');
  });

  it('ログファイルはファイル数で出す', () => {
    const details = { current: 12, total: 128, unit: 'files' } as const;
    expect(formatProgressDetail(details, 'ja', jaTemplates)).toBe(
      '12 / 128 ファイル',
    );
    expect(formatProgressDetail(details, 'en', enTemplates)).toBe(
      '12 of 128 files',
    );
  });

  it('ログの件数は件で出す', () => {
    const details = { current: 1500, total: 20000, unit: 'logs' } as const;
    expect(formatProgressDetail(details, 'ja', jaTemplates)).toBe(
      '1,500 / 20,000 件',
    );
    expect(formatProgressDetail(details, 'en', enTemplates)).toBe(
      '1,500 of 20,000 records',
    );
  });

  it('件数が無ければ空文字', () => {
    expect(formatProgressDetail(null, 'ja', jaTemplates)).toBe('');
  });
});

describe('formatYearMonthLabel', () => {
  it('1 月と 12 月を前後の月にずらさない', () => {
    expect(formatYearMonthLabel('2025-01', 'ja')).toBe('2025年1月');
    expect(formatYearMonthLabel('2025-12', 'en')).toBe('Dec 2025');
  });
});

describe('formatMonthName', () => {
  it('月だけを表示言語で書く', () => {
    expect(formatMonthName('2024-08', 'ja')).toBe('8月');
    expect(formatMonthName('2024-08', 'en')).toBe('Aug');
    expect(formatMonthName('2024-12', 'en')).toBe('Dec');
  });
});

describe('formatStatsSummary', () => {
  const stats = { photos: 8900, worlds: 312, people: 1204 };

  it('累計を桁区切り付きの 1 文にする', () => {
    expect(
      formatStatsSummary(stats, 'ja', ja.initProgress.timeline.summary),
    ).toBe('312 のワールドで、1,204 人と撮った 8,900 枚');
    expect(
      formatStatsSummary(stats, 'en', en.initProgress.timeline.summary),
    ).toBe('8,900 photos taken with 1,204 people across 312 worlds');
  });

  it('統計が届く前と、写真がまだ 0 枚の間は何も出さない', () => {
    const template = ja.initProgress.timeline.summary;
    expect(formatStatsSummary(null, 'ja', template)).toBe('');
    expect(
      formatStatsSummary({ photos: 0, worlds: 3, people: 5 }, 'ja', template),
    ).toBe('');
  });
});
