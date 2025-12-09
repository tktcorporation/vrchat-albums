import { z } from 'zod';
import { BasePathObject } from './basePathObject.js';

const opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

class SpecialPathObject extends BasePathObject {
  // @ts-ignore
  private readonly [opaqueSymbol]: 'SpecialPathObject';
}

export type { SpecialPathObject };
export const SpecialPathObjectSchema = z
  .string()
  .transform((val) => new SpecialPathObject(val));
