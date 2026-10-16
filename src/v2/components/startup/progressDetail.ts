/**
 * 起動画面に出す件数と撮影月を、表示言語に合わせて文字列にする純粋関数群。
 *
 * 翻訳関数 `t()` は差し込みを持たないため、翻訳ファイルには `{current}` のような
 * 差し込み位置を含むテンプレートを置き、ここで値を埋める。
 */
import { match, P } from 'ts-pattern';

import type {
  InitProgressDetails,
  InitStats,
} from '../../hooks/useInitProgress';
import type { Language, Translations } from '../../i18n/types';

type DetailTemplates = Translations['initProgress']['timeline']['detail'];

const LOCALE_OF = {
  ja: 'ja-JP',
  en: 'en-US',
} as const satisfies Record<Language, string>;

/** 件数を表示言語の桁区切りで書く */
export const formatCount = (value: number, language: Language): string =>
  new Intl.NumberFormat(LOCALE_OF[language]).format(value);

/**
 * `YYYY-MM` を表示言語の年月表記にする（ja: 2024年8月、en: Aug 2024）。
 * 月の初日をローカルタイムで作るので、時差で前後の月にずれない。
 */
export const formatYearMonthLabel = (
  month: string,
  language: Language,
): string => {
  const date = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)) - 1,
    1,
  );
  return new Intl.DateTimeFormat(LOCALE_OF[language], {
    year: 'numeric',
    month: language === 'ja' ? 'long' : 'short',
  }).format(date);
};

/**
 * `YYYY-MM` の月だけを表示言語で書く（ja: 8月、en: Aug）。年は図の中央に別に出すので含めない。
 */
export const formatMonthName = (month: string, language: Language): string =>
  new Intl.DateTimeFormat(LOCALE_OF[language], {
    month: language === 'ja' ? 'long' : 'short',
  }).format(new Date(2000, Number(month.slice(5, 7)) - 1, 1));

/** 撮影月として扱える `currentItem`。それ以外の値は月を添えずに件数だけ出す */
const YEAR_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u;

const fillTemplate = (
  template: string,
  values: Readonly<Record<string, string>>,
): string =>
  template.replaceAll(/\{(?<name>\w+)\}/gu, (placeholder, name: string) =>
    name in values ? values[name] : placeholder,
  );

/**
 * ステージ内の実件数を 1 行の説明にする。件数が無いステージでは空文字を返す。
 * 写真インデックス中は処理中の撮影月も添える（「2024年8月　3,412 / 8,900枚」）。
 */
export const formatProgressDetail = (
  details: InitProgressDetails | null,
  language: Language,
  templates: DetailTemplates,
): string => {
  if (details === null) {
    return '';
  }
  const values = {
    current: formatCount(details.current, language),
    total: formatCount(details.total, language),
  };
  return match(details)
    .with(
      { unit: 'photos', currentItem: P.string.regex(YEAR_MONTH_PATTERN) },
      ({ currentItem }) =>
        fillTemplate(templates.photosInMonth, {
          ...values,
          month: formatYearMonthLabel(currentItem, language),
        }),
    )
    .with({ unit: 'photos' }, () => fillTemplate(templates.photos, values))
    .with({ unit: 'files' }, () => fillTemplate(templates.files, values))
    .with({ unit: 'logs' }, () => fillTemplate(templates.logs, values))
    .exhaustive();
};

/**
 * 累計を 1 行に並べる（「写真 8,900枚　ワールド 312　プレイヤー 1,204人」）。
 * 統計が届く前と、写真がまだ 1 枚も数えられていない間は空文字を返す。
 * 0 を並べた文は「何も無い」と読めてしまい、読み込み中であることと食い違うため。
 */
export const formatStatsSummary = (
  stats: Pick<InitStats, 'photos' | 'worlds' | 'people'> | null,
  language: Language,
  template: string,
): string => {
  if (stats === null || stats.photos === 0) {
    return '';
  }
  return fillTemplate(template, {
    photos: formatCount(stats.photos, language),
    worlds: formatCount(stats.worlds, language),
    people: formatCount(stats.people, language),
  });
};
