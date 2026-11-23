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
- **The reserve figure is checked off-circuit.** The circuit stores the figure and an `attestation` it
  computes itself: `H(period, liabilities_root, reserves, reserve_package)`. The auditor verifies the
  package behind `reserve_package` with `src/por/reserves.ts` (next section). The circuit cannot read
  other chains or verify their signatures.
- **Account IDs and salts are chosen by the operator.** Customers must receive their own leaf data
  out of band to run the inclusion check.
- **Governance is single-admin** (CE-15) and there is no proof of the circuit against a live node yet.

## Reserve side: the reserve package
`publish_solvency_report(period, reserves, reserve_package)` stores `reserve_package` and an in-circuit
`attestation = bind_attestation(period, root, reserves, reserve_package)`, so a package cannot be reused
for another period, root or figure. `verifyReservePackage` (`src/por/reserves.ts`) is the auditor's check:
- **Holdings:** chain, address, asset, amount in base units, snapshot height, optional haircut (bps).
- **Control proof per holding:** an ed25519 signature by the key behind the address over
  `H(period, liabilities_root, chain, address)`: it proves control and cannot be replayed.
- **Prices:** NOK per whole unit times 10^8 with a timestamp (Assetprice); stale (default over 3600 s),
  future, missing and duplicate prices are rejected.
- **Control schemes (CE-21):** `control` is either the raw ed25519 proof above, or a scheme-tagged proof from a real
  wallet. `cip30-ed25519` (Cardano, `src/por/cip30.ts`) verifies the output of CIP-30 `signData` (COSE_Sign1 and COSE_Key):
  algorithm EdDSA, the address in the header equal to the holding address, `hashed` not true, the payload equal to our
  challenge, blake2b-224 of the key equal to the address's key hash, and the Ed25519 signature over the `Sig_structure`.
  Script (multisig) addresses are rejected: no wallet can sign for them. `midnight-unshielded` (`src/por/midnight.ts`)
  verifies the dApp connector's `signData`: BIP-340 Schnorr over the SHA-256 digest of
  `midnight_signed_message:<size>:` + challenge, with the address equal to SHA-256 of the 32-byte key. Both were checked
  against a real Lace signature (testnet) and are implemented without dependencies (own BLAKE2b and BIP-340, tested against
  `node:crypto`, Python, the official BIP-340 vectors and the Midnight ledger). `evm-personal-sign` (`src/por/evm.ts`) recovers
  the signer of an EIP-191 `personal_sign` signature over the text `ce.por.control.v1:<challenge hex>` and compares it with the
  holding's `0x` address (EIP-55 checked); it was tested against the published web3.js example and generated signatures, not yet a
  real wallet. The address of the Cardano and Midnight proofs is the hex of the raw address bytes until address encoding
  (CE-22) exists; `deriveAddress` is not used for tagged proofs.
- **Valuation:** integer arithmetic in ore, rounded down, haircut applied: reserves are never overstated.
- **Custodial holdings (CE-27, 2026-11-19):** assets held at a third party (today: NBX) have no key the company
  controls, so they cannot have a control proof. They are listed in `custodial` with custodian, account
  reference, asset, amount, statement date, a `staked` flag and the SHA-256 of the custodian's statement. They are
  **documented, never counted**: their NOK value is returned as `documentedCustodial` and is never part of
  `reserves`, and a claimed reserve figure that includes them is rejected. Every holding appears in `lines` with
  `counted` and a reason. Weaker assurance: the evidence is the custodian's own statement.
- **Policy hash:** an optional `policyHash` (SHA-256 of the counting policy that was applied) is bound into the
  package hash. A package with custodial holdings or a policy hash is hashed with the v2 tag; a package without
  them keeps the v1 hash, so earlier reports stay valid.
- **Reconciliation:** `reconcileCustodial` compares custodian statements with the books (for example Business 20)
  line by line and reports match, mismatch, missing in books or missing in statement. The books are not an
  independent source; this finds differences only.
- **Output:** the recomputed reserve total (counted only), the documented custodial total, the report lines,
  `reserve_package` and `attestation`, which must equal the on-chain report.

Limits, stated plainly:
- Balances at the snapshot height are **claimed**; the auditor must re-read them from each chain.
- Address derivation is injectable and **fails closed** for every chain except the test chain; real
  Cardano (blake2b-224), Midnight and EVM (keccak) derivation is not implemented, and secp256k1 control
  proofs are not supported (no dependencies are allowed without discussion).
- Prices are a flat hash commitment, not yet the Merkle-anchored inclusion proof from the blueprint.
- A control proof shows the key signed this report; it does not show that the funds are unencumbered or
  that the operator holds nothing against them (loans, pledges). That is an audit question.

Security findings for this contract (SR-2, SR-6, SR-7, SR-8) are in `docs/security-review.md`; the plan
to close the reserve-side gaps is `docs/reserve-side-plan.md`.

## Verification status (2026-11-16)
- `npm run contracts:compile`: PoR compiles (one proving circuit, `publish_solvency_report`).
- `npm run crosscheck:por`: PASS on `hash_leaf` x3, `hash_node`, `verify_inclusion` (depth 20).
- `npm test`: 10 tests in `test/por.test.ts` (sum equals balances, all paths verify, tampering
  fails, understating a balance changes the root, solvency boundary, Uint<128> headroom, range and
  length checks, golden vectors current).
- Reserve side: 11 tests in `test/reserves.test.ts` (valuation, haircut, replay, key/address mismatch,
  fail-closed derivation, price age, duplicates, attestation binding); `bind_attestation` cross-checked.
- Runtime and proving: see `docs/proving.md`. Ledger 8 only; ledger 9 migration is CE-20.
- Not done: submission to a node or chain, verification of the generated proofs, real-chain address
  derivation.
