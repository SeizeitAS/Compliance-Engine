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
npm test            # proof library, credential intake, i18n and vector tests (Node >= 22.18, no dependencies)
npm run contracts:compile && npm run crosscheck:circuit   # needs the Compact toolchain (docs/toolchain.md)
npm run time:report
```
All code and documentation are English; see `CONTRIBUTING.md`.

## Known gaps (not production)
1. `AML_Gate.compact` is written in real Compact syntax but has **not been compiled** yet; the TypeScript reference and the circuit are cross-checked by golden vectors that must be run on a machine with the compiler (`docs/toolchain.md`).
2. `PoR.compact`: `expected_root` is never checked against the private accounts, reserves are an unverified public input, the `uint64` sum can overflow, and 1024 accounts is too few (CE-6).
3. The blueprint's "Compact 0.5.1" and `import midnight.crypto.*` are wrong: the real compiler reports a language version around 0.23 to 0.26 (`docs/toolchain.md`). `PoR.compact` still uses invalid syntax (CE-6).
4. Oracle Stage 1 filtering (reject outside 1 sigma) discards about a third of normal samples and is unstable with 3-4 sources; consider median/MAD.
