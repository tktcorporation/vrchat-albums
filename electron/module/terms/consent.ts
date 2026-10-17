import { TERMS_VERSION } from '../../../src/v2/constants/terms/version';
import type { SettingStore } from '../settingStore';

/**
 * 現在の版の利用規約に同意済みか。同意済みでも版が古ければ、画面側は同意し直しを求めるので、
 * 利用者のログや写真を取り込む処理（tRPC の consentedProcedure と、バックグラウンドの定期同期）と
 * エラー監視の送信は、呼び出し側がこの判定で止める。
 */
export const hasAcceptedCurrentTerms = (
  store: Pick<SettingStore, 'getTermsAccepted' | 'getTermsVersion'>,
): boolean =>
  store.getTermsAccepted() && store.getTermsVersion() === TERMS_VERSION;
