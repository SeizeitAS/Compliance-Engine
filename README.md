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
npm run contracts:compile && npm run crosscheck:circuit && npm run crosscheck:por && npm run runtime:check && npm run prove   # needs the Compact toolchain (docs/toolchain.md)
npm run time:report
```
All code and documentation are English; see `CONTRIBUTING.md`.

## Known gaps (not production)
1. Both circuits compile, are runtime-checked (22 checks) and were proved with a proof server on **ledger 8** (compiler 0.31.0) and on **ledger 9** (toolchain 0.36.0, the version the public networks run; CE-20, `docs/toolchain.md`). Nothing has been deployed or submitted, and the generated proofs were not verified.
2. `PoR.compact` (CE-6): the root binds the total and sums cannot overflow; interior sums are checked only by customers/auditors (`verify_inclusion`), and the reserve figure is checked off-circuit through a signed reserve package whose real-chain address derivation and on-chain balance reads are not implemented (`docs/proof-of-reserves.md`).
3. The blueprint's "Compact 0.5.1" is the `compact` CLI version, not the language version (0.23.0 here), and `import midnight.crypto.*` is invalid (`docs/toolchain.md`).
4. Oracle Stage 1 filtering (reject outside 1 sigma) discards about a third of normal samples and is unstable with 3-4 sources; consider median/MAD.

## License
Apache License 2.0, see `LICENSE` and `NOTICE`. Parts of `integration/` and `infra/` are derived from Midnight Foundation examples under the same license; their headers are kept.
