# Security Policy

DataInfra · RedactionEverything is designed for local or private-network processing of sensitive documents. Security issues should be handled privately and promptly.

## Supported Versions

| Version       | Status    |
| ------------- | --------- |
| `main` branch | Supported |

## Reporting A Vulnerability

Please do not open a public issue for security vulnerabilities.

Use one of these private channels:

1. Open a GitHub Security Advisory: <https://github.com/TracyWang95/DataInfra-RedactionEverything/security/advisories/new>
2. Contact the maintainer through the GitHub profile: <https://github.com/TracyWang95>

We aim to acknowledge valid reports within 48 hours and provide a fix or mitigation plan within 7 days when practical.

## Security Design Principles

| Principle                      | Implementation                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| Local-first processing         | OCR, NER, and vision inference are designed to run locally or inside your private network |
| No cloud dependency by default | Core processing does not require uploading documents to a cloud API                       |
| File isolation                 | Uploaded files and generated outputs stay under backend-managed storage directories       |
| Authentication                 | Production deployments should keep `AUTH_ENABLED=true`                                    |
| Review before export           | Batch processing supports human review before producing final redacted outputs            |
| Service visibility             | Health checks expose whether OCR, NER, and vision services are online, busy, or offline   |

## Deployment Recommendations

- Run the system behind a VPN, reverse proxy, or internal network boundary
- Do not expose ports `3000`, `8000`, or `8080-8082` directly to the public internet
- Keep `AUTH_ENABLED=true` outside isolated local development
- Use strong passwords and rotate credentials when staff changes
- Restrict filesystem permissions for `backend/uploads`, `backend/outputs`, and `backend/data`
- Regularly clean processed files that are no longer needed
- Keep Python and Node dependencies updated
- Use disk encryption on machines that store sensitive source documents
- Avoid committing sample documents, generated redaction outputs, `.env`, tokens, or local database files

## Data Handling

The application does not need telemetry or analytics to process documents. Uploaded content is processed in memory and local storage controlled by the backend. Operators are responsible for retention, backup, and deletion policies in their own deployment.

## Dependency And Model Supply Chain

- Install dependencies from trusted package indexes
- Download model weights from official or organization-approved sources
- Verify model filenames, checksums, and expected runtime behavior before production use
- Pin and review dependency updates for deployments that process regulated data
