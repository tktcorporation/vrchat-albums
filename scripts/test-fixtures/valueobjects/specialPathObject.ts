import { z } from 'zod';
import { PathObject, PathObjectSchema } from './pathObject.js';

const opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

class SpecialPathObject extends PathObject {
  // @ts-ignore
  private readonly [opaqueSymbol]: 'SpecialPathObject';
}

export type { SpecialPathObject };
export const SpecialPathObjectSchema = z
  .string()
  .transform((val) => new SpecialPathObject(val));
