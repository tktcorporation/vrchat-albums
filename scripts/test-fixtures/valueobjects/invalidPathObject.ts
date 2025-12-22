import { z } from 'zod';
import { BasePathObject } from './basePathObject.js';

const _opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

export class InvalidPathObject extends BasePathObject {}

export const InvalidPathObjectSchema = z
  .string()
  .transform((val) => new InvalidPathObject(val));
