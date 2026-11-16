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
| CE-5 | Compile and test Compact contracts with the real toolchain | DONE (AML_Gate) | High | 5 | Prepared 2026-11-16: `AML_Gate.compact` rewritten in real Compact syntax, compile and cross-check scripts, golden vectors, `docs/toolchain.md`. **Compiled 2026-11-16** (compiler 0.31.0, language 0.23.0); crosscheck:circuit and crosscheck:hashes PASS; `let` replaced by `fold`. PoR.compact remains under CE-6; proving/node test not done. Original criterion: done when `npm run contracts:compile` and `npm run crosscheck:circuit` pass on the Preprod machine and the versions are recorded. |
| CE-6 | Bind Proof-of-Reserves circuit to the liabilities Merkle root and fix overflow | BACKLOG | High | 8 | See README "Known gaps". |
| CE-7 | Sanctions list ingestion pipeline (official lists to sorted tree root) | BACKLOG | High | 8 | Normalisation rules for names and IDs must be specified and reviewed. |
| CE-8 | Assetprice integration: signed NOK prices into PoR | BACKLOG | Medium | 5 | Consume the `assetprice` HTTP API; anchor Merkle roots on Midnight (AP12/AP14 there). |
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
| CE-15 | Security review of the circuit (soundness, key truncation, list-update governance) | BACKLOG | High | 5 | Must precede any production claim. |

## 5. Sprint log

### S1 (2026-11-16 to 2026-11-27)
**Goal:** a tested non-membership design, the i18n foundation and the process documents.
**Committed:** CE-1, CE-2, CE-3, CE-4. **Stretch:** CE-5.

## 6. Retrospective actions

_None yet._

## 7. Reporting

- Velocity = points of items DONE per sprint, recorded here at sprint review.
- Hours come from `docs/time/timelog.csv` via `npm run time:report`; see `docs/TIME_TRACKING.md`.
