/**
 * UTC の ISO 8601 時刻（`YYYY-MM-DDTHH:MM:SS[.fff]Z`）と UNIX エポックのミリ秒を相互に変換する。
 *
 * hook は Bun の版を固定しないリポジトリにも同期されるため、Bun 1.4 以降にしか無い Temporal を
 * 使わない。Date も使わない（同期先の lint が禁じている場合がある）。日付は暦の計算で変換する。
 */

/** どの版の Bun でも UNIX エポックからのミリ秒を返す。 */
export function nowMs(): number {
  return performance.timeOrigin + performance.now();
}

// 先発グレゴリオ暦の年月日と、1970-01-01 からの日数の相互変換（H. Hinnant の days_from_civil）。
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex + (monthIndex < 10 ? 3 : -9);
  return [yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

const MS_PER_DAY = 86_400_000;

/** 末尾 Z・小数秒 0〜3 桁の UTC 時刻だけを受け付ける。存在しない日時や他の形式は null。 */
export function parseIsoUtcMs(value: string): number | null {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millisecond = Number((match[7] ?? '').padEnd(3, '0'));
  if (hour > 23 || minute > 59 || second > 59) return null;
  const days = daysFromCivil(year, month, day);
  const [y, m, d] = civilFromDays(days);
  if (y !== year || m !== month || d !== day) return null;
  return days * MS_PER_DAY + ((hour * 60 + minute) * 60 + second) * 1000 + millisecond;
}

/** `YYYY-MM-DDTHH:MM:SS.fffZ`（fractionDigits が 0 なら小数秒なし）を返す。 */
export function formatIsoUtc(ms: number, fractionDigits: 0 | 3 = 3): string {
  const whole = Math.floor(ms);
  const days = Math.floor(whole / MS_PER_DAY);
  const rest = whole - days * MS_PER_DAY;
  const [year, month, day] = civilFromDays(days);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const time = `${pad(Math.floor(rest / 3_600_000))}:${pad(Math.floor(rest / 60_000) % 60)}:${pad(Math.floor(rest / 1000) % 60)}`;
  const fraction = fractionDigits === 3 ? `.${pad(rest % 1000, 3)}` : '';
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${time}${fraction}Z`;
}
