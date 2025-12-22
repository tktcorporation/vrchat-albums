import { z } from 'zod';
import { BasePathObject } from './basePathObject.js';

const _opaqueSymbol: unique symbol = Symbol('opaqueSymbol');

class SpecialPathObject extends BasePathObject {}

export type { SpecialPathObject };
export const SpecialPathObjectSchema = z
  .string()
  .transform((val) => new SpecialPathObject(val));
