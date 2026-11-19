# Plan: the reserve side of Proof of Reserves (CE-21 to CE-24 and CE-26)

Status: **CE-27 built (2026-11-19); the rest is plan.** Date: 2026-11-16.

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

## Decisions (owner, 2026-11-16)
| # | Decision | Outcome |
|---|---|---|
| D1 | Dependencies | **Approved:** `@noble/hashes`, `@noble/curves`, `@scure/base`; exact versions, lockfile, used only outside the core (`sumTree`, `indexedMerkleTree`). A CONTRIBUTING.md exception is recorded when CE-21 starts. A minimal in-repo CBOR reader covers COSE. |
| D2 | Balance sources | Self-custody balances come from the chains (own node or indexer, plus a second provider). Prices come from Assetprice; only CE-24 waits for its API, so interfaces and recorded fixtures are built first. Business 20 is the accounting record, so it is the source of the **documented** holdings list and a reconciliation cross-check, never the authority for a balance. |
| D3 | What counts | **Document everything, count only what is proven.** Every holding appears with `counted` and a reason. It counts only with a verified control proof, an independently read balance, liquidity and no encumbrance, after the per-asset haircut. Exchange-held, staked-at-exchange, shielded and unverified holdings are documented and not counted. The legal question whether own funds may cover client liabilities (versus segregated client assets only) is open and needs a MiCA adviser. |
| D4 | Address types | Answered, see "Situation today". |

## Situation today (owner answers, 2026-11-16)
- Seize it AS's funds are held **at NBX** (a custodial exchange). There are **no private keys** and no
  on-chain addresses the company controls. Part of the NBX holding is **staked at NBX** (a claim on NBX).
- Some assets are booked as held at **Coinbase**; they are to be moved to the owner privately in an
  accounting transaction, after which they leave the company's books. Nothing is built for them.
- Self-custody is being considered: a **Lace wallet against a multisig hardware wallet**, and the set-up
  must work with several possible solutions, so control-proof schemes stay pluggable.
- Everything is booked in **Business 20 Kryptoforvaltning**; reports can be extracted from there.

What follows from that:
1. **No on-chain control proof is possible for today's holdings.** Exchange-held assets are a claim on
   a third party; the only evidence is an NBX statement. They are documented, never counted as proven
   reserves, and labelled as third-party attested (weaker assurance).
2. **Business 20 is not an independent source.** It records what the company believes it holds, so it
   cannot prove it. It is still the right source for the holdings list and for reconciliation with NBX
   statements.
3. **Who is the first real user?** Seize it's own funds are not client liabilities, so for Seize it
   this is a treasury attestation, not a regulatory proof of reserves. The regulatory use is a CASP
   customer of the engine. Fixtures and a test chain stand in until a real structure exists.
4. **Multisig changes the control proof.** A CIP-30 `signData` signature needs an address controlled by one key;
   a script (multisig) address cannot produce one. For script addresses the proof becomes n-of-m
   single-key signatures checked against the script. Which multisig Lace and the hardware wallets
   support is to be verified in the CE-21 spike.

## Steps
Story points use the project scale. Each step ends with `npm test` green and, where a circuit changes,
the three checks (`crosscheck`, `runtime:check`, `prove`) on both ledgers.

### CE-27: custodial attested holdings (3 points), first. DONE 2026-11-19
Built as `custodial` on the package (kept apart from `holdings`), `policyHash`, report `lines` with `counted` and a
reason, `documentedCustodial`, and `reconcileCustodial` (`src/por/reserves.ts`, `test/custodial.test.ts`, 12 tests).
Deviation: the Business 20 adapter is not built; only the comparison function exists. The text below is the plan.
The only case that exists today. A holding kind `custodial-attested` carries `{ custodian, accountRef,
statementHash, asOf, staked }` instead of a control proof. Rules: it is **never** counted as a proven
reserve (`counted: false`, reason "third-party custody"); it is included in the package hash so it is
tamper-evident; the report shows it in a separate section with the weaker assurance label.
- Adds `counted` and a reason to every holding and a policy hash to the package (D3).
- Reconciliation input for a later Business 20 adapter: Business 20 balance versus the custodian
  statement, difference reported.
- Acceptance: a package with only custodial holdings verifies as "documented, reserves counted = 0"; a
  tampered statement hash changes the package hash; counted and documented totals never mix.

### CE-21: control proof schemes (8 points)
Make `Holding.control` a tagged union `{ scheme, ... }` and verify per scheme.
1. **Verify the unknowns first (spike, 1 point). Done 2026-11-20 as far as it can be without a real wallet: see `docs/research/ce-21-spike.md` (CIP-30 payload is signed as is, script addresses cannot sign, Midnight unshielded keys are BIP-340 Schnorr or ECDSA with address = SHA-256 of a Schnorr key; the message frame and a real wallet vector are still open).** read the CIP-30 text and a real wallet's `signData`
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
window or without a valid inclusion proof fail. The Assetprice API exists since 2026-11-17 (hourly blended
prices, Merkle windows, `anchor-v1`). Verification steps: recompute the leaf with `priceLeaf`, walk the path
with `SHA-256(pad32("assetprice.node.v1") || left || right)` (an odd node moves up unchanged), compare with the
window root, then compare with the root stored in the PriceAnchor contract. Until that last step succeeds the
root is a database promise, not independently proven, and the result says `anchored: false`. The anchor is on
the local ce-local network only; Preprod publishing is AP14 in the Assetprice repository.
Freshness: the price for hour H is available from about H+1h07 with a timestamp near H+59m, so with
`maxPriceAgeSeconds = 3600` the snapshot time must fall between H+1h07 and H+1h59.

### CE-26: auditor tool and report (3 points)
One command `npm run por:audit -- <report.json>` that runs everything above and prints a plain
pass/fail per check with the numbers, plus a human-readable summary (English, strings in `locales/`,
Norwegian translation). This is the artefact an external auditor or Finanstilsynet-facing document
would reference.

## Order and dependencies
1. CE-27 now (needs no new dependency and matches the real situation), together with the CE-21 step 1
   spike (CIP-30 text, Midnight scheme, which multisig Lace and the hardware wallets support).
2. CE-21 steps 2 to 5 and CE-22 by chain, only when a self-custody set-up is chosen: until then they run
   against test chains and vectors from real wallets. Script and multisig support (step 5) moves up if
   the multisig hardware wallet is chosen.
3. CE-23 per chain once its derivation and control proof exist; it needs real addresses to read.
4. CE-24 when the Assetprice API is available; CE-26 last.
Total 32 points. The sooner a real self-custody structure exists, the sooner CE-21 to CE-23 have real
data; until 2027 they stay fixture-driven.

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
