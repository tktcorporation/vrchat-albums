import { z } from 'zod';
import { BaseValueObject } from '../../../electron/lib/baseValueObject.js';

export class TestId extends BaseValueObject<'TestId', string> {}

export const TestIdSchema = z.string().transform((val) => new TestId(val));
