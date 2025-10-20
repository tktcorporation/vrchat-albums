import { z } from 'zod';
import { BaseValueObject } from '../../../electron/lib/baseValueObject.js';

class TestId extends BaseValueObject<'TestId', string> {}

export { TestId }; // Wrong: exporting as class instead of type
export const TestIdSchema = z.string().transform((val) => new TestId(val));
