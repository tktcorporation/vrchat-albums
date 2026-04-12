import { describe, expect, it } from 'vitest';

import {
  calculateVisiblePlayerCount,
  calculateVisiblePlayersForRows,
} from './textMeasurement';

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

describe('calculateVisiblePlayersForRows', () => {
  /** バッジ幅 = テキスト幅 + padding(24px) */
  const fixedWidthMeasure = (text: string) => text.length * 8;

  it('全プレイヤーが1行に収まる場合、全員を返す', () => {
    const names = ['A', 'B', 'C'];
    // Badge widths: A=(8+24)=32, B=32, C=32
    // With gap: 32+8+32+8+32 = 112 < 300
    const result = calculateVisiblePlayersForRows(
      names,
      300,
      fixedWidthMeasure,
    );
    expect(result).toEqual({ visibleCount: 3, hiddenCount: 0 });
  });

  it('2行に折り返す場合、2行分のプレイヤーを返す', () => {
    const names = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve'];
    // Badge widths: Alice=(40+24)=64, Bob=(24+24)=48, Charlie=(56+24)=80, Dave=(32+24)=56, Eve=(24+24)=48
    // Row 1 width 200: 64+8+48+8+80 = 208 > 200 → Charlie overflows
    //   → 64+8+48 = 120 fits, then 120+8+80 = 208 > 200 → row1 = [Alice, Bob]
    // Row 2: Charlie=80+8+56 = 144, +8+48 = 200 fits
    //   80+8+56 = 144 < 200, 144+8+48 = 200 ≤ 200 → row2 = [Charlie, Dave, Eve]
    // maxRows=2 → all visible in 2 rows
    const result = calculateVisiblePlayersForRows(
      names,
      200,
      fixedWidthMeasure,
    );
    expect(result).toEqual({ visibleCount: 5, hiddenCount: 0 });
  });

  it('maxRows を超えるプレイヤーは非表示にする', () => {
    // 各バッジ幅 = 32+24 = 56px, gap=8, container=120
    // 1行に収まるバッジ数: 56, 56+8+56=120 → 2個/行
    // maxRows=2 → 4個表示可能
    const names = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF'];
    const result = calculateVisiblePlayersForRows(
      names,
      120,
      fixedWidthMeasure,
      { maxRows: 2 },
    );
    expect(result).toEqual({ visibleCount: 4, hiddenCount: 2 });
  });

  it('空配列では 0 を返す', () => {
    const result = calculateVisiblePlayersForRows([], 200, fixedWidthMeasure);
    expect(result).toEqual({ visibleCount: 0, hiddenCount: 0 });
  });

  it('padding オプションを反映する', () => {
    const names = ['Alice'];
    // Badge: text=40 + padding=40 = 80
    const result = calculateVisiblePlayersForRows(
      names,
      200,
      fixedWidthMeasure,
      { padding: 40 },
    );
    expect(result).toEqual({ visibleCount: 1, hiddenCount: 0 });
  });

  it('gap オプションを反映する', () => {
    const names = ['AA', 'BB', 'CC'];
    // Badge widths: 16+24=40 each, gap=20
    // 40+20+40 = 100 < 120, 100+20+40 = 160 > 120
    // Row 1: [AA, BB] → width = 100
    // Row 2: [CC]
    const result = calculateVisiblePlayersForRows(
      names,
      120,
      fixedWidthMeasure,
      { gap: 20 },
    );
    expect(result).toEqual({ visibleCount: 3, hiddenCount: 0 });
  });
});
