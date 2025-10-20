import { z } from 'zod';
import { BasePathObject } from './basePathObject.js';

const opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

export class InvalidPathObject extends BasePathObject {
  // @ts-ignore
  private readonly [opaqueSymbol]: 'InvalidPathObject';
}

export const InvalidPathObjectSchema = z
  .string()
  .transform((val) => new InvalidPathObject(val));
