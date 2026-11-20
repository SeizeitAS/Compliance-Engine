---
status: accepted (owner, 2026-11-16; decision D1 in docs/reserve-side-plan.md)
---

# `@noble/hashes`, `@noble/curves` and `@scure/base` for wallet control proofs, outside the core

Control proofs from real wallets need blake2b-224, keccak-256, secp256k1 recovery and bech32/bech32m,
and `node:crypto` has none of these. We take the three audited noble/scure packages at exact versions
with a lockfile, and use them only in the control-proof code, never in `sumTree` or `indexedMerkleTree`.
COSE needs only a small CBOR subset, so we write that reader in-repo instead of taking a CBOR dependency.

**Considered options**: writing these primitives in-repo (rejected because it is easy to get wrong
and hard to audit); a full wallet SDK (rejected because it is a large dependency tree for a verifier).
