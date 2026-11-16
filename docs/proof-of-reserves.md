# Proof of Reserves design (CE-6)

Implements `contracts/PoR.compact` with the reference `src/por/sumTree.ts`. Replaces the blueprint
draft, which summed 1024 private balances in-circuit without binding them to any published root.

## What was wrong with the first draft
| Gap | Fix |
|---|---|
| `expected_root` was never checked against the private accounts | Every account is a leaf of a Merkle **sum** tree; the published root is a hash over (hash, sum) pairs, so it binds the total |
| `uint64` sum could overflow | Balances are `Uint<64>`, sums are `Uint<128>`, and `(a + b) as Uint<128>` aborts the proof on overflow. 2^20 accounts x 2^64 cannot reach 2^128 |
| 1024 accounts was too few | Depth 20 holds 1,048,576 accounts and the circuit cost is constant in the account count |
| Invalid pre-compiler syntax | Compiles with compiler 0.31.0 / language 0.23.0 |
| Reserves were an unverified public input | Still an input (see limits below), now bound by an `attestation` hash stored with the report |

## Structure
- Leaf: `H(tag || account_id_hash || salt || balance)`, sum = balance.
- Node: hash `H(tag || left.hash || left.sum || right.hash || right.sum)`, sum = `left.sum + right.sum`.
- Empty subtrees use precomputed all-zero nodes with sum 0. Hash layout and little-endian numbers match
  `AML_Gate` (settled by `crosscheck:hashes`).

## What the circuit proves (`publish_solvency_report`)
1. The caller knows the admin secret behind `admin_commitment` (single-admin placeholder, CE-15).
2. The period has not been reported before.
3. The published root is `hash_node(left, right)` for a child pair the prover holds privately.
4. Total liabilities = `left.sum + right.sum`, overflow-checked.
5. `reserves >= total liabilities`.
The report (root, total, reserves, attestation) is stored on-chain under the period key.

## What it does not prove (read before relying on it)
- **Interior sums are not checked in the circuit.** The circuit only opens the top node. Whether every
  lower node really sums its children is checked by customers and auditors with `verify_inclusion`
  (pure circuit, also `verifyInclusion` in TypeScript): recompute root and total from one account path
  and compare with the published report. A dishonest operator can only hide liabilities by omitting
  accounts or understating a branch; the first is caught by customers missing from the tree, the second
  by any customer under that branch whose recomputed total does not match.
- **Reserves are asserted, not proven.** Proving control of on-chain addresses and their value needs
  signatures over the reserve addresses and an oracle price (Assetprice). The `attestation` hash binds
  the report to such a package but the circuit does not check it. Tracked as follow-up work.
- **Account IDs and salts are chosen by the operator.** Customers must receive their own leaf data
  out of band to run the inclusion check.
- **Governance is single-admin** (CE-15) and there is no proof of the circuit against a live node yet.

## Verification status (2026-11-16)
- `npm run contracts:compile`: PoR compiles (one proving circuit, `publish_solvency_report`).
- `npm run crosscheck:por`: PASS on `hash_leaf` x3, `hash_node`, `verify_inclusion` (depth 20).
- `npm test`: 9 new tests in `test/por.test.ts` (sum equals balances, all paths verify, tampering
  fails, understating a balance changes the root, solvency boundary, Uint<128> headroom, range and
  length checks, golden vectors current).
- Not done: proving, ledger execution, a node, the reserve-side proof.
