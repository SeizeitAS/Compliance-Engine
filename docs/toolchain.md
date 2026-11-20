# Compact toolchain and how to verify the contracts (CE-5)

## Status
**`AML_Gate.compact` compiled and was cross-checked on 2026-11-16 (compiler 0.31.0, language 0.23.0, runtime 0.16.0). `PoR.compact` (CE-6) compiled and was cross-checked the same day.** The development container has no
Compact compiler (GitHub releases are blocked there) and installing third-party packages was not
allowed, so everything below is prepared to run on a machine that has the compiler (the Preprod
machine). Nothing in this document claims a compile has succeeded.

## Versions: what is known, and from where
| Fact | Source |
|---|---|
| A contract in the Business 20 repo compiled with **compiler 0.31.0, language 0.23.0, runtime 0.16.0** (25 Sep 2026, on the Preprod/devnet machine) | `midnight/krypto_aml/README.md` (business20-kryptoforvaltning, `master`) |
| Compile command: `compact compile <source.compact> <output-dir>` | same file |
| OpenZeppelin Compact Contracts 0.4.0 (published 2026-11-04) declares `pragma language_version >= 0.26.0` and builds with a `--feature-zkir-v3` flag | npm `@openzeppelin/compact-contracts@0.4.0` |
| npm: `@midnight-ntwrk/compact-runtime` 0.21.0 (2026-11-03), `compact-js` 3.0.0, `midnight-js` 5.0.0 (2026-11-06); the scope is migrating to `@midnightntwrk` | npm registry, 2026-11-16 |
| **All three networks run ledger 9** with toolchain 0.36.0 (language 0.28.0), compact-runtime 0.21.0, compact-js 3.0.0, midnight-js 5.0.0, proof server 9.0.0, node 2.1.101, indexer 4.4.101. Mainnet upgraded 2026-11-06, Preview relaunched 2026-11-07, Preprod upgraded in place 2026-11-09 | Midnight docs, release compatibility matrix and "fix version mismatches" (retrieved 2026-11-16) |

**Correction:** the blueprint and some code comments say "Compact 0.5.1". That is the version of the
`compact` CLI (toolchain manager), not the language version: the compiler is 0.31.0 and the language
0.23.0. Treat "0.5.1" as a mislabel when used for the language (the Business 20 header comment carries it too) and pin real versions as below.

## Version to record (fill in on the compiler machine, then commit)
```
compact --version            # 0.5.1  (this is the Compact CLI / toolchain manager, NOT the language version)
compact compile --version    # 0.31.0 (compiler)
language version             # 0.23.0 (contract-info.json), runtime-version 0.16.0
node --version               # v18.19.1 on the compiler host (crosscheck scripts are plain Node ESM)
ledger / network target      # ledger 8 here (compiler 0.31.0, proof server 8.1.0); public networks are on ledger 9, see below
```
The target must match the network you deploy to; see "Ledger target" below.

## Procedure on the compiler machine
```
npm run contracts:compile        # compact compile contracts/AML_Gate.compact managed/AML_Gate
npm run crosscheck:circuit       # byte-compares circuit hashes and Merkle root with the TS reference
npm test                         # reference implementation + golden-vector consistency
```
Optional before compiling: `npm install --no-save @midnight-ntwrk/compact-runtime` then
`npm run crosscheck:hashes`, which tests whether `persistentHash` equals SHA-256 over our byte layout.

## What `crosscheck:circuit` proves
The circuit's exported pure circuits (`hash_leaf`, `hash_node`, `compute_root`) produce exactly the
bytes in `test/vectors/nonmembership-vectors.json`, which the TypeScript reference generates
(`npm run vectors`). A pass means the tree built off-chain and the root recomputed in the circuit
agree. It does **not** test proving, the ledger operations, or a node.

## Likely first failures, and what each means
| Symptom | Likely cause | Fix |
|---|---|---|
| Syntax error near `pragma` | Language version too low or too high | Set `pragma language_version` to the value reported by your compiler |
| Error on `is_right[i]` / `siblings[i]` | Dynamic vector indexing inside the loop | Replace the loop with `fold` over `zip`ped vectors, or unroll |
| `Uint<128>` to `Bytes<32>` cast rejected | Cast chain unsupported | Hash a `Field` instead, or build the bytes with `pad`/vector ops |
| Disclosure error on `receipts.insert` or `sanctions_root =` | Missing `disclose(...)` on a witness-derived value | Wrap the value, as OpenZeppelin does for commitments |
| `FAIL hash_leaf` only | Number byte order is big-endian, not little-endian | Change `num32` in `src/sanctions/indexedMerkleTree.ts`, regenerate vectors |
| `FAIL` on every hash | `persistentHash` is not plain SHA-256 over the concatenation | Make the TypeScript hash call the Midnight runtime instead of `node:crypto`; keep the layout |

Send the exact compiler output for anything not listed; do not edit tests to make a mismatch pass.

## PoR (CE-6)
`contracts/PoR.compact` was rewritten as a Merkle sum tree, compiles (one proving circuit,
`publish_solvency_report`) and passes `npm run crosscheck:por`. See `docs/proof-of-reserves.md`.

## Result of the first compile (2026-11-16)
- `npm run contracts:compile` succeeded after one fix: `let` is a reserved word, so `compute_root` now
  walks the path with `fold(merkle_step, leaf, siblings, is_right)` (a pure helper circuit
  `merkle_step`). Two circuits compiled: `prove_not_sanctioned`, `update_sanctions_root`; prover and
  verifier keys were generated under `managed/AML_Gate/`.
- Needs `npm install --no-save @midnight-ntwrk/compact-runtime@0.16.0` (the version the compiler
  reports) before `crosscheck:*` can import the generated contract.
- `crosscheck:circuit`: PASS on `hash_leaf[0]`, `hash_leaf[1]`, `hash_node[0]`, `compute_root` (depth 20).
- `crosscheck:hashes`: PASS, `persistentHash<Vector<3,Bytes<32>>>` equals SHA-256 of the concatenation.
- Assumptions settled: SHA-256 layout (yes), little-endian numbers (yes), `pragma >= 0.23.0` (accepted).
  Indexing `siblings[i]` in a loop was not tested; the fold replaced it. No tests were changed.
- PoR: compiled; `crosscheck:por` PASS (see `docs/proof-of-reserves.md`).
- Not verified: proving, execution against a node, ledger 8 vs 9 target, the reserve-side proof.

## Ledger target (2026-11-16)
**Finding: what this repository compiles and proves against is ledger 8, and no public Midnight
network runs ledger 8 any more.** Per the Midnight release compatibility matrix, Mainnet, Preview and
Preprod all run ledger 9 (Mainnet 2026-11-06, Preview relaunched 2026-11-07, Preprod upgraded in place
2026-11-09) with toolchain 0.36.0 (language 0.28.0), compact-runtime 0.21.0, compact-js 3.0.0,
midnight-js 5.0.0 and proof server 9.0.0. The earlier note here that Preprod stayed on ledger 8 is
superseded.

| Component | This repo / the compiler host (the test host) | Public networks |
|---|---|---|
| Compiler | 0.31.0 (language 0.23.0) | 0.36.0 (language 0.28.0) |
| compact-runtime | 0.16.0 | 0.21.0 |
| Proof server | 8.1.0 (docker, 5 months old) | 9.0.0 |
| Ledger | 8 | 9 |

Also on the host: dev node images "midnight-node:latest-main" and "1.0.0", both months old, so the
local devnet is a ledger 8 environment. Contracts compiled with 0.31.0 will not run on the public
networks; recompiling changes verifier keys (per the compact-js release notes).

midnight-js 5.0.0 carries both a ledger 8 and a ledger 9 protocol layer, so one client stack can talk to
either; the contract artefacts, runtime and proof server must still match each other.

### Ledger 9 migration (CE-20), done 2026-11-16
Both contracts build, run and prove on the ledger 9 stack. Nothing was deployed.
1. `compact update 0.36.0 --no-set-default` installed toolchain 0.36.0 next to 0.31.0 and left the host
   default untouched (other projects on the host still use 0.31.0). Use it with
   `COMPACT_VERSION=0.36.0 OUT_DIR=managed-l9 npm run contracts:compile`.
2. **No source changes were needed:** both contracts compile unchanged with 0.36.0 (language 0.28.0,
   runtime 0.21.0; `pragma language_version >= 0.23.0` still accepted). Verifier keys differ from the
   0.31.0 build, as expected.
3. A second working copy holds the ledger 9 packages, because one `node_modules` can only hold one
   runtime: copy the repo (without `node_modules`), put the ledger 9 output at `managed/`, then
   `npm install --no-save @midnight-ntwrk/compact-runtime@0.21.0 @midnightntwrk/ledger-v9@1.0.0`.
4. Proof server 9.0.0 runs beside 8.1.0 (`docker run -d --name proof-server-l9 -p 127.0.0.1:6301:6300
   midnightntwrk/proof-server:9.0.0`). On first start it downloads and verifies its parameters from
   srs.midnight.network, so the host needs outbound access once.
5. Results in the ledger 9 copy (Node 18.19.1):
   - `crosscheck:circuit`, `crosscheck:por`: PASS (hashes and layout are identical to ledger 8).
   - `runtime:check`: 22 of 22 PASS.
   - `LEDGER=9 PROOF_SERVER=http://localhost:6301 npm run prove`: both circuits proved, 5420 bytes each
     (4508 on ledger 8); AML 112 s, PoR 5 s.

API differences handled in `scripts/lib/harness.mjs` (the same checks run on both ledgers):
- `createCircuitContext` takes an options object including the circuit name (0.16.0: positional).
- Contract `initialState` and the circuits return Promises (ledger 8: plain values).
- The context nests state under `callContext`; proof data is in `callProofDataTrace` instead of
  `result.proofData`.
- Generated contracts also export `expectedVk`.

Still open: the generated proofs are not verified, nothing is deployed to Preprod or Mainnet, and the
ledger 8 artefacts remain only useful for the local devnet.

Sources: https://docs.midnight.network/relnotes/support-matrix and
https://docs.midnight.network/how-to/fix-version-mismatches (retrieved 2026-11-16).
