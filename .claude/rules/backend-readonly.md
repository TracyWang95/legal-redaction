---
paths:
  - "backend/**"
---

# Backend Protection Rules

The backend is stable and should NOT be modified during the frontend refactoring.

- Do not change any files in `backend/`.
- Do not modify API route signatures or response shapes.
- Backend changes require a dedicated Backend Agent worktree.
- If a frontend change requires a backend modification, document it in `docs/backend-requests.md` instead.
