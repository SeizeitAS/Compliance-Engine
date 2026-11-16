#!/usr/bin/env bash
# Compile the Compact contracts. Requires the Compact toolchain on PATH (`compact`).
# Output goes to $OUT_DIR/<Contract>/ (default managed/, gitignored). Command form taken from the
# Business 20 repo's midnight/krypto_aml/README.md: `compact compile <source.compact> <output-dir>`.
#
# Ledger target (docs/toolchain.md): pick the toolchain that matches the network.
#   default                                  the host's default compiler (0.31.0 on the compiler host, ledger 8)
#   COMPACT_VERSION=0.36.0 OUT_DIR=managed-l9 npm run contracts:compile      ledger 9 (public networks)
# `compact update <version> --no-set-default` installs a version without changing the host default.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v compact >/dev/null || { echo "error: 'compact' not found on PATH; see docs/toolchain.md" >&2; exit 127; }
VERSION_ARG=()
[ -n "${COMPACT_VERSION:-}" ] && VERSION_ARG=("+${COMPACT_VERSION}")
OUT_DIR="${OUT_DIR:-managed}"
echo "== toolchain =="; compact --version 2>&1 || true; compact compile "${VERSION_ARG[@]}" --version 2>&1 || true
for c in AML_Gate PoR; do
  echo "== compiling $c into $OUT_DIR/$c =="
  compact compile "${VERSION_ARG[@]}" "contracts/$c.compact" "$OUT_DIR/$c"
done
echo "== done. Next: npm run crosscheck:circuit && npm run crosscheck:por =="
