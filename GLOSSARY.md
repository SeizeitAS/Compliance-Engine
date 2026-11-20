# Compliance Engine

Zero-knowledge proofs that a customer or the company meets an AML or MiCA rule, without revealing the
underlying data. This file holds the project's terms only. Designs are in `docs/` and decisions in `docs/adr/`.

## Sanctions screening (AML_Gate)

**Sanctions list**:
The set of screened identifiers the gate checks against, committed to as one root on chain.
_Avoid_: blacklist, block list

**Subject key**:
The 128-bit identifier of the person or entity being screened. Today the prover supplies it. CE-9 will
derive it from a verified credential.
_Avoid_: user id, customer key

**Non-membership proof**:
A proof that a subject key is not in the sanctions list. It shows two adjacent list entries that the key
falls strictly between.
_Avoid_: exclusion proof, negative proof

**Sanctions root**:
The Merkle root of the sorted sanctions list. Only the admin can replace it.
_Avoid_: list hash

## Proof of Reserves (PoR)

**Liability**:
What the company owes one customer, as a balance in the liability tree.
_Avoid_: deposit, customer balance

**Liability tree**:
A Merkle sum tree over all liabilities. Each node carries a hash and the sum of its children, so the
root commits to the total.
_Avoid_: customer tree, balance tree

**Reserves**:
Holdings that count towards covering the liabilities. Only proven holdings count (ADR 0004).
_Avoid_: assets, funds, treasury

**Holding**:
One asset at one address or account, with an amount, whether it counts, and the reason.
_Avoid_: position, wallet

**Documented holding**:
A holding that appears in the report and does not count, for example one held at an exchange or staked
at an exchange.
_Avoid_: uncounted asset

**Custodial holding**:
A holding kept by a third party (today NBX), backed only by that party's statement.
_Avoid_: exchange balance

**Control proof**:
A signature over the challenge that shows the company controls an address.
_Avoid_: ownership proof, proof of keys

**Challenge**:
The value a control proof signs. It binds the period, the liability root, the chain and the address,
so a proof cannot be replayed.
_Avoid_: nonce, message

**Reserve package**:
Everything an auditor needs to recompute the reserves: the holdings, prices, control proofs and policy.
Its hash is bound into the attestation.
_Avoid_: reserve report, bundle

**Attestation**:
The on-chain statement for a period that reserves cover the liability total. It is bound to the
reserve package hash.
_Avoid_: certificate, proof of solvency

**Haircut**:
The share of an asset's value that is deducted before it counts, to allow for price and liquidity risk.
_Avoid_: discount, margin

## Prices

**Anchored price**:
A NOK price from Assetprice whose inclusion in a published window root can be checked.
_Avoid_: oracle price, feed price

**Window root**:
The Merkle root over one Assetprice publication window, read from the PriceAnchor contract.
_Avoid_: price root

## Process

**Verified**:
A check that was run, with its result recorded. Anything else is **assumed**, and the docs say so.
_Avoid_: tested (unless a test ran), confirmed
