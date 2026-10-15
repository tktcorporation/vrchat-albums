import { Box, Text } from 'ink';
import React from 'react';
import type { FleetRow } from '../model/row';
import { truncateForce, wrapLines } from './format';

const LABEL_WIDTH = 12;
// detailHeight は App 側の高さ予算計算が使う固定の見積り（端末高さだけで決まり、
// 選択で伸縮しない）ため、内容がどれだけ長くても超えないよう総行数の上限を持つ。
// この上限自体は項目間で共有せず、項目ごとに固定の上限を割り当てる。共有予算だと
// 前の項目（元の指示など）が長いだけで後続の項目（場所・移動など）が
// まるごと描画されなくなるため、フィールドごとの上限の合計に「状態」1行を足した
// ものを DETAIL_MAX_LINES とする。
export const DETAIL_MAX_LINES = 13;
const FIELD_MAX_LINES = {
  元の指示: 3,
  最新の指示: 1,
  いま: 2,
  要判断: 2,
  モデル: 1,
  場所: 1,
  成果物: 1,
  移動: 1,
} as const;

// 元の指示・状態・要判断は、詳細ペインの中でも「何を頼まれ、今どこで止まっているか」を
// 示す核なので、maxLines を超えたときに末尾のフィールドから間引く対象から外す。
const PROTECTED_LABELS = new Set(['状態', '元の指示', '要判断']);

export function Detail({ row, width, maxLines = DETAIL_MAX_LINES }: { row: FleetRow | null; width: number; maxLines?: number }) {
  if (!row) return <Text dimColor> 行を選ぶと詳細が出る</Text>;
  const location = `${row.location.display}${row.location.branch ? `  branch ${row.location.branch}` : ''}${row.location.paneId ? `  pane ${row.location.paneId}` : ''}`;
  // 成果物は改行区切りだと wrapLines の空白正規化で潰れるため、区切りは読点にする。
  const artifacts = row.artifacts.map((a) => `${a.kind.toUpperCase()} #${a.id} ${a.href}`).join(', ') || null;
  const attachHint = row.attach.type === 'hint' ? row.attach.text : null;
  const statusLine = row.statusNote ? `${row.status}（${row.statusNote}）` : null;

  const fields: { label: keyof typeof FIELD_MAX_LINES; value: string | null }[] = [
    { label: '元の指示', value: row.originalPrompt },
    { label: '最新の指示', value: row.latestPrompt },
    { label: 'いま', value: row.activity },
    { label: 'モデル', value: row.model },
    { label: '要判断', value: row.pending ? `[${row.pending.kind}] ${row.pending.text ?? ''}` : null },
    { label: '場所', value: location },
    { label: '成果物', value: artifacts },
    { label: '移動', value: attachHint },
  ];

  const valueWidth = Math.max(10, width - LABEL_WIDTH - 2);
  const rendered: { label: string; lines: string[] }[] = [];
  if (statusLine) rendered.push({ label: '状態', lines: [statusLine] });
  for (const field of fields) {
    if (!field.value) continue;
    const lines = wrapLines(field.value, valueWidth, FIELD_MAX_LINES[field.label]);
    if (lines.length === 0) continue;
    rendered.push({ label: field.label, lines });
  }

  // detailHeight は端末高さだけで決まり、選択で伸縮しない（listHeight 側の見積りと
  // 独立させるため）。そのため内容側の総行数が上限を超えたら、末尾のフィールドから
  // 間引いて maxLines に収める。
  let total = rendered.reduce((n, r) => n + r.lines.length, 0);
  for (let i = rendered.length - 1; i >= 0 && total > maxLines; i--) {
    const item = rendered[i];
    if (!item || PROTECTED_LABELS.has(item.label)) continue;
    total -= item.lines.length;
    rendered.splice(i, 1);
  }

  // 保護フィールド（状態・元の指示・要判断）だけでも合計が maxLines を超える端末幅では、
  // フィールドを丸ごと落とすと核となる情報が消えてしまう。代わりに行単位で末尾から
  // 間引き、各フィールドは最低1行だけは残す。間引かれたフィールドの最後の1行は、
  // 内容が途中で切れたことが分かるよう truncateForce で … を付ける。
  const originalLineCounts = new Map(rendered.map((r) => [r, r.lines.length] as const));
  for (let i = rendered.length - 1; i >= 0 && total > maxLines; i--) {
    const item = rendered[i];
    if (!item) continue;
    while (item.lines.length > 1 && total > maxLines) {
      item.lines.pop();
      total -= 1;
    }
    const lastIndex = item.lines.length - 1;
    const lastLine = item.lines[lastIndex];
    if (lastLine !== undefined && item.lines.length < (originalLineCounts.get(item) ?? item.lines.length)) {
      item.lines[lastIndex] = truncateForce(lastLine, valueWidth);
    }
  }

  return (
    <Box flexDirection="column">
      {rendered.map(({ label, lines }) => (
        <Box key={label}>
          <Box width={LABEL_WIDTH}>
            <Text dimColor>{label}</Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {lines.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
