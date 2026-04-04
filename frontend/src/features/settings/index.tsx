/**
 * Settings hub — recognition pipeline configuration.
 * Wraps the existing Settings page functionality with the new feature module pattern.
 * Full ShadCN migration of individual settings panels is in progress.
 */
// Re-export as a bridge: the actual Settings page stays in pages/Settings.tsx
// until all sub-components are migrated. This file serves as the feature module entry.
export { Settings } from '@/pages/Settings';
