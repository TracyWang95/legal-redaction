/**
 * Batch wizard — multi-file redaction workflow.
 * Bridge: re-exports from pages/Batch.tsx until full migration.
 *
 * Migration progress:
 * - batch-hub.tsx ✅ (fully rebuilt with ShadCN)
 * - Remaining: 5-step wizard (3510 lines in Batch.tsx + 488 in sub-components)
 */

export { BatchHub } from './batch-hub';
export { Batch } from '@/pages/Batch';
