#!/usr/bin/env bash
# Copyright 2026 DataInfra-RedactionEverything Contributors
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p tmp

exec npm run dev:app -- --attach-existing
