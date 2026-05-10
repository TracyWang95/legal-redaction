<!--
Copyright 2026 DataInfra-RedactionEverything Contributors
SPDX-License-Identifier: Apache-2.0
-->

# Public Benchmark Fixtures

This directory is populated by:

```bash
npm run fixtures:documents
```

The generated DOCX and searchable PDF are synthetic and safe for public
regression checks. They are used by:

```bash
npm run eval:public -- output/playwright/eval-public-current
```

`eval:public` verifies direct text recognition, DOCX/PDF extractable-text
redaction safety, and offline visual fallback behavior without backend auth,
model services, or private a private corpus directory configured with `EVAL_CESHI_DIR` files. The public gate now treats the
redacted DOCX/PDF files as demo export artifacts and fails if either output is
missing or empty.
