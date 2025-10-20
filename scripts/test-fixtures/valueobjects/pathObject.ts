import { z } from 'zod';
import { BaseValueObject } from '../../../electron/lib/baseValueObject.js';

class PathObject extends BaseValueObject<'PathObject', string> {}

// Export class for testing inheritance (this violates the pattern but is needed for test fixtures)
export { PathObject };
// Also export as type for correct usage
export type { PathObject as PathObjectType };
export const PathObjectSchema = z
  .string()
  .transform((val) => new PathObject(val));
