---
status: accepted (owner, 2026-11-16; decision D2 in docs/reserve-side-plan.md)
---

# Balances come from the chains; Business 20 is a cross-check, never the authority

A proof of reserves is only worth something if the auditor need not trust the operator. Business 20
Kryptoforvaltning holds the company's own books, so it records what the company believes it holds.
Self-custody balances are therefore read from the chains at a pinned height, from our own node or indexer plus
a second provider. Prices come from Assetprice as anchored prices. Business 20 provides the list of
documented holdings and a reconciliation, and nothing more.
