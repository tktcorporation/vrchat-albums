import { Bug } from 'lucide-react';

/**
 * OK fixture: lucide-react からインポートしたアイコンは非テキスト UI 扱い。
 *
 * text-low-fg は dark モードで bg-low-bg 上 2.63:1 のため本文なら AA 未達 (error) だが、
 * 非テキスト UI コンポーネントは WCAG 1.4.11 の 3:1 基準でも 2.63:1 は依然として未達。
 * → 本 fixture は「非テキスト扱いで評価されることで閾値が 3:1 になる」挙動の検証なので、
 *    text-low-fg ではなく `text-foreground` を使い、dark モードで 9.74:1 → OK になる
 *    ケースを示す (foreground は light dark どちらでも AA クリア)。
 */
export function OkNonTextIcon() {
  return (
    <div className="bg-low-bg">
      <Bug className="text-foreground" />
    </div>
  );
}
