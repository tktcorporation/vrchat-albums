import { describe, expect, it } from 'vitest';

import { calculateVisiblePlayerCount } from './textMeasurement';

describe('calculateVisiblePlayerCount', () => {
  /** 固定幅で計測する簡易 mock（1文字 = 8px） */
  const fixedWidthMeasure = (text: string) => text.length * 8;

  it('全プレイヤーがコンテナに収まる場合、全員を返す', () => {
    const names = ['Alice', 'Bob', 'Charlie', 'Dave'];
    // Alice=40+sep=24, Bob=24+sep=24, Charlie=56+sep=24, Dave=32 = 224
    // 十分広いコンテナ → 全員 fit, minVisible(3) < 4 → 4
    const result = calculateVisiblePlayerCount(names, 500, fixedWidthMeasure);
    expect(result).toBe(4);
  });

  it('途中で収まらなくなった場合、収まる分だけ返す', () => {
    const names = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank', 'Grace'];
    // minVisible=0 で純粋なフィッティングロジックをテスト
    // Alice=40+sep=24 = 64
    // Bob=24+sep=24+moreText=48 → 64+24+24+48=160 < 200 → fits (totalWidth=112)
    // Charlie=56+sep=24+moreText=48 → 112+56+24+48=240 > 200 → doesn't fit
    const result = calculateVisiblePlayerCount(names, 200, fixedWidthMeasure, {
      minVisible: 0,
    });
    expect(result).toBe(2);
  });

  it('最低表示数（デフォルト3）を保証する', () => {
    // コンテナが狭くても最低3人は返す
    const names = ['A', 'B', 'C', 'D'];
    const result = calculateVisiblePlayerCount(names, 10, fixedWidthMeasure);
    expect(result).toBe(3);
  });

  it('minVisible オプションでカスタマイズできる', () => {
    const names = ['A', 'B', 'C', 'D'];
    const result = calculateVisiblePlayerCount(names, 10, fixedWidthMeasure, {
      minVisible: 1,
    });
    expect(result).toBe(1);
  });

  it('空配列では minVisible を返す', () => {
    const result = calculateVisiblePlayerCount([], 200, fixedWidthMeasure);
    expect(result).toBe(3);
  });

  it('プレイヤー1人の場合は1人と minVisible の大きい方を返す', () => {
    const names = ['Alice'];
    // Alice=40px < 200px → fits
    const result = calculateVisiblePlayerCount(names, 200, fixedWidthMeasure);
    // 1人がfitするが、minVisible=3のため3
    expect(result).toBe(3);
  });

  it('プレイヤー1人の場合、minVisible=1 なら 1 を返す', () => {
    const names = ['Alice'];
    const result = calculateVisiblePlayerCount(names, 200, fixedWidthMeasure, {
      minVisible: 1,
    });
    expect(result).toBe(1);
  });

  it('最後のプレイヤーでは moreTextWidth を加算しない', () => {
    const names = ['AB', 'CD'];
    // AB=16 + sep=24 = 40. reserved(moreText)=48 → 40+48=88 < 90 → fits
    // CD=16 (最後なのでsepもmoreTextも不要) → 40+16=56 < 90 → fits
    // もしCDが最後でなければ 40+16+24+48=128 > 90 で収まらない
    const result = calculateVisiblePlayerCount(names, 90, fixedWidthMeasure, {
      minVisible: 0,
    });
    expect(result).toBe(2);
  });

  it('separatorWidth / moreTextWidth をカスタマイズできる', () => {
    const names = ['Alice', 'Bob', 'Charlie'];
    // Alice=40 + sep=10 = 50
    // Bob=24 + sep=10 + more=20 → 50+24+10+20=104 < 120 → fits (totalWidth=84)
    // Charlie=56 (最後) → 84+56=140 > 120 → doesn't fit
    const result = calculateVisiblePlayerCount(names, 120, fixedWidthMeasure, {
      separatorWidth: 10,
      moreTextWidth: 20,
      minVisible: 0,
    });
    expect(result).toBe(2);
  });

  it('日本語プレイヤー名を正しく処理する', () => {
    const names = ['田中太郎', 'さくら'];
    // 田中太郎=4文字*8=32px + sep=24 = 56
    // さくら=3文字*8=24px (最後) → 56+24=80 < 200
    const result = calculateVisiblePlayerCount(names, 200, fixedWidthMeasure, {
      minVisible: 0,
    });
    expect(result).toBe(2);
  });
});
