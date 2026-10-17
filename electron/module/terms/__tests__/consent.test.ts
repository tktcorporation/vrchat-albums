import { describe, expect, it } from 'vitest';

import { TERMS_VERSION } from '../../../../src/v2/constants/terms/version';
import { hasAcceptedCurrentTerms } from '../consent';

const storeOf = (accepted: boolean, version: string) => ({
  getTermsAccepted: () => accepted,
  getTermsVersion: () => version,
});

describe('hasAcceptedCurrentTerms', () => {
  it('現在の版に同意済みなら true', () => {
    expect(hasAcceptedCurrentTerms(storeOf(true, TERMS_VERSION))).toBe(true);
  });

  it('未同意なら false', () => {
    expect(hasAcceptedCurrentTerms(storeOf(false, TERMS_VERSION))).toBe(false);
  });

  it('古い版にだけ同意していれば false', () => {
    expect(hasAcceptedCurrentTerms(storeOf(true, '0.0'))).toBe(false);
  });
});
