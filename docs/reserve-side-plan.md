# Plan: the reserve side of Proof of Reserves (CE-21 to CE-24 and CE-26)

Status: **plan, nothing built yet.** Date: 2026-11-16.

## Goal
Close the gap named in `docs/security-review.md` SR-2 and SR-11: today `verifyReservePackage`
(`src/por/reserves.ts`) checks holdings, prices and control proofs, but the control proof is a raw
ed25519 signature that no real wallet produces, address derivation exists only for a test chain, and
balances are taken on trust. When this plan is done, an auditor can take a published report and, with
no trust in the operator, (1) see which addresses the operator controls, (2) re-read their balances
at the snapshot height from independent sources, and (3) recompute the NOK total with prices anchored
in the Assetprice oracle.

Chains in scope, taken from the assets Business 20 manages: **Cardano (ADA and native tokens),
Ethereum (ETH), Midnight (NIGHT)**.

## What already works (do not redo)
Package hash and in-circuit attestation binding, challenge over period + root + address (no replay),
integer valuation rounding down with haircuts, price age checks, fail-closed address derivation,
strict input validation. The plan generalises the control proof and fills in the injectable parts.

## Facts that shape the plan
- **Cardano wallets (CIP-30 `signData`) do not sign raw bytes.** They return a `COSE_Sign1` signature and
  a `COSE_Key`; the signed bytes are a COSE `Sig_structure`, the protected header carries the address,
  and the payload is embedded. A verifier must parse CBOR/COSE, check the algorithm is EdDSA, that the
  embedded payload equals our challenge and that the header address matches. (Sources: CIP-8, cardano-signer,
  Evolution SDK docs; one secondary source says the payload cannot go in `external_aad`, to be checked
  against the CIP-30 text.)
- **Cardano addresses** need blake2b-224 (key hash), header byte and bech32; `node:crypto` has no
  blake2b-224. **Ethereum** needs keccak-256 (not SHA3-256) and secp256k1 recovery for `personal_sign`
  (EIP-191). Neither is in `node:crypto`.
- **Midnight unshielded addresses** are Bech32m (`mn_addr`, `mn_addr_preprod`, ...) over a 32-byte payload.
  The signature scheme for unshielded keys is **not confirmed**: the runtime exports BIP-340 helpers
  (`signingKeyFromBip340`, `verifySignature`) which suggests secp256k1 Schnorr, but that is an
  inference to verify in the wallet SDK source (step 1).
- Multisig or script addresses, and custodial cold storage, cannot always produce a single-key signature.
- `CONTRIBUTING.md` rule 3: no runtime dependency without discussion.

## Decisions needed from the owner
| # | Decision | Recommendation |
|---|---|---|
| D1 | Dependencies for blake2b, keccak, secp256k1, bech32 and CBOR | Approve `@noble/hashes` and `@noble/curves` (zero dependencies, widely audited, ESM) and a minimal in-repo CBOR reader for COSE. Writing our own crypto is the riskier option. Pin exact versions, as the Midnight docs also advise for their stack. |
| D2 | Balance data sources | Two independent sources per chain, one of them our own node or indexer, plus the Business 20 database as a third, non-authoritative cross-check. |
| D3 | What counts as reserves | Only assets in addresses with a verified control proof; haircut per asset set by policy; staked or locked assets (ADA staking is liquid on Cardano; Midnight NIGHT lock-ups need checking) need an explicit rule. |
| D4 | Custody structure | List multisig, script and HSM addresses up front; for those the scheme is a different control proof (CE-21 step 5). |

## Steps
Story points use the project scale. Each step ends with `npm test` green and, where a circuit changes,
the three checks (`crosscheck`, `runtime:check`, `prove`) on both ledgers.

### CE-21: control proof schemes (8 points)
Make `Holding.control` a tagged union `{ scheme, ... }` and verify per scheme.
1. **Verify the unknowns first (spike, 1 point):** read the CIP-30 text and a real wallet's `signData`
   output; read the Midnight wallet SDK for the unshielded key and signature scheme.
2. **`cip30-ed25519`:** parse `COSE_Sign1` and `COSE_Key`, rebuild the `Sig_structure`, verify EdDSA, check
   payload equals our challenge bytes and the protected-header address equals the holding address.
3. **`evm-personal-sign`:** EIP-191 message from the challenge hex, keccak-256, secp256k1 recovery, compare to
   the Ethereum address (EIP-55 aware).
4. **`midnight-unshielded`:** scheme as found in step 1 (BIP-340 Schnorr is the hypothesis).
5. **Script and multisig addresses:** either an m-of-n set of single-key proofs checked against the
   script, or an explicit `attested-custodian` scheme that is reported as weaker and never counted
   silently as proven.
- Acceptance: known-answer vectors from each ecosystem (a CIP-30 signature produced by a real wallet, an
  EIP-191 example, the BIP-340 test vectors) pass; a signature for another period, root, address or
  payload fails; unknown scheme fails closed.

### CE-22: address derivation (5 points)
Implement `deriveAddress(chain, key)` for Cardano (base and enterprise, mainnet and testnet), Ethereum
and Midnight, replacing the injectable stub as the default. Known-answer tests from public examples;
network and format mix-ups (testnet address in a mainnet report) must fail.

### CE-23: balance snapshots (8 points)
A `BalanceSource` interface per chain that returns `{ amount, blockHeight, blockHash }` for an address
and asset at the snapshot height, plus the evidence that was read.
- Pin to a height, not "latest"; record block hash so a reorg is visible.
- Cardano: UTxO set at a slot for payment credential, including native tokens.
- Ethereum: `eth_getBalance` at a block, ERC-20 balances if needed.
- Midnight: indexer query for unshielded balances; shielded balances cannot be read by an auditor without
  a viewing key (ties to CE-18 auditor access), so they are listed as unverifiable, not counted.
- `verifyReservePackage` gains an optional `sources` argument; with it, each `amount` must equal the
  independently read value, and a mismatch names both. Two sources must agree.
- Acceptance: a recorded-fixture test per chain, and a tamper test (amount edited by one unit fails).

### CE-24: price anchoring (5 points, shares work with CE-8)
Replace the flat price hash by inclusion proofs against an Assetprice Merkle root anchored on Midnight
(blueprint section 3.3), with the oracle's own timestamp and source set. Prices outside the freshness
window or without a valid inclusion proof fail. Blocked on the Assetprice anchoring API (CE-8 and
AP12/AP14 in that repository).

### CE-26: auditor tool and report (3 points)
One command `npm run por:audit -- <report.json>` that runs everything above and prints a plain
pass/fail per check with the numbers, plus a human-readable summary (English, strings in `locales/`,
Norwegian translation). This is the artefact an external auditor or Finanstilsynet-facing document
would reference.

## Order and dependencies
1. CE-21 step 1 spike and decisions D1 to D4 (unblocks everything).
2. CE-21 steps 2 to 4 and CE-22 in parallel by chain (Cardano first: the longest wallet-format path).
3. CE-23 per chain once its derivation and control proof exist.
4. CE-24 when the Assetprice API is available; CE-26 last.
Total 29 points, about two sprints at the current pace; the unknowns in step 1 and D1 can move that.

## Risks
- Wallet formats change; keep vectors from real wallets in `test/vectors/` and re-run them in CI (CE-14).
- A control proof shows the key signed this report, not that the funds are unencumbered. Pledges, loans
  and rehypothecation are an audit and policy question that no code here answers.
- Reading balances needs reliable infrastructure; an outage must produce "cannot verify", never a pass.
- Shielded Midnight balances are invisible to an auditor without a viewing key.
- Legal: what the report may be called under MiCA and Norwegian law is not decided by this plan.

## Not in this plan
In-circuit verification of foreign signatures (not available in Compact), a trusted third-party
attestation service, and the sanctions side (`docs/security-review.md`).
