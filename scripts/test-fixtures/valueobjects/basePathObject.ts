import { z } from 'zod';
import { BaseValueObject } from '../../../electron/lib/baseValueObject.js';

// This is a base class for testing inheritance - NOT a ValueObject pattern
export class BasePathObject extends BaseValueObject<'BasePathObject', string> {}

export const BasePathObjectSchema = z
  .string()
  .transform((val) => new BasePathObject(val));
