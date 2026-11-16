#!/usr/bin/env bash
# Compile the Compact contracts. Requires the Compact toolchain on PATH (`compact`).
# Output goes to managed/<Contract>/ (gitignored). Command form taken from the Business 20 repo's
# midnight/krypto_aml/README.md: `compact compile <source.compact> <output-dir>`.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v compact >/dev/null || { echo "error: 'compact' not found on PATH; see docs/toolchain.md" >&2; exit 127; }
echo "== toolchain =="; compact --version 2>&1 || true; compact compile --version 2>&1 || true
for c in AML_Gate PoR; do
  echo "== compiling $c =="
  compact compile "contracts/$c.compact" "managed/$c"
done
echo "== done. Next: npm run crosscheck:circuit && npm run crosscheck:por =="
