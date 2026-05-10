# Contributing

Thanks for helping improve DataInfra · RedactionEverything.

This project handles sensitive local documents, so contributions should favor clear behavior, local-first processing, and strong tests over quick demos.

## Development Setup

Requirements:

| Tool    | Version                                                    |
| ------- | ---------------------------------------------------------- |
| Python  | 3.12                                                       |
| Node.js | 20+ and <25                                                |
| Docker  | 24+ recommended                                            |
| GPU     | Optional, NVIDIA 8 GB+ VRAM recommended for model services |

If `npm run setup` or any root script exits before doing useful work, check
`node --version` first. The repository declares `>=20 <25`, and `.nvmrc` /
`.node-version` both point to Node 24. Older Node versions can fail before the
Python or Docker checks run.

Docker setup:

```bash
git clone https://github.com/TracyWang95/DataInfra-RedactionEverything.git
cd DataInfra-RedactionEverything
cp .env.docker.example .env

docker compose up -d
docker compose --profile gpu up -d
```

Local setup:

```bash
# Install frontend, backend, and local model dependencies.
npm run setup

# Check venvs, model paths, ports, GPU memory, and auth state.
npm run doctor

# Start frontend, backend, OCR, NER, and vision services.
npm run dev
```

Useful local modes:

```bash
npm run dev:attach
npm run dev:app
npm run dev:models
npm run first-run
```

For a fresh open-source clone, the shortest useful confidence check is:

```bash
npm run setup
npm run quality
npm run eval:public -- output/playwright/eval-public-current
```

`npm run quality` is the default contributor gate. It runs i18n parity,
`dev:attach`/docs guard contracts, focused frontend batch review tests, and
eval script contracts with public or temporary fixtures. It does not run
maintainer-only local real files, wrapper diagnostics, or GPU services by
default. Use `npm run quality:dry` to preview the plan, then add
`npm run quality -- --with-frontend-build` or
`npm run quality -- --with-backend-pytest` when those heavier checks matter.
The public eval gate also does not require backend login, model services, or
private documents; use it before moving to GPU-backed or real-file checks.

## Branches And Commits

Branch naming:

```text
feature/<name>
fix/<name>
refactor/<name>
docs/<name>
test/<name>
```

Use Conventional Commits where practical:

```text
feat: add batch re-run recognition button
fix: keep batch progress moving during active OCR
refactor: extract shared job progress helpers
docs: clean quickstart instructions
test: cover failed item requeue flow
```

## Code Style

Frontend:

- Prefer small, focused React components and hooks
- Use existing UI primitives and design tokens before adding new ones
- Route user-facing text through `src/i18n`
- Keep upload, review, and export flows accessible by keyboard where practical
- Add focused unit tests for state helpers and E2E tests for user flows

Backend:

- Keep routers thin; put business logic in `app/services`
- Use Pydantic models for API contracts
- Resolve paths through settings and existing storage helpers
- Avoid cloud API calls or external data transfer in core processing
- Add tests for queue, file, API, and security behavior

## Test Commands

```bash
# Default low-cost contributor gate
npm run quality
npm run quality:dry

# Frontend
cd frontend
npm run test
npm run lint
npm run build
npm run test:e2e

# Backend
cd backend
python -m ruff check app tests
python -m pytest tests -q
```

For model-dependent changes, also run a real sample flow with local files after the GPU services are available.
Prefer a reusable token file over passing passwords through repeated commands:

```bash
DATAINFRA_PASSWORD='your-local-password' npm run eval:login -- tmp/eval-token.txt
DATAINFRA_TOKEN_FILE=tmp/eval-token.txt npm run eval:batch-e2e -- output/playwright/eval-batch-current
npm run test:scripts
npm run eval:text-direct -- /path/to/file.docx output/playwright/eval-text-direct-current
```

For local real-file evaluation, copy `fixtures/local-real-files.example.json`
to `fixtures/local-real-files.json`, edit it to point at files on your machine,
and keep both the manifest and samples uncommitted. Maintainers may have a
default local corpus directory, but contributors should prefer the manifest
flow for their own files. When GPU memory is already high but stable, keep
`BATCH_RECOGNITION_PAGE_CONCURRENCY=1`, `VISION_DUAL_PIPELINE_PARALLEL=false`,
and `HAS_TEXT_N_GPU_LAYERS=0`; high reserved memory alone is not a reason to
raise concurrency.

## Pull Request Checklist

- [ ] The change preserves local-first processing
- [ ] New user-facing strings use i18n keys
- [ ] Frontend tests pass
- [ ] Backend tests pass
- [ ] E2E smoke tests pass or are updated
- [ ] Documentation is updated when behavior or setup changes
- [ ] No sample documents, generated outputs, secrets, or local credentials are committed

## Reporting Issues

For bugs, include:

- Steps to reproduce
- Expected and actual behavior
- Browser and OS
- Backend logs or API response if relevant
- Whether OCR, NER, and vision services were online, busy, or offline

For security issues, follow [SECURITY.md](./SECURITY.md) and do not open a public issue with vulnerability details.

## License

By submitting a contribution, you agree that it will be licensed under the same [Apache License 2.0](./LICENSE) as this repository.
