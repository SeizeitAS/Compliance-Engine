# A rule API for review packs (design note, CE-34)

Status: **design note, nothing implemented.** Date: 2026-11-24. This note describes how the Compliance Engine
could be used by extension packs that check a business's own records against a set of criteria, and produce a
result that a bank, an auditor or a supervisor can verify without redoing the work. It is written to be read by
those parties as well as by developers. It is not legal advice, and it does not state what any law requires: the
criteria are an input, supplied by whoever asks the question.

## The idea in one paragraph
A business has records (for example the monthly statements of a crypto exchange, entered in its accounting system
with vouchers). A bank has criteria it wants the records checked against: amounts above a reporting limit,
unusual patterns, counterparties on a list. Today the business hands over the records and the bank (or an
auditor) checks them by hand. With a rule API, the criteria are written as a **rule pack**, the records are
**committed** to a fingerprint, the pack is run, and the result says, per criterion, either "no record meets
it" or "these records meet it, and each is explained by this voucher or approval". Anyone with the same inputs
gets the same result, and a change to the records, the criteria or the parameters changes the fingerprint.

## What can and cannot be claimed
The engine can show that **a defined check was carried out, completely and deterministically, over a committed set
of records**. It cannot show more than that.

| Can be shown | Cannot be shown |
|---|---|
| The pack (name, version, parameters) that was run, and that the result follows from the records | That the records are true. A statement is only as reliable as its source |
| No record in the committed set meets a criterion, or each one that does is linked to evidence | That the set is **the whole truth**: a transaction left out of every statement is not seen (see "Completeness" for what narrows this) |
| The result was not changed after the fingerprint was made | That the criteria are the right ones, or sufficient for the law |
| A voucher or approval is referenced by hash, so it cannot be swapped later | That a voucher is genuine, or that an approver should have approved |

A result that overstates this does more harm than no result. The report therefore always prints the limits
next to the findings.

## Roles
- **Business**: owns the records, builds the commitment, runs the pack, may disclose records to the verifier.
- **Source**: where a record came from (an exchange statement, a chain, an accounting system). Its reliability
  is stated in the report (see "Trust level of a source").
- **Criteria owner**: usually the party asking (a bank). Supplies or approves the **parameters** of a pack
  (limits, windows, lists). The engine does not decide what the criteria should be.
- **Approver**: someone who can explain a finding: an auditor, or an approved source. Signs an approval.
- **Verifier**: the bank, the auditor or the supervisor. Runs the same pack on the same inputs and compares.

## Architecture
```
  Sources                 Core                              Output
  -------                 ----                              ------
  exchange statement  -->  Record format                    Review report
  accounting export   -->  Commitment (Merkle root,    -->    per criterion: pass / explained / open
  on-chain data       -->    statement hashes)                counts, record ids, evidence hashes
                           Rule pack (pure function)          the limits of the claim
  Evidence (vouchers, -->  Coverage (finding -> evidence)     package hash + attestation
  approvals)               Report + package hash              (verifiable by anyone with the inputs)
```
Everything in the core runs outside a circuit first, as the reserve package does (`src/por/reserves.ts`). A
circuit version follows only when the verifier and the trust model are stable (see "Privacy and disclosure").

## The core types (sketch)
```ts
/** One movement. Amounts are integers in the asset's base unit; values in NOK are integers in ore. */
interface LedgerRecord {
  id: string;                 // unique within the set, stable across runs
  time: bigint;               // unix seconds, UTC
  asset: string;
  amount: bigint;             // base units, signed (inflow positive)
  valueNokOre: bigint;        // from a committed price (Assetprice, CE-24); the price reference is in `priceRef`
  priceRef: string;           // hash of the price point used
  counterparty?: string;      // as stated by the source; may be absent
  counterpartyClass?: string; // "exchange" | "own-wallet" | "bank" | "unknown" | ...
  jurisdiction?: string;      // ISO 3166 code if the source states it
  sourceDocument: string;     // hash of the statement or export this record came from
  evidence: string[];         // hashes of vouchers attached in the books
}

interface Evidence {          // a voucher or an approval, referenced by hash from the records
  hash: string;
  kind: "voucher" | "auditor-approval" | "source-attestation";
  covers: string[];           // record ids it explains
  signature?: ControlProof;   // optional: reuses the control-proof schemes of CE-21
}

interface RulePack {
  id: string;                 // e.g. "reporting-limit"
  version: string;            // changes when the logic changes
  parameterSchema: Schema;    // what the criteria owner must supply
  evaluate(records: LedgerRecord[], params: Params): Finding[];   // pure, deterministic, integer arithmetic
}

interface Finding { ruleId: string; recordIds: string[]; detail: string }

type Outcome = "pass" | "explained" | "open"; // open = a finding with no evidence: the result is NOT clean
```
Rules for a pack:
1. **Pure and deterministic.** No clock, no network, no randomness. The same records and parameters give the same
   findings in the same order.
2. **Integer arithmetic.** No floating point. Rounding direction is stated in the pack.
3. **Fail closed.** A record that cannot be evaluated (missing value, unknown asset, unparsable time) is a
   finding, not a silent skip.
4. **Parameters are part of the result.** The pack id, version and the hash of the parameters appear in the
   report, so a bank can see that its own numbers were used.
5. **No pack can change another pack's input.** Packs read records; they do not rewrite them.

## Commitment and completeness
The set of records is committed as a Merkle tree (leaf = tagged hash of the record, as in `src/por/`), and each
source document is committed by its hash. The report states the root. What narrows the "left out" gap:
- **Statement chaining.** An exchange statement has an opening and a closing balance. The engine checks that
  the opening balance plus the movements equals the closing balance, and that the opening balance of month N+1
  equals the closing balance of month N. A transaction removed from a month breaks the arithmetic. This catches
  an omission *within* the statements the business hands over; it does not catch a whole account that is not
  handed over.
- **Account list.** The business lists every account and wallet it holds; the report states the list. An
  account that is not on the list is outside the claim, and the report says so.
- **On-chain cross-check.** For self-custody the movements are public, and a verifier can compare them with
  the records independently (CE-23). For custodial accounts there is no such source, and the report says that
  the check rests on the statement alone.

## Trust level of a source
Each source document gets a level, shown in the report, because the strength of the whole result follows the
weakest source:
1. **Signed by the source** (a signed export, or an attestation from the exchange): the strongest.
2. **Pulled from the source's own API** with the pull recorded (time, request, response hash).
3. **An unsigned file** (a PDF or CSV the business downloaded): only a hash. The verifier can ask the source to
   confirm the hash, or compare with the verifier's own copy.
4. **Manual entry**: listed, and counted as such.

## Example packs
Parameters are placeholders until the criteria owner supplies real ones. Nothing here asserts a legal limit.

| Pack | Question | Parameters |
|---|---|---|
| `reporting-limit` | Does any single movement reach or exceed a limit (in NOK, using the committed price)? | limit |
| `aggregate-window` | Does the sum of movements with one counterparty, or in total, reach a limit inside a rolling window? | limit, window length, grouping |
| `near-limit` | Are there several movements just below a limit that together exceed it (a sign of splitting)? | limit, margin, window, minimum count |
| `counterparty-list` | Is any counterparty on a list the criteria owner supplies (for example a high-risk list)? | list, list version |
| `jurisdiction` | Is any movement tied to a jurisdiction the criteria owner names? | set of codes |
| `sanctions` | Was every counterparty address checked against a committed sanctions list? Uses the non-membership proof of the existing `AML_Gate` | list root |
| `unexplained` | Does every movement above a limit have a voucher or an approval attached? | limit |
| `velocity` | Does the number or value of movements in a period exceed what the criteria owner calls normal? | thresholds per period |

The first pack to build is `reporting-limit` combined with `unexplained`, which is CE-31 (`docs/source-of-funds.md`).

## Coverage: how a finding is explained
A finding is not hidden when it is explained: it is shown with its evidence. A finding is **explained** when at
least one `Evidence` item covers every record in it and meets the policy the criteria owner set (for example "an
auditor approval, or a source attestation from an approved source"). Otherwise it is **open**, and the report as
a whole is not clean. Approved sources come from a registry (a signed list, CE-31). Approvals can be signed with
the same control-proof schemes as proof of reserves (Cardano, Midnight, Ethereum wallets, `docs/proof-of-reserves.md`),
so the approver's key is verified, not trusted by name.

## The report
For each pack: id, version, parameter hash, number of records examined, number of findings, outcome (pass,
explained, open), the ids of the records involved and the hashes of the evidence. Then the commitment root, the
list of accounts, the trust level of each source, and the limits of the claim in plain words. The package hash
covers all of it, so a verifier can compare one value. The text follows the language system (`docs/i18n.md`), so
the same result can be printed in Norwegian and English.

## Privacy and disclosure
Three levels, to be chosen together with the verifier:
1. **Full disclosure to the verifier.** The records go to the bank, which runs the pack itself. The engine
   proves nothing extra here beyond the fingerprint, but the work is reproducible.
2. **Selective disclosure.** Only the findings, the evidence and the Merkle paths for the records involved are
   shown; the rest stay private behind the root. The verifier can still check that those records belong to
   the committed set.
3. **Zero-knowledge.** The claim "no record meets criterion X" is proven in a circuit without revealing the
   records. This is possible for simple packs (a sum or a comparison over committed records), but each leaf is
   still computed by the business, so the proof is only as good as the check of each leaf (the same limit as the
   sum-tree variant in `docs/source-of-funds.md`). Not before levels 1 and 2 are stable.

## Connectors
A connector turns one source into `LedgerRecord` items plus the document hashes. It does no judgement: no
filtering, no netting, no relabelling. Planned:
- An **exchange API connector** (first target: a Norwegian exchange, if its API offers read access to account
  history). The exchange itself is then the source, not a PDF and not the accounting system: the accounting
  system, or any other system, only hands over the access credential. See "Reading an exchange through its API".
  A statement-file import stays as the fallback for exchanges without a usable API.
- An **accounting-system export** (first target: the author's own system), carrying the vouchers and their
  hashes.
- **On-chain readers** (CE-23) for self-custody addresses.

## Reading an exchange through its API
Whether an exchange's API gives full, read-only account history (trades, deposits, withdrawals, staking
rewards, balances per date) is **not established here** and must be read from the exchange's own documentation
before the connector is designed. If it does, the connector reads straight from the exchange and the accounting
system is only a place where the credential is kept. Rules the connector follows:
1. **Read-only credential.** The key must be created with the narrowest permission the exchange offers, with no
   right to trade or withdraw. A key that can move funds is refused when the exchange says what a key can do.
2. **The credential is never part of the data.** It is read from a file or a secret store named in the
   configuration (for example the file the accounting system already keeps), held in memory for the pull, and
   never written to the report, the log, the repository or any message. It is not given to a verifier.
3. **The pull is recorded.** Time, endpoints, parameters, paging, and a hash of each response are stored in
   the evidence of the report, so a later run can be compared with the first. The raw responses are kept by the
   business and shown to the verifier on request.
4. **Complete paging.** Every page is read to the end; a pull that stops early (an error, a rate limit) fails
   rather than producing a shorter ledger.
5. **Balance check.** Balances at the start and end of the period are read from the exchange and checked against
   the movements (the statement chaining above), so a missing movement breaks the arithmetic.

What this does and does not give. It removes the business's own re-typing and the swap of a file after the fact:
the records come from the exchange's system in a form that can be pulled again. It does **not** let a bank trust
the records without a further step, because a pull made by the business is still reported by the business. The
ways to close that, from simplest to strongest:
- the **bank (or the auditor) repeats the pull** with a read-only key the business issues for that purpose and
  revokes afterwards, and the reports are compared;
- the **exchange signs** the response or the export (best, and a request to put to the exchange);
- a **recorded, verifiable TLS session** (an area under research; it would let a third party check that a response
  came from the exchange's server without seeing the key). Not assumed available.
Until one of these is in place the report states level 2 (see "Trust level of a source"), not level 1.

## Versioning and governance
A pack is identified by id and version; a changed rule is a new version, and a report always names the version.
Parameter files are signed by the criteria owner, so the business cannot quietly use softer numbers. Who
publishes packs and who approves new versions is the same open governance question as CE-25.

## Proposed backlog
| Item | Title | Notes |
|---|---|---|
| CE-34 | Rule API core: record format, commitment, pack interface, coverage, report | The types above; reference implementation in TypeScript with tests; reuses the tagged hashing of `src/por/` |
| CE-31 | First packs: `reporting-limit`, `unexplained` | Already in the backlog; becomes the first user of CE-34 |
| CE-35 | Exchange statement connector | Needs a sample statement (anonymised) |
| CE-36 | Accounting-system export connector | Vouchers and their hashes |
| CE-37 | Packs `aggregate-window`, `near-limit`, `counterparty-list`, `jurisdiction`, `sanctions` | After the criteria owner has said which it wants |

## Questions for the criteria owner (a bank)
1. Which criteria do you check today, and which are required by rule or by your own policy? A list of the
   criteria with their parameters is what the packs are built from.
2. Per transaction or aggregated, and over which window? Which movements count?
3. What counts as an explanation: a voucher, an auditor's approval, a source attestation? Whose?
4. Do you want the records, or only the result? Which of the three disclosure levels?
5. What evidence of completeness do you need beyond statement chaining and an account list?
6. Which sources do you accept, and at which trust level?
7. Who bears the risk if an attestation turns out to be wrong?
8. In what format should the report arrive, and who runs the verifier?
