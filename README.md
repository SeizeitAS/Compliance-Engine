# Compliance Engine

Zero-knowledge compliance framework (MiCA, AMLR, Norwegian Hvitvaskingsloven) on Midnight / Cardano,
fed by the [Assetprice](https://github.com/SeizeitAS/assetprice) multi-source NOK price oracle.

- `docs/compliance_engine_documentation.md` – architectural blueprint
- `contracts/PoR.compact` – Proof-of-Reserves circuit (draft)
- `contracts/AML_Gate.compact` – sanctions non-membership circuit (draft)

## Known gaps (blueprint drafts, not production)
1. `AML_Gate.compact`: `verify_non_membership` is a stub that always returns `true`, so the gate currently proves nothing.
2. `PoR.compact`: `expected_root` is never checked against the private accounts, so the summed balances are not bound to the published liabilities root; reserves are an unverified public input (no link to on-chain addresses or Assetprice values); `uint64` sum can overflow; the 1024-account vector needs batching/recursion for real customer counts.
3. Syntax has not been compiled; verify against the current Compact compiler (the blueprint's `pragma compact 0.5.1` / `import midnight.crypto.*` may not match the real language and stdlib).
4. Stage 1 oracle filtering (reject outside ±1σ) discards roughly a third of samples even with normal data and is unstable with 3–4 sources; consider median/MAD.
