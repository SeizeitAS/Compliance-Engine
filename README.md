# Compliance Engine

Zero-knowledge compliance framework (MiCA, AMLR, Norwegian Hvitvaskingsloven) on Midnight / Cardano,
fed by the [Assetprice](https://github.com/SeizeitAS/assetprice) multi-source NOK price oracle.

- `docs/compliance_engine_documentation.md` – architectural blueprint
- `contracts/PoR.compact` – Proof-of-Reserves circuit (draft)
- `contracts/AML_Gate.compact` – sanctions non-membership circuit (draft, not yet compiled)
- `src/sanctions/` – tested reference implementation of the non-membership proof
- `src/i18n/`, `locales/` – language system (English source, Norwegian translation)
- `docs/` – see `docs/README.md` (scrum, time tracking, proof design, research)

## Quick start
```
npm test            # proof library and i18n tests (Node >= 22.18, no dependencies)
npm run time:report
```
All code and documentation are English; see `CONTRIBUTING.md`.

## Known gaps (not production)
1. `AML_Gate.compact` is untested against a real Compact compiler; the TypeScript SHA-256 hashing and the circuit hash differ (see `docs/non-membership-proof.md`).
2. `PoR.compact`: `expected_root` is never checked against the private accounts, reserves are an unverified public input, the `uint64` sum can overflow, and 1024 accounts is too few (CE-6).
3. Blueprint syntax and version (`pragma compact 0.5.1`, `import midnight.crypto.*`) are unverified; Sisit articles describe Compact toolchain 0.35/0.36.0 on ledger 9 (see `docs/research/sisit-insight-review.md`).
4. Oracle Stage 1 filtering (reject outside 1 sigma) discards about a third of normal samples and is unstable with 3-4 sources; consider median/MAD.
