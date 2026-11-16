# Project context for Claude Code sessions

Read this first. It carries the context of the cloud session that built the repository so a local
session can continue without the old conversation.

## What this is
Zero-knowledge compliance engine (MiCA, AMLR, Norwegian Hvitvaskingsloven) for Midnight/Cardano,
fed by the Assetprice NOK price oracle. Owner: Seize it AS / Sisit-gruppen (Trondheim).
Blueprint: `docs/compliance_engine_documentation.md` (original draft, has known errors, see its note).

## Rules (from the owner)
- **All code, comments, commit messages and documentation are in English.** The owner chats in
  Norwegian; reply in Norwegian in chat. User-facing text lives only in `locales/` (`en.json` is the
  source, `nb.json` the first translation). Never put display strings in library code.
- **Never commit secrets, private keys, passwords, tokens, or internal network addresses and hostnames.**
  The local Compact compiler, validator and MariaDB live on the owner's LAN; their addresses stay out of git.
- Do not open pull requests or push to other branches unless asked. Work branch: `ccr-b726918c-xbrbec`.
- Honest status: say what is verified and what is assumed. `AML_Gate.compact` compiled and cross-checked 2026-11-16; `PoR.compact` (rewritten as a Merkle sum tree, CE-6) compiled and cross-checked the same day.
- Track work in `docs/SCRUM.md` (CE-n items); log hours in `docs/time/timelog.csv` (`docs/TIME_TRACKING.md`). Do not invent hours.

## Commands
```
npm test                      # needs Node >= 22.18 (runs .ts directly). 51 tests, no dependencies
npm run contracts:compile     # needs the Compact toolchain (`compact` on PATH)
npm run crosscheck:por        # same for PoR (needs: npm install --no-save @midnight-ntwrk/compact-runtime@0.16.0)
npm run runtime:check          # runs both contracts in the runtime: 22 accept/reject checks
npm run prove                 # real proofs via a proof server (docs/proving.md); LEDGER=9 for the ledger 9 stack
npm run crosscheck:circuit    # compares compiled circuit hashes with test/vectors/ (plain Node ESM)
npm run vectors               # regenerate golden vectors from the TypeScript reference
npm run time:report
```

## Layout
- `src/sanctions/indexedMerkleTree.ts`: sorted-Merkle-tree non-membership proof (reference/oracle). Depth 20, 128-bit keys, hash = SHA-256(tag32 || a32 || b32), numbers little-endian.
- `src/eudi/sdJwtVc.ts`: SD-JWT VC (ES256) credential intake verifier (CE-9 step 1).
- `src/i18n/`: language system. `locales/`: catalogs.
- `contracts/AML_Gate.compact` and `contracts/PoR.compact`: both compiled and cross-checked 2026-11-16. `src/por/sumTree.ts` is the PoR reference (Merkle sum tree), `docs/proof-of-reserves.md` its design and limits.
- `docs/`: `non-membership-proof.md`, `eudi-intake.md`, `toolchain.md`, `i18n.md`, `SCRUM.md`, `TIME_TRACKING.md`, `research/sisit-insight-review.md`.

## Status (2026-11-16)
| Item | State |
|---|---|
| CE-1, CE-3, CE-4, CE-13 | DONE |
| CE-2 non-membership proof | Reference + tests done; circuit uncompiled |
| CE-5 toolchain | **DONE for AML_Gate** (compiler 0.31.0, language 0.23.0, runtime 0.16.0; both crosschecks PASS). Original note: Prepared; must run on the compiler machine: `npm run contracts:compile`, then `npm run crosscheck:circuit`. Record `compact --version` and the language version in `docs/toolchain.md`. Fix real compiler errors; never edit tests to hide a mismatch |
| CE-9 EUDI intake | Off-circuit SD-JWT VC verifier done; mdoc, revocation, Digdir sandbox test, in-circuit version outstanding |
| CE-6 PoR | DONE: sum tree, in-circuit attestation binding, reserve-package verifier (`src/por/reserves.ts`). Open: real-chain address derivation, balance reads, Merkle-anchored prices |
| CE-20 ledger 9 | **DONE for build and proving** (toolchain 0.36.0, language 0.28.0, runtime 0.21.0, proof server 9.0.0): contracts compile unchanged, 22 runtime checks and both proofs pass. Open: proof verification, a deployment to Preprod (needs wallet and funds, ask the owner). The ledger 9 working copy and proof server 9.0.0 (127.0.0.1:6301) live on the compiler host, recipe in `docs/toolchain.md` |
| CE-15 security review | IN PROGRESS: first internal pass in `docs/security-review.md`; High findings SR-1 (key not bound to identity, needs CE-9), SR-2 (reserves declared), SR-3 (single admin, CE-25) open. No production claim until closed and externally reviewed |
| CE-21 to 26 | Reserve-side plan in `docs/reserve-side-plan.md`; owner decisions D1 to D4 needed before CE-21 |
| CE-7, 8, 10 to 14, 16 to 19 | Backlog, see `docs/SCRUM.md` |

## Assumptions the first compile settled (2026-11-16)
All confirmed: 1, 2 and 4 hold; 3 was replaced by `fold` because `let` is reserved. See `docs/toolchain.md`.

Original list:
1. `persistentHash<Vector<3, Bytes<32>>>` equals SHA-256 over the 96 concatenated bytes.
2. `Uint<128> as Field as Bytes<32>` is little-endian.
3. `is_right[i]` / `siblings[i]` indexing inside `for (const i of 0..20)` compiles.
4. `pragma language_version >= 0.23.0` is accepted. `docs/toolchain.md` has a table of likely errors and fixes.

## Facts worth knowing
- "Compact 0.5.1" in the blueprint is a mislabel. A contract in the Business 20 repo compiled with compiler 0.31.0, language 0.23.0 (25 Sep 2026). OpenZeppelin Compact Contracts 0.4.0 needs language >= 0.26.0. Mainnet moved to ledger 9 on 2026-11-06 while Preprod stayed on ledger 8 (per a Sisit article). Compile for the network you deploy to.
- Sibling repos (GitHub, SeizeitAS): `business20-kryptoforvaltning` (branch `master` has `midnight/krypto_aml`, `docs/SCRUM.md`, `docs/TIDBRUKREGNSKAP.md`, `docs/PLAN_BILAG_KANONISK_OG_MIDNIGHT.md`) and `assetprice` (`docs/SCRUM.md`, price oracle). Their docs are Norwegian. `TIME_TRACKING.md` and `SCRUM.md` here should be aligned with `TIDBRUKREGNSKAP.md` and the P-number scheme there (not done yet).
- The machine that has the compiler may be 64-bit while another LAN host is a 32-bit i686 with Node 18: Claude Code and the tests (Node >= 22.18) cannot run on a 32-bit host. Run tests where Node >= 22.18 exists.
- `docs/research/sisit-insight-review.md` lists 75 sisit.no articles and the recommended additions (EUDI, business wallet, Midnight Passport, Travel Rule, reusable KYC, auditor access, CIP-0113).
- The cloud session could not install packages or reach the LAN. Cross-checks that need the Midnight runtime or compiler were prepared but never run.
