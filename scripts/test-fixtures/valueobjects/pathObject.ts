import { z } from 'zod';
import { BaseValueObject } from '../../../electron/lib/baseValueObject.js';

class PathObject extends BaseValueObject<'PathObject', string> {}

export type { PathObject };
export const PathObjectSchema = z
  .string()
  .transform((val) => new PathObject(val));
