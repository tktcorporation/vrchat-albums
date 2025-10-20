import { z } from 'zod';
import { PathObject, PathObjectSchema } from './pathObject.js';

const opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

export class InvalidPathObject extends PathObject {
  // @ts-ignore
  private readonly [opaqueSymbol]: 'InvalidPathObject';
}

export const InvalidPathObjectSchema = z
  .string()
  .transform((val) => new InvalidPathObject(val));
