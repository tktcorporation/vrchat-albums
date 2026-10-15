import { Text } from 'ink';
import React from 'react';
import type { SourceError } from '../collect/types';
import type { Snapshot } from '../model/row';
import { truncate } from './format';

type Props = {
  snapshot: Snapshot | null;
  message: string | null;
  filter: string | null;
  ackError?: SourceError | null;
  width: number;
};

// 幅に応じて長い版から順に試す。80 桁の端末では全キーを並べると入らないため、
// 発見しにくいキー（Enter / a / /）だけに絞った短い版を用意して、help が丸ごと消えるのを避ける。
const KEY_HELPS = [
  '↑↓/jk 選択  PgUp/PgDn 頁  g/G 先頭/末尾  Enter 移動  a 確認済み  c その他  / 絞り込み  r 再収集  q 終了',
  '↑↓ 選択  PgUp/PgDn 頁  Enter 移動  a 確認済み  c その他  / 絞り込み  r 再収集  q 終了',
  '↑↓ 選択  Enter 移動  a 確認済み  / 絞り込み  q 終了',
];

export function StatusBar({ snapshot, message, filter, ackError, width }: Props) {
  // 源の失敗は複数同時に起こりうるが、1 行に全件並べると幅を超えて折り返す。
  // 代表 1 件だけを詳細つきで示し、件数で見落としを減らす。
  const errors = snapshot ? Object.entries(snapshot.sources).filter((e): e is [string, SourceError] => !!e[1]) : [];
  const [firstError] = errors;
  const errorPart =
    errors.length > 1
      ? `源エラー ${errors.length} 件: ${firstError?.[1].detail ?? ''}`
      : firstError
        ? `${firstError[0]}: ${firstError[1].detail}`
        : null;
  const parts = [
    filter !== null ? `絞り込み: ${filter}` : null,
    message,
    ackError ? `ack: ${ackError.detail}` : null,
    errorPart,
  ].filter((p): p is string => !!p);
  const body = ` ${parts.join('  ')}`;
  // キー help は「入る余地があるときだけ」の付加情報。本文（絞り込み・エラー等）を
  // 優先し、幅を超えるなら help から先に落として本文自体の折り返しを防ぐ。
  const line = KEY_HELPS.map((help) => `${body}  ${help}`).find((candidate) => textFits(candidate, width)) ?? body;
  return <Text dimColor>{truncate(line, width)}</Text>;
}

function textFits(text: string, width: number): boolean {
  // truncate は改行・連続空白を1個へ畳んでから幅比較するため、比較対象も
  // 同じ正規化を経由させないと textWidth の基準がずれる。
  return truncate(text, width) === text.replace(/\s+/g, ' ').trim();
}
