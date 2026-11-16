# Compact toolchain and how to verify the contracts (CE-5)

## Status
**The contracts have not been compiled by this project yet.** The development container has no
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
| Mainnet moved to ledger 9 on 2026-11-06 (toolchain 0.36.0, indexer 4.4.101, Midnight.js 5.0.0); **Preprod stayed on ledger 8** | sisit.no "Midnight Ledger 9" article (secondary source) |

**Correction:** the blueprint and some code comments say "Compact 0.5.1". That is not the
language version: the same repo's compiler output reports language 0.23.0. Treat "0.5.1" as a
mislabel (the Business 20 header comment carries it too) and pin real versions as below.

## Version to record (fill in on the compiler machine, then commit)
```
compact --version            # compiler:   _____
compact compile --version    # language:   _____
node --version               # _____
ledger / network target      # Preprod = ledger 8 per article, verify
```
The target must match the network you deploy to. A contract compiled for ledger 9 will not run on
Preprod while Preprod is on ledger 8.

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

## Not covered by CE-5
`contracts/PoR.compact` still contains invalid, pre-compiler syntax (a Rust-style `ledger { }`
block, `fn`, `Vector<CustomerAccount, 1024>` with an in-circuit loop). It is excluded from the
compile script on purpose and is rewritten under CE-6.
