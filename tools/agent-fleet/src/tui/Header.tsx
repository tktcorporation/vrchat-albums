import { Text } from 'ink';
import React from 'react';
import type { Groups } from '../model/group';
import type { Snapshot } from '../model/row';
import { formatAge, textWidth, truncateForce } from './format';
import { MARGIN } from './row-lines';

type Props = { groups: Groups; snapshot: Snapshot | null; now: number; width: number };

const TITLE = ' agent-fleet  ';

// 件数は絞り込み後の groups を見るので、絞り込みでヒットしなくなったグループは
// 自然に 0 件で省かれる。
export function Header({ groups, snapshot, now, width }: Props) {
  const counts: [string, number][] = [
    ['要対応', groups.pending.length],
    ['作業中', groups.working.length],
    ['待機', groups.idle.length],
    ['その他', groups.other.length],
  ];
  const shown = counts.filter(([, n]) => n > 0);
  const right = snapshot ? `更新 ${formatAge(snapshot.collectedAt, now)} 前` : '収集中';
  const leftPlain =
    TITLE + shown.map(([label, n], i) => `${i > 0 ? ' · ' : ''}${label} ${n}`).join('');
  const leftWidth = textWidth(leftPlain);
  const rightWidth = textWidth(right);
  const avail = width - MARGIN;

  // 左側（件数）の方が状態把握に効くため、まず右側（更新時刻）から落とす。
  // それでも左側だけで入りきらない極端に狭い端末では、色分けを諦めて
  // 平文を truncateForce で切る（この幅では件数ごとの色分けより収まることを優先する）。
  if (leftWidth > avail) return <Text dimColor wrap="truncate-end">{truncateForce(leftPlain, avail)}</Text>;
  const showRight = leftWidth + 1 + rightWidth <= avail;
  const gap = showRight ? Math.max(1, avail - leftWidth - rightWidth) : 0;
  // 件数の数字だけ通常色にして目に留まりやすくする。Ink は親の dim を子の
  // dimColor={false} で打ち消せないため、dim にしたい断片ごとに指定する。
  return (
    <Text wrap="truncate-end">
      <Text dimColor>{TITLE}</Text>
      {shown.map(([label, n], i) => (
        <Text key={label}>
          <Text dimColor>
            {i > 0 ? ' · ' : ''}
            {label}{' '}
          </Text>
          {n}
        </Text>
      ))}
      {showRight && (
        <Text dimColor>
          {' '.repeat(gap)}
          {right}
        </Text>
      )}
    </Text>
  );
}
