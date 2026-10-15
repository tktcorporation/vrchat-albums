import { Box, Text } from 'ink';
import React from 'react';
import type { FleetRow } from '../model/row';
import { buildLine1, buildLine2, GAP_WIDTH, LOCATION_SEP_WIDTH } from './row-lines';
import { padDisplay, statusColor } from './format';

type RowLineProps = { row: FleetRow; selected: boolean; now: number; width: number };

// name にも状態色を載せる: 状態記号だけでは、要対応が多数行に埋もれたときに
// 目が拾いにくい。
const nameColor = (row: FleetRow): string | undefined =>
  row.status === 'blocked' ? 'yellow' : row.status === 'failed' ? 'red' : row.status === 'done' ? 'green' : undefined;

const summaryPrefixColor = (row: FleetRow): string | undefined =>
  row.status === 'blocked' ? 'yellow' : row.status === 'done' ? 'green' : undefined;

export function RowLine({ row, selected, now, width }: RowLineProps) {
  const line1 = buildLine1(row, width, now, selected);
  const line2 = buildLine2(row, width);

  // 選択行は2行とも幅いっぱいにパディングした上で inverse だけを掛ける。
  // inverse と個別の色指定が重なると、黄色文字が黄色寄りの背景に化けて読めなくなる
  // ため、選択中は色を一切乗せない（inverse のみで選択を示す）。
  if (selected) {
    return (
      <Box flexDirection="column">
        <Text inverse wrap="truncate-end">
          {padDisplay(line1.plain, width - 1)}
        </Text>
        <Text inverse wrap="truncate-end">
          {padDisplay(line2.plain, width - 1)}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {line1.cursor}
        <Text color={statusColor(row.status)}>{line1.glyph}</Text>
        {' '}
        <Text bold color={nameColor(row)}>
          {line1.name}
        </Text>
        {line1.location && <Text dimColor>{' '.repeat(LOCATION_SEP_WIDTH)}{line1.location}</Text>}
        {' '.repeat(GAP_WIDTH)}
        <Text dimColor>
          {line1.meta}
          {'  '}
          {line1.age}
        </Text>
      </Text>
      <Text wrap="truncate-end">
        {line2.indent}
        {line2.summaryPrefix && <Text color={summaryPrefixColor(row)}>{line2.summaryPrefix}</Text>}
        {line2.summary}
      </Text>
    </Box>
  );
}

export function GroupHeader({ title, count, hint }: { title: string; count: number; hint?: string }) {
  return (
    <Text bold wrap="truncate-end">
      {' '}{title} ({count}){hint ? `  ${hint}` : ''}
    </Text>
  );
}
