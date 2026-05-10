# Incident Review Note

Case number: IR-2026-00073

Reporter: Maya Chen
Phone: 13800138000
Email: maya.chen@example.test

Affected system: anonymization-worker-03
Internal host: 10.24.18.77

Summary:

On 2026-03-18, reviewer Daniel Park found an unredacted customer name in a PDF
appendix. The source file was named `clinic-transfer-batch-44.pdf`. The record
contained patient ID PAT-884219, appointment date 2026-02-11, and prescription
code RX-ALPHA-903.

Required action:

- Re-run OCR and visual recognition.
- Confirm every page before export.
- Include the generated audit report in the delivery package.
