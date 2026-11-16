# Compliance Engine

Zero-knowledge compliance framework (MiCA, AMLR, Norwegian Hvitvaskingsloven) on Midnight / Cardano,
fed by the [Assetprice](https://github.com/SeizeitAS/assetprice) multi-source NOK price oracle.

- `docs/compliance_engine_documentation.md` – architectural blueprint
- `contracts/PoR.compact` – Proof-of-Reserves circuit over a Merkle sum tree (compiled, draft); design in `docs/proof-of-reserves.md`
- `contracts/AML_Gate.compact` – sanctions non-membership circuit (compiled, draft)
- `src/sanctions/` – tested reference implementation of the non-membership proof
- `src/por/` – tested reference implementation of the liabilities sum tree
- `src/i18n/`, `locales/` – language system (English source, Norwegian translation)
- `docs/` – see `docs/README.md` (scrum, time tracking, proof design, research)

## Quick start
```
npm test            # proof library, credential intake, i18n and vector tests (Node >= 22.18, no dependencies)
npm run contracts:compile && npm run crosscheck:circuit && npm run crosscheck:por   # needs the Compact toolchain (docs/toolchain.md)
npm run time:report
```
All code and documentation are English; see `CONTRIBUTING.md`.

## Known gaps (not production)
1. Both circuits compile (compiler 0.31.0, language 0.23.0) and the hash/Merkle outputs match the TypeScript references (`crosscheck:*`), but **proving and execution against a node are untested**, and the target ledger (8 or 9) is not decided (`docs/toolchain.md`).
2. `PoR.compact` (CE-6): the root now binds the total and sums cannot overflow, but interior sums are checked only by customers/auditors (`verify_inclusion`), and the reserve figure is asserted, not proven (`docs/proof-of-reserves.md`).
3. The blueprint's "Compact 0.5.1" is the `compact` CLI version, not the language version (0.23.0 here), and `import midnight.crypto.*` is invalid (`docs/toolchain.md`).
4. Oracle Stage 1 filtering (reject outside 1 sigma) discards about a third of normal samples and is unstable with 3-4 sources; consider median/MAD.
