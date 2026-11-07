import { describe, expect, it } from 'vitest';

import { createRestartPolicy } from './restartPolicy';

const options = {
  maxRestarts: 3,
  windowMs: 60_000,
  baseDelayMs: 500,
  maxDelayMs: 1_500,
};

describe('createRestartPolicy', () => {
  it('終了のたびに待ち時間を倍にし、上限で止める', () => {
    const decide = createRestartPolicy(options);
    expect(decide(0)).toEqual({ action: 'restart', delayMs: 500 });
    expect(decide(1_000)).toEqual({ action: 'restart', delayMs: 1_000 });
    expect(decide(2_000)).toEqual({ action: 'restart', delayMs: 1_500 });
  });

  it('時間の窓の中で回数を超えたら諦める', () => {
    const decide = createRestartPolicy(options);
    decide(0);
    decide(1_000);
    decide(2_000);
    expect(decide(3_000)).toEqual({ action: 'giveUp', crashesInWindow: 4 });
  });

  it('窓より前の終了は数えず、待ち時間も最初から数え直す', () => {
    const decide = createRestartPolicy(options);
    decide(0);
    decide(1_000);
    decide(2_000);
    expect(decide(70_000)).toEqual({ action: 'restart', delayMs: 500 });
  });
});
