/**
 * フィクスチャ: cn(cond ? 'bg-black' : 'bg-white') の排他分岐テスト
 *
 * 期待動作:
 * - ライトモードで bg-black + text-black の分岐が AA 未満 → error 検出
 * - bg-white + text-black の分岐は ratio≈21 で AA クリア
 * - 旧実装: 両 bg を同時合成して誤った中間色 → bg-black + text-black を見落とす (偽陰性)
 * - 新実装: 2 通りの独立組合せで評価 → bg-black + text-black を検出 (正しい挙動)
 */

declare const cn: (...args: unknown[]) => string;

export function Foo({ flag }: { flag: boolean }) {
  return (
    <div className={cn(flag ? 'bg-black' : 'bg-white')}>
      <p className="text-black">Hello</p>
    </div>
  );
}
