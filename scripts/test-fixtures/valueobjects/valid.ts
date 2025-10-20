import { z } from 'zod';
import { BaseValueObject } from '../../../electron/lib/baseValueObject.js';

class TestId extends BaseValueObject<'TestId', string> {}

export type { TestId };
export const TestIdSchema = z.string().transform((val) => new TestId(val));
