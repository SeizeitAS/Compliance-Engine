# Source-of-funds documentation for crypto transactions (design note, CE-31)

Status: **design note, nothing implemented.** Date: 2026-11-17. It describes a use case the owner is taking to
banks, what the Compliance Engine could prove for it, and, as important, what it could not.

## The problem
A business that trades crypto assets must be able to show, to its bank, its auditor and the supervisor, that
its transactions above a threshold come from an **approved source**, or have been **approved by an
auditor**. Today that means handing over full transaction lists and statements. The goal is to prove the
control was carried out, and let a verifier check it, without publishing the underlying data.

The threshold in the original request is NOK 10,000. According to the owner it comes from a requirement on
banks to report movements above that amount. **The legal basis and the exact scope are not yet confirmed**
(per transaction or aggregated, and which movements are covered) and must be checked before the figure is
written into any claim. The design below takes the threshold as a parameter.

## What can and cannot be claimed
The engine can prove that **a defined control was carried out over a committed set of records**. It cannot
prove that the business "has not laundered money": that is a legal conclusion, not a property of a circuit.

| Can be proven | Cannot be proven |
|---|---|
| Every transaction at or above the threshold in the committed ledger is covered by an attestation from an approved source, or by an auditor approval | That the approved source's attestation is correct |
| The committed ledger is the one the auditor reviewed (same root) | That the ledger is **complete** (a transaction left out of it is not seen) |
| The value used per transaction comes from a committed price (Assetprice, CE-24) | That the price is right, beyond what Assetprice itself proves |
| The set of approved sources is the one published and signed by its administrator | That an approved source should be approved |

A claim that overstates this does more harm than no claim. This is the same rule as for proof of reserves
(`docs/proof-of-reserves.md`).

## Roles
- **Business**: keeps the books, builds the ledger commitment, produces the proof.
- **Attester**: a regulated counterparty (an exchange registered with the supervisor) or an auditor. Signs
  a statement or an approval.
- **Registry administrator**: publishes the list of approved sources (and who may attest). Governance is the
  same open question as in CE-25.
- **Verifier**: the bank or the auditor. Runs the verifier, may ask for the underlying data.

## Data model (sketch)
1. **Transaction record**: id, time, asset, amount, counterparty class, value in NOK (from a price proof),
   evidence hash, and the attestation reference. The ledger is a Merkle tree over the records (the same
   building blocks as `src/por/`).
2. **Approved-source registry**: a Merkle tree over approved attesters (identifier, jurisdiction, status,
   validity period), root signed and anchored. Membership is the mirror image of the sanctions gate
   (`AML_Gate` proves non-membership).
3. **Attestation**: a signed statement from an attester that covers a set of transactions (for example an
   account statement for the period), or an auditor's approval of a single transaction.
4. **Coverage proof**: for each record at or above the threshold, a link to an attestation whose attester is in
   the registry and whose scope includes the record.

### First version: off-circuit, like the reserve package
The first version is a **reference verifier in TypeScript** (as `src/por/reserves.ts` is for reserves). The
verifier recomputes coverage over all records and fails closed. An in-circuit version follows only when the
verifier is stable and the trust model is clear. A sum-tree variant is possible later: each leaf carries the
value of an uncovered large transaction (zero if covered), and the proof is that the root sum is zero. **The
same limit applies as for reserves:** the leaf values are computed by the operator, so a proof over them is
only as good as the check of each leaf. An auditor would have to recompute the leaves, or each leaf would
need an in-circuit attestation check, which is expensive.

## The concrete example: the owner's own books (Business 20)

**Scope and integration (decided by the owner, 2026-11-17):**
1. **The example is limited to 2026.** That is where the accounting data and the vouchers (billag) are most
   exact. In 2025 the owner used a different accounting system, so 2025 is out of scope.
2. **The engine is used from the user's own accounting system.** For the owner that is Business 20; other
   users will use theirs. So the ledger records (see the data model) are produced by an export or connector
   from the accounting system, and the proof is made from that export, not from a separate data entry. The
   export format is therefore a requirement of its own: one connector per accounting system, Business 20
   first. Nothing is built for this yet.
All crypto transactions are booked in Business 20 (Kryptoforvaltning). The same four questions apply to each
category. **None of the answers is known from this repository**: they depend on the data in the accounting
system, which has not been read for this note.

| Category | What would count as evidence | Main gap |
|---|---|---|
| Trades against NBX | Signed or exported statements from NBX (registered with the Norwegian supervisor, as stated by the owner); the registration to be checked against the public register | Statement format and signing; whether a statement can be verified by a third party |
| Trades against Coinbase | Account statements from the Coinbase entity that holds the account | **Which entity and which registration or licence applies** must be checked. Whether it counts as an approved source is a decision for the bank, not for this project. |
| Staking rewards | The voucher (billag) in the books, which can be checked against the source (NBX) when needed. For self-custody the reward events are also on chain and verifiable by anyone | Custodial rewards rest on the exchange statement alone. Whether a bank accepts an auditor-approved voucher is to be confirmed |
| Airdrops | The voucher (billag) in the books, with the distributing transaction, the public eligibility criteria or announcement, the claim transaction and the value at receipt; checkable against the source when needed | No regulated counterparty attests an airdrop, so the auditor approval carries the weight. Same open question about bank acceptance |
| Transfers between own wallets | Control proofs for both addresses (see `docs/reserve-side-plan.md`) | Same as reserves: real wallet formats are not built yet |

Accounting and tax treatment of staking rewards and airdrops is for the accountant and is not decided here.

### Approval path: auditor-approved vouchers
Staking and airdrop vouchers are in the books (per the owner) and can be checked against the source when
needed. The working assumption is that **a voucher approved by the auditor should also be acceptable to the
bank**. That is a hypothesis, not a fact: whether the bank accepts it is the bank's decision and is one of the
questions for the meetings. In the model this is the second branch of the claim ("approved by an auditor"),
with the voucher hash as the evidence hash in the transaction record.

## NDI as issuer of reward statements (CE-32, idea)
The owner's NDI project (sisit.no/ndi) will have to deliver good vouchers for staking rewards in ADA and
NIGHT to its customers. The same building blocks apply:
- A **reward statement** per customer and period: the rewarded address or customer reference, the epoch
  range, the amounts per epoch, the NOK value per amount, a total, and a signature by NDI.
- **Prices** from Assetprice with an inclusion proof (`src/por/priceProof.ts`, CE-24), so the customer's
  accountant can check that each NOK value uses a committed price.
- **Cross-check** against the reward events on the chain, where the chain shows them, so the customer's
  auditor does not have to trust NDI alone. How the NIGHT-side rewards appear on chain, and what the
  customer can verify, is **not established here** and must be checked against the Midnight documentation.
- The statement is then a voucher in the customer's books and can follow the same approval path as above.
Limits to say plainly: NDI attests its own service, so independent verification matters; and Assetprice
roots are anchored on a public network only once AP14 is done (until then a price proof only shows
consistency with Assetprice's own database, not an independent anchor).

## Dependencies and related items
- CE-24 (price inclusion proofs): values in NOK.
- CE-16 (Travel Rule proof) and CE-17 (reusable KYC attestation): the counterparty side.
- CE-7 (list ingestion) and the sanctions gate: the same business can also prove its counterparties were
  not on a sanctions list.
- CE-25 (governance): who publishes the approved-source registry.

## Open questions (for the banks and the auditor)
The list for the meetings is kept outside the repository because it contains the owner's own plans:
what "approved source" means, who may attest, the exact scope of the reporting requirement behind the threshold, whether a proof or the
data is what they require, how an auditor would check it, and who bears the risk of a wrong attestation.

## Next steps
1. Confirm the scope of the bank reporting requirement and the approved-source definition with the banks.
2. Read the Business 20 entries for one period and mark each as covered by a statement, covered by chain
   evidence, or not covered (read only, by the owner or with the owner's explicit go-ahead).
3. Define the record and attestation formats and write the reference verifier (CE-31).
