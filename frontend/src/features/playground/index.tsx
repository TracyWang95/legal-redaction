/**
 * Playground page — single-file redaction workflow.
 * Bridge: re-exports from pages/Playground.tsx until full migration completes.
 *
 * Migration progress:
 * - hooks/use-playground-recognition.ts ✅ (recognition logic extracted)
 * - types.ts + utils.ts ✅ (preserved helpers)
 * - Remaining: use-playground.ts, all components, this index.tsx
 */

// Re-export as a bridge during migration
export { Playground } from '@/pages/Playground';
