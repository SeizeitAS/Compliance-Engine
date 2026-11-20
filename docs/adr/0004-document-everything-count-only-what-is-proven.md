---
status: accepted (owner, 2026-11-16; decision D3 in docs/reserve-side-plan.md)
---

# Document every holding; count only what is proven

Every holding appears in the report with a `counted` flag and a reason. A holding counts only if it
has a verified control proof, an independently read balance, liquidity and no encumbrance, and only
after its haircut. Assets held at an exchange, staked at an exchange, shielded, or without a verified proof
are documented and not counted. Today that covers all the company's funds, which are at NBX. The
alternative, counting third-party statements at full value, would make the attestation only as strong as the
weakest custodian.

**Open**: whether own funds may cover client liabilities at all, as opposed to segregated client
assets only, is a legal question for a MiCA adviser.
