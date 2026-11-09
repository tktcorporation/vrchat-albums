import { customType } from 'drizzle-orm/sqlite-core';

/**
 * 日時を UTC の `YYYY-MM-DD HH:MM:SS.SSS +00:00` 形式の TEXT として保存する列の型。
 *
 * 既存の DB の日時の列はすべてこの形式で書かれている。新しく書く行も同じ形式にそろえるのは、
 * 次の 2 つが文字列としての比較と解釈に依存するため。
 *
 * - 日時の範囲の検索と並べ替えは、TEXT の大小比較で行われる。形式が混ざると新旧の行の順序が崩れる
 * - 月ごとの集計は `strftime('%Y-%m', 列, 'localtime')` で行う。SQLite の日時関数は末尾の
 *   `+00:00` をタイムゾーンとして解釈し、ローカルタイムへ戻してから月を切り出す
 *
 * 読み出すときは JavaScript の `Date` に戻す。比較の条件に渡した `Date` も同じ形式に変換される。
 */
export const utcDateTime = customType<{
  data: Date;
  driverData: string;
}>({
  dataType: () => 'text',
  toDriver: (value) => formatUtcDateTime(value),
  fromDriver: (value) => parseUtcDateTime(value),
});

/**
 * `Date` を保存形式の文字列にする。
 *
 * `toISOString()` は UTC の `YYYY-MM-DDTHH:MM:SS.SSSZ` を返すので、区切りの `T` を空白に、
 * 末尾の `Z` を ` +00:00` に置き換える。無効な日付は `toISOString()` が RangeError を投げ、
 * 壊れた値を書き込む前に止まる。
 */
export const formatUtcDateTime = (value: Date): string => {
  const iso = value.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)} +00:00`;
};

/**
 * 日時の列から読んだ文字列。保存形式のほか、区切りが `T` のもの・ミリ秒の無いもの・
 * タイムゾーンの無いもの（UTC として扱う）も受け付ける。
 */
const STORED_DATE_TIME_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[ T](?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d{1,3})\d*)?\s*(?<zone>Z|[+-]\d{2}:?\d{2})?$/u;

/**
 * 保存形式の文字列を `Date` に戻す。
 *
 * 形式を正規表現で確かめてから組み立てる。`new Date(文字列)` に任せると、実行環境によって
 * 解釈が変わる形式や、壊れた値が Invalid Date のまま下流へ流れることがあるため。
 * 形式に合わない値は DB の破損なので、投げて上位の監視へ届ける。
 */
export const parseUtcDateTime = (value: string): Date => {
  const groups = STORED_DATE_TIME_PATTERN.exec(value)?.groups;
  if (groups === undefined) {
    throw new Error(`Unexpected date-time value in database: ${value}`);
  }
  const { year, month, day, hour, minute, second, fraction, zone } = groups;
  const utcMillis = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    fraction === undefined ? 0 : Number(fraction.padEnd(3, '0')),
  );
  return new Date(utcMillis - zoneOffsetMillis(zone));
};

/** `+09:00` のようなタイムゾーンの表記を、UTC からのずれ（ミリ秒）にする */
const zoneOffsetMillis = (zone: string | undefined): number => {
  if (zone === undefined || zone === 'Z') {
    return 0;
  }
  const sign = zone.startsWith('-') ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  return sign * (hours * 60 + minutes) * 60 * 1000;
};
