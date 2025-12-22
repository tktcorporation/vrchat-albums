/**
 * 値オブジェクトの基底クラス。
 *
 * このクラスを継承することで、型安全な値オブジェクトを実装できます。
 * - Tにはブランド型として使用する文字列リテラル型を指定します
 * - Kには実際に保持する値の型を指定します
 *
 * @example
 * ```typescript
 * class UserId extends BaseValueObject<'UserId', string> {}
 * ```
 *
 * @see docs/refactoring-plan-code-duplication.md - 値オブジェクト活用の背景
 * @see electron/lib/pathObject.ts - パス操作用ValueObjectの例
 */
export abstract class BaseValueObject<T extends string, K> {
  readonly value: K;

  constructor(value: K) {
    this.value = value;
  }

  /**
   * 値オブジェクト同士の等価性を比較する
   *
   * @param other 比較対象の値オブジェクト
   * @returns 等価の場合true、そうでない場合false
   */
  equals(other: BaseValueObject<T, K>): boolean {
    return this === other || this.value === other.value;
  }
}
