# Compliance Engine: Scrum board and process

Language: English only (see `locales/README.md` for user-facing translations).

## 1. Roles

| Role | Responsibility | Holder |
|---|---|---|
| Product Owner | Owns the backlog order and acceptance of stories | Stein Inge (Seize it AS) |
| Scrum Master | Runs the process, removes blockers, keeps this file current | TBD (can be the PO while the team is small) |
| Developers | Deliver increments; AI assistants count as contributors and log time like anyone else | Team |

## 2. Cadence

- **Sprint length:** 2 weeks. Sprint IDs are `S1`, `S2`, ...; S1 starts 2026-11-16.
- **Sprint planning** (day 1, max 2 h): choose backlog items, write the sprint goal in section 5.
- **Daily check-in** (async note or 15 min): done, next, blocked.
- **Sprint review** (last day): demo against acceptance criteria; PO accepts or rejects.
- **Retrospective** (last day): add 1-3 concrete actions to section 6.

## 3. Definitions

**Definition of Ready:** has an ID, a one-sentence user value, acceptance criteria, an estimate in story points (1, 2, 3, 5, 8, 13; anything above 8 must be split), and no unresolved external dependency.

**Definition of Done:** code and docs in English; tests pass (`npm test`); new user-facing strings are in `locales/en.json` (and `nb.json` where practical); documentation updated; time logged in `docs/time/timelog.csv`; reviewed by a second person (or by the PO when solo); merged to the main branch. Anything touching cryptography or legal mapping also needs a written note on assumptions and limits.

**Status values:** `BACKLOG`, `READY`, `IN PROGRESS`, `BLOCKED`, `DONE`, `DROPPED`. Priority: High, Medium, Low.

## 4. Product backlog

| ID | Task | Status | Priority | Points | Comment |
|---|---|---|---|---|---|
| CE-1 | Import blueprint and draft contracts into the repo | DONE | High | 2 | 2026-11-16. See `docs/compliance_engine_documentation.md`. |
| CE-2 | Real non-membership proof for the sanctions gate | IN PROGRESS | High | 8 | Reference implementation and tests done (`src/sanctions/`). Circuit `contracts/AML_Gate.compact` drafted but **not yet compiled**. Done when it compiles, a proof is generated and verified in a local Midnight environment, and the TS and circuit hashes are shown to agree. |
| CE-3 | Internationalisation system and locale files | DONE | High | 3 | `src/i18n/`, `locales/`. English source, Norwegian Bokmal as first translation. |
| CE-4 | Scrum and time tracking documentation | DONE | High | 2 | This file and `docs/TIME_TRACKING.md`. |
| CE-5 | Compile and test Compact contracts with the real toolchain | DONE (ledger 8) | High | 5 | 2026-11-16: compiled with 0.31.0; `crosscheck:circuit`, `crosscheck:por`, `crosscheck:hashes` PASS; `runtime:check` 22 checks PASS; real proofs generated against proof server 8.1.0 (`docs/proving.md`). Ledger 9 target is CE-20. |
| CE-6 | Bind Proof-of-Reserves circuit to the liabilities Merkle root and fix overflow | DONE | High | 8 | 2026-11-16: Merkle sum tree, in-circuit attestation binding, reserve-package verifier (`src/por/reserves.ts`), 21 tests, runtime-checked and proved on ledger 8. Open: real-chain address derivation and secp256k1, Merkle-anchored prices, on-chain balance reads. See `docs/proof-of-reserves.md`. |
| CE-20 | Migrate to ledger 9 (toolchain 0.36.0, runtime 0.21.0, proof server 9.0.0) and re-run crosschecks, runtime check and proving | DONE | High | 5 | 2026-11-16: both contracts compile unchanged with 0.36.0 (language 0.28.0); crosschecks PASS, 22 runtime checks PASS, both circuits proved on proof server 9.0.0. Open: proof verification, deployment to Preprod. See `docs/toolchain.md`. |
| CE-7 | Sanctions list ingestion pipeline (official lists to sorted tree root) | BACKLOG | High | 8 | Normalisation rules for names and IDs must be specified and reviewed. |
| CE-8 | Assetprice integration: signed NOK prices into PoR | IN PROGRESS | Medium | 5 | Assetprice (commit e901286) delivers hourly blended NOK prices with Merkle inclusion proofs; the leaf is byte-identical to `priceLeaf()`. The base URL is configuration, never in this repository. Depends on AP14 there (Preprod publishing, own wallet and Blockfrost key, backup outside the host) before anything can be called anchored on a public network. Verifier: CE-24. |
| CE-9 | EUDI credential intake: verify an issuer-signed SD-JWT VC / mdoc (P-256) inside the AML circuit | IN PROGRESS | High | 8 | Step 1 DONE: off-circuit SD-JWT VC reference verifier + tests (`src/eudi/`, `docs/eudi-intake.md`). Remaining: Digdir sandbox test, mdoc, revocation, and the in-circuit version (blocked on CE-5). |
| CE-10 | Business wallet (virksomhetslommebok / EU Business Wallet) support and entity-level (KYB) gate | BACKLOG | Medium | 8 | Store full EUID, look up by organisation number. Regulation is still a proposal (COM(2025) 838). Start with a requirements spike. |
| CE-11 | Midnight Passport spike | BACKLOG | Low | 2 | Scoped: onboarding/wallet layer plus v2 issuer registry (planned Q1 2027). Re-evaluate after Passport SDK v1 ships. Keep behind our own interface. |
| CE-12 | NIS2 / digitalsikkerhetsloven ZK security-reporting module | BACKLOG | Low | 5 | Mentioned in a sisit.no article as a planned pilot. |
| CE-13 | Full review of every article on sisit.no/innsikt | DONE | Medium | 2 | 2026-11-16. All 75 pages screened, about 15 read in depth. See `docs/research/sisit-insight-review.md`. |
| CE-14 | CI pipeline running `npm test` and the Compact compiler | BACKLOG | Medium | 3 | |
| CE-16 | Travel Rule (TFR II) proof: KYC-identified sender, wallet control, not sanctioned | BACKLOG | Medium | 8 | Review item 4. |
| CE-17 | Reusable KYC attestation ("vetted by an authorised bank") for accountants and auditors | BACKLOG | Medium | 8 | Review item 5. |
| CE-18 | Auditor access via viewing keys / discloseTo for Proof-of-Reserves attestation | BACKLOG | Low | 5 | Midnight plan for Q1 2027; spec unpublished. Design only until then. |
| CE-19 | CIP-0113 interoperability: how a Midnight result reaches a Cardano rule validator | BACKLOG | Low | 5 | Research spike; open design question. |
| CE-15 | Security review of the circuit (soundness, key truncation, list-update governance) | IN PROGRESS | High | 5 | First internal pass done 2026-11-16 (`docs/security-review.md`): 3 High findings open (SR-1 key not bound to identity, SR-2 reserves declared, SR-3 single admin), 4 Medium. Done when the High findings are closed and an external reviewer has reviewed the circuits. Must precede any production claim. |
| CE-27 | Custodial attested holdings: counted flag, policy hash, third-party attestation kind | DONE | High | 3 | Done 2026-11-19 (`src/por/reserves.ts`, `test/custodial.test.ts`, 12 tests; 74 tests in all). Documented, never counted; policy hash in the v2 package hash; report lines; reconciliation function. Not built: the Business 20 adapter and a report text for auditors (CE-26). Not run on-chain: no circuit change, so the existing crosscheck and Preprod run still apply. |
| CE-21 | Reserve control proofs: CIP-30/COSE, EVM personal_sign, Midnight scheme, script addresses | IN PROGRESS | High | 8 | Spike done 2026-11-20 and checked against a real Lace wallet 2026-11-23 (CIP-30 and Midnight signatures verified by hand; `docs/research/ce-21-spike.md`); verifiers built 2026-11-23 for `cip30-ed25519`, `midnight-unshielded` and `evm-personal-sign` (`src/por/cip30.ts`, `midnight.ts`, `evm.ts`, `schnorr.ts`, `secp256k1.ts`, `blake2b.ts`, `keccak.ts`; 121 tests); the first two were checked against real Lace signatures, the EVM one only against the published web3.js example and generated signatures. Open: an EVM signature from a real wallet (for example MetaMask), script and multisig addresses, a second wallet, address encodings (CE-22). Plan: `docs/reserve-side-plan.md`. Decisions D1 to D4 taken 2026-11-16; real data only once self-custody exists (2027), fixtures until then. |
| CE-22 | Address derivation for Cardano, Ethereum and Midnight | DONE | High | 5 | Done 2026-11-24: own Bech32/Bech32m, Cardano CIP-19 (all vectors, network from header and prefix), Midnight `mn_addr_<network>` (checked against the official address library), Ethereum EIP-55; `Options.networks`, canonical duplicate check; 136 tests. Open: Cardano base-address derivation (needs the staking key), Byron, bare-hex Midnight cannot state its network. Plan: `docs/reserve-side-plan.md`. |
| CE-23 | Balance snapshots from independent sources at a pinned height | BACKLOG | High | 8 | Plan: `docs/reserve-side-plan.md`. Shielded Midnight balances need a viewing key (CE-18). |
| CE-24 | Merkle-anchored price inclusion proofs from Assetprice | IN PROGRESS | Medium | 5 | Plan: `docs/reserve-side-plan.md`. Done: `src/por/priceProof.ts` (leaf, path and window-root check, freshness, optional comparison with the root read from the PriceAnchor contract) and tests on synthetic trees. Open: reading the on-chain root (ce-local only for now, not Preprod or mainnet), wiring the proofs into `verifyReservePackage`, a test against a recorded real response, and the on-chain comparison in production. Depends on AP14 in Assetprice. |
| CE-25 | Admin governance: rotation, k-of-n approval, timelock, source-list binding | BACKLOG | High | 8 | Design in `docs/security-review.md` (SR-3, SR-4). Changes both contracts; re-run all checks on ledger 9. Also decide contract updatability: whether to enable a Contract Maintenance Authority at deploy (verifier-key insert/remove by a multisig committee), who sits in it, and how it relates to the admin set; without it a deployed contract is immutable. |
| CE-26 | Auditor tool `por:audit` and report | BACKLOG | Medium | 3 | Plan: `docs/reserve-side-plan.md`. |
| CE-28 | Evaluate remote proving (zkPaaS in Google Confidential Space, or a European equivalent) as an optional proof backend | BACKLOG | Low | 3 | Spike, no build. Motivation: `prove_not_sanctioned` takes 112 s on a 4-core host (SR-14). Requirements first: the proof server sees all private inputs in the preimage (subject key, ranges, paths, admin secret, tree children), so a remote backend needs a GDPR assessment, an accepted TEE trust model, and `PROOF_SERVER` stays configuration. Check whether the published reference architecture exposes the proof-server API (`/check`, `/prove`). Source: Google Cloud case for Midnight Foundation; sisit.no article 2026-11-16. |
| CE-29 | Verify the generated proofs in a real Midnight node (local network first) | DONE (local) | High | 8 | 2026-11-16: local ledger 9 network on the test host (node 2.1.101, indexer 4.4.101, proof server 9.0.0). `integration/` deploys both contracts, calls all three proving circuits (accepted by the node) and shows the node rejecting a proof with one flipped byte (node log: failed to verify proof). A wrong verifier key is refused by the client and proof server before the node. See `docs/proving.md`, `docs/network-plan.md`. Open: public networks (CE-30). |
| CE-30 | Preprod smoke test: deploy and call both contracts with a throwaway test wallet and faucet tokens | DONE | Medium | 5 | Run 2026-11-19 (UTC): PoR and AML_Gate deployed on Preprod and called, all positive checks passed. Results and lessons: `docs/network-plan.md` (Phase 2 results). Open: full contract addresses were not logged (printed from the next run on). No company funds. |
| CE-31 | Source-of-funds proof: transactions at or above a threshold covered by an approved-source attestation or an auditor approval | BACKLOG | Medium | 8 | Design note: `docs/source-of-funds.md` (nothing implemented). First: confirm the threshold and the definition of approved source with the banks, and mark one period of the owner books as covered or not covered. Then a reference verifier. The packs `reporting-limit` and `unexplained` exist in `src/review/packs.ts` (CE-34); the threshold and the definition of an approved source are still parameters, not decisions. Depends on CE-24, relates to CE-16 and CE-17; first rule pack of CE-34 (`docs/rule-api.md`). |
| CE-32 | NDI reward statements: per-customer staking-reward vouchers (ADA, NIGHT) with Assetprice price proofs | BACKLOG | Medium | 5 | Idea in `docs/source-of-funds.md`. Needs: statement format and signing, chain cross-check for each token, anchored prices (AP14 in Assetprice). Depends on CE-24 and CE-31. |
| CE-33 | Publication and community: articles, license, GitHub setup | IN PROGRESS | Medium | 3 | Apache-2.0 license, two sisit.no articles (published by the owner), SECURITY.md, issue and pull request templates, eight starter issues, social preview image. Open: Discussions settings, Dependabot for `integration/` if wanted. |
| CE-34 | Rule API core: record format, commitment, rule-pack interface, coverage and report | DONE | High | 8 | Done 2026-11-24: `src/review/` (records and Merkle commitment with membership paths, engine, packs), 19 tests (155 in all). Design `docs/rule-api.md`. Open: signature check of the auditor on the package hash, report text through the language system, a circuit version. Real criteria wait for the first bank. |
| CE-35 | Exchange statement connector (monthly statements to ledger records) | BACKLOG | Medium | 5 | Needs an anonymised sample statement. Part of `docs/rule-api.md`. |
| CE-36 | Accounting-system export connector (records, vouchers and their hashes) | BACKLOG | Medium | 5 | Part of `docs/rule-api.md`. |
| CE-37 | Further rule packs: aggregate-window, near-limit, counterparty-list, jurisdiction, sanctions | BACKLOG | Medium | 8 | After the criteria owner has said which it wants. |
| CE-38 | Open-core licensing: Apache-2.0 core, separate commercial modules, infrastructure service, contribution terms | DONE | High | 2 | Done 2026-11-24: `LICENSING.md`, `TRADEMARKS.md`, contribution terms with DCO sign-off and an additional license to Seize it AS in `CONTRIBUTING.md`, contributor note in `NOTICE`, README and pull request template updated. Decision by the owner: model B (open core), project owned by Seize it AS. Open: legal review of the contribution terms, a written rights agreement between the sole proprietorship and Seize it AS, and marking each backlog item as open core or commercial when it is planned. |

## 5. Sprint log

### S1 (2026-11-16 to 2026-11-27)
**Goal:** a tested non-membership design, the i18n foundation and the process documents.
**Committed:** CE-1, CE-2, CE-3, CE-4. **Stretch:** CE-5.

## 6. Retrospective actions

_None yet._

## 7. Reporting

- Velocity = points of items DONE per sprint, recorded here at sprint review.
- Hours come from `docs/time/timelog.csv` via `npm run time:report`; see `docs/TIME_TRACKING.md`.
