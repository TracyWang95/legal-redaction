---
paths:
  - "frontend/src/**/*.ts"
  - "frontend/src/**/*.tsx"
---

# Frontend Coding Conventions

## Exports
- Named exports only. No `export default`.

## Component Size
- Components must be under 150 lines. If larger, decompose into sub-components.

## ShadCN UI
- `src/components/ui/` contains ShadCN auto-generated components. Do NOT hand-edit these files.
- Install new components with `npx shadcn@latest add <component>`.
- Use `cn()` from `@/lib/utils` for conditional class merging.

## API Calls
- All HTTP requests go through `@/services/api-client.ts`.
- No raw `fetch()` or standalone axios instances.
- API response types must match `@/types/api.types.ts`.

## Internationalization
- No hardcoded user-facing strings. Use the i18n system.
- Translation keys in `@/i18n/en.json` and `@/i18n/zh.json`.

## Type Safety
- No `any` types. Use `unknown` + type narrowing.
- Zod schemas for form validation with react-hook-form.

## Testing
- All interactive elements need `data-testid` attributes.
- Colocated `.test.ts` files for hooks and utilities.
- E2E tests in `frontend/e2e/*.spec.ts`.

## Styling
- Tailwind utility classes only.
- No inline styles except for dynamic values (image dimensions, positions).
- No custom CSS except design tokens in `index.css`.
