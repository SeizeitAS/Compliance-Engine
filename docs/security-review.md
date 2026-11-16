# Security review, first pass (CE-15)

Date: 2026-11-16. Scope: `contracts/AML_Gate.compact`, `contracts/PoR.compact`, the TypeScript
references (`src/sanctions/`, `src/por/`) and the scripts that exercise them.

**Read this first.** This is an internal first pass by the same assistant that wrote most of the code,
guided by the owner. It is not an independent review. CE-15 stays open: no production or marketing
claim ("proof of reserves", "sanctions screening proven") is supported until the High findings below
are closed and an external reviewer has looked at the circuits.

## Method
Read the circuits and references end to end; checked hash layouts and domain separation; ran the
compiled circuits in the runtime with hostile inputs (`npm run runtime:check`, 22 checks); added tests
for the properties that matter (`test/por.test.ts`, `test/reserves.test.ts`); reasoned about each trust
assumption. Not done: formal verification, fuzzing, an independent audit, review of the proof system.

## Findings
Severity: High = a production claim would be false or the system can be defeated by its operator or a
user; Medium = a weakness with a known mitigation; Low = hardening; Info = to be aware of.

| ID | Sev | Where | Finding | Status |
|---|---|---|---|---|
| SR-1 | High | AML_Gate | **The subject key is a prover-asserted witness.** The proof shows "some key is not on the list", not "this customer's key is not on the list". A listed person can prove with any other key. | Open, blocked by CE-9 (derive the key in-circuit from an issuer-signed credential) |
| SR-2 | High | PoR | **The solvency check uses an operator-declared reserve figure.** The circuit proves `total <= declared reserves`; an inflated figure passes. Truth of the figure rests on the off-circuit reserve package. | Partly mitigated (attestation binding, `verifyReservePackage`); real-chain derivation, balance reads and further control schemes open (plan: `docs/reserve-side-plan.md`) |
| SR-3 | High | both | **Single admin secret governs everything.** It decides the sanctions root and every PoR report. A stolen or coerced secret can publish an empty sanctions list or any root. No rotation, no timelock, no publication of the source list hash, no recovery. | Open; design below (CE-25) |
| SR-4 | Medium | AML_Gate | **The circuit cannot check that the root is a correct sorted-range tree.** A publisher error or lie (overlapping or oversized ranges) lets a listed key pass. | Open; mitigate with a reproducible root build from the published list and independent rebuilds (CE-7) |
| SR-5 | Medium | AML_Gate | **Receipt privacy and binding.** The receipt is `H(nonce, list_version, key)` with a prover-chosen nonce. Keys derive from low-entropy identifiers (an 11-digit national ID is about 2^37 values), so a weak nonce lets anyone brute-force the identity from the public receipt. The receipt is also not bound to a relying party or session. | Open; fix: nonce from a CSPRNG enforced by the client library, add a relying-party challenge as a public input |
| SR-6 | Medium | PoR | **Interior sums are only checked by customers beneath them** (inherent to sum-tree schemes). `test/por.test.ts` demonstrates it: a forged left sub-total is detected by customers under that node and not by customers on the other side; an omitted account is only detectable by its owner. | Accepted with procedure: customer-side verification, auditor sampling, inclusion proofs on request |
| SR-7 | Medium | PoR | **Point in time, free period label.** A report proves solvency at publication only (window dressing, borrowed funds). `period` is a free label: gaps and out-of-order periods are possible and there is no on-chain time bound. | Open; fix: a `last_period` counter that must increase, block-time check, reporting policy |
| SR-8 | Low | PoR | Reports are immutable: a wrong report locks that period. | Open; design a `supersede` flow or period plus version |
| SR-9 | Low | AML_Gate | Key truncation to 128 bits: second preimage costs about 2^128, so evasion by crafting a colliding identity is infeasible; the 2^64 birthday bound only matters if an attacker chooses both identifiers, which is not in the threat model. Mapping keys 0 and 2^128-1 to 1 affects about 2^-127 of identifiers. | Accepted, documented |
| SR-10 | Low | reserves.ts | Hex fields were hashed without validation (`Buffer.from(hex)` silently truncates bad input) and amounts and totals were not range-checked against the circuit's types. | **Fixed** in this pass (`MALFORMED_INPUT`, strict lowercase hex, Uint<64>/<128> bounds, 3 tests) |
| SR-11 | Low | reserves.ts | Control proofs assume raw ed25519 signatures. Cardano wallets sign a COSE structure (CIP-8/CIP-30), Midnight and EVM use other schemes. | Open; plan step CE-21 |
| SR-12 | Info | AML_Gate | A proof is checked against the current root, so a root update between proof and inclusion invalidates it (availability, not security). Receipts carry a list version; verifiers must apply a freshness policy. | Documented |
| SR-13 | Info | process | The generated proofs were never verified, nothing was deployed, and the proof system parameters come from `srs.midnight.network` (hash-verified by the server). Proof system and compiler soundness are trusted, not reviewed. | Open: proof verification step (no wallet needed) |
| SR-14 | Info | performance | In-circuit SHA-256 at depth 20 costs: `prove_not_sanctioned` took 112 s on a 4-core host (ledger 9). Acceptable for batch screening, heavy for interactive use. | Note for design |

## Checked, no issue found
- **Domain separation.** Tags differ per use (`ce.leaf.v1`, `ce.node.v1`, `ce.empty.v1`, `ce.receipt.v1`,
  `ce.admin.v1`, `ce.por.leaf/node/admin/attest.v1`). A leaf hashes 96 bytes, the empty leaf 32, and
  an interior node cannot be presented as a leaf because the tag differs.
- **Hash agreement.** `persistentHash` equals SHA-256 over the concatenation and numbers are
  little-endian on both ledger 8 and 9 (`crosscheck:*`).
- **Range logic.** Strict inequalities; a listed key is always an interval endpoint, never interior;
  sentinels 0 and 2^128-1 cannot be keys. Runtime checks cover start, end, outside, forged range, zero
  and foreign root.
- **Overflow.** Sums are `Uint<128>` and every addition is cast back with a range assertion, so a
  prover cannot wrap a sum; balances are `Uint<64>` so none are negative.
- **Replay inside the circuit.** `new_root` and the PoR report are public inputs of the proof, so a
  proof cannot be replayed with different values; a duplicate period is rejected.
- **Admin proof binding.** The admin check hashes a domain-separated secret and uses different tags
  in the two contracts, so one secret cannot be replayed across them.

## Design for SR-3 and SR-4 (CE-25)
1. **Rotation:** a `rotate_admin(new_commitment)` circuit guarded by the current admin.
2. **Multi-party:** replace the single hash by a k-of-n set of admin commitments (for example 2 of 3),
   each approval a separate proof or signature, with a timelock between "proposed" and "applied" so a
   compromised key cannot act instantly.
3. **Source binding:** every `update_sanctions_root` also stores the hash of the official list it was
   built from, the list version and the leaf count, so anyone can rebuild and compare.
4. **Reproducible build:** the root is a deterministic function of the published list (CE-7); a CI job
   and independent parties rebuild it. This is the control for SR-4.
5. **Contract updatability:** Midnight contracts are immutable unless a Contract Maintenance Authority (a
   multisig committee that can insert and remove verifier keys per circuit) is set up at deploy. Decide
   deliberately: enabling it allows fixes but adds a governance key that can change circuit behaviour;
   disabling it makes every bug permanent. If enabled, the committee and threshold belong in the same
   governance design as the admin set, and every change must be announced. (Midnight docs, guides on
   contract updatability; not yet verified against the version in use.)
Each change alters the contracts, so it must be recompiled for ledger 9 and re-run through
`crosscheck`, `runtime:check` and `prove` (all three exist now).

## Not reviewed
`src/eudi/` (SD-JWT VC verifier, CE-9), the i18n code, key management and the client wallet, the
Assetprice oracle, deployment and network configuration, and the legal mapping to MiCA and AMLR.
