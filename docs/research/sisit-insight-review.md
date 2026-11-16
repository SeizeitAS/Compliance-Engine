# Review of sisit.no/innsikt: candidate additions

**Date:** 2026-11-16. **Status: PARTIAL.** The working environment could not open `sisit.no`
(host blocked by the session network policy), so the archive index was never read. This review
is based only on search-engine summaries of four pages. It must be redone once the host is allowed (backlog CE-13).
Statements about external regulation below come from general knowledge, not from the articles,
and are marked **verify**.

## What was actually seen
| Page | Relevance to this project |
|---|---|
| `sisit.no/innsikt/nis2-digitalsikkerhetsloven-zero-knowledge.html` | NIS2 / digitalsikkerhetsloven: prove security compliance with local ZK proofs instead of uploading logs. A pilot ZK security-reporting module on Midnight is mentioned. Candidate module CE-12. |
| `sisit.no/innsikt/gigokonomi.html` (2026-05-25) | Portable verifiable identity (reputation, work hours, tax obligations) and proving tax compliance without exposing identity. Reuses the same selective-disclosure pattern as the AML gate. |
| `sisit.no` (home) | Midnight node operation, ZK consulting, Transparency Act (Apenhetsloven) compliance. |
| `sisit.no/english/` | "MiCA-Ready Infrastructure Hub", industrial Cardano/Midnight node, the Business 2.0 platform. |

None of these mentioned eIDAS, the EU Digital Identity Wallet, a business wallet, or a
"Midnight passport". Those topics are therefore **not yet covered by any article I could read**.

## Recommended additions
| Element | Why it belongs | Action | Backlog |
|---|---|---|---|
| **eIDAS 2.0 / EUDI Wallet** (Regulation (EU) 2024/1183) | The blueprint's flow starts with a customer presenting an attested ID ("EUDI WS"). Wallets are the natural credential source for the AML gate, and selective disclosure is the core design principle. **Verify:** member-state wallet deadline (around end of 2026), the Architecture Reference Framework, credential formats (SD-JWT VC, ISO mdoc), and when and how eIDAS 2.0 applies in Norway via the EEA agreement. | Define a credential-intake interface and a mapping from wallet attributes to circuit inputs. Check whether wallet attestations can be verified in-circuit or only off-circuit with a signed attestation. | CE-9 |
| **Business wallet / virksomhetslommebok** | Legal entities need KYB, not only KYC: registration, authorised signatories, beneficial owners. **Verify:** status of the Norwegian business-wallet initiative (Bronnoysundregistrene / Digdir) and of the European Business Wallet proposal. | Spike: collect requirements, credential types and trust model; extend the gate with an entity-level circuit (for example "authorised signatory of a registered entity not on a list"). | CE-10 |
| **Midnight passport** | Unknown. No public description found; may be a Midnight-ecosystem identity concept or an internal idea. | Ask the Product Owner for a definition and source before designing anything. | CE-11 |
| **NIS2 / digitalsikkerhetsloven reporting** | Explicit planned pilot in the article; shares ZK tooling. | Keep as a separate module after the AML gate is production quality. | CE-12 |
| **Apenhetsloven (Transparency Act)** | Listed as a Sisit service line; supply-chain due-diligence evidence could be anchored the same way as screening receipts. | Requirements spike only. | CE-12 |
| **Tax proof (gig economy)** | Pairs with the Assetprice NOK valuations and the Skatteetaten angle already in the blueprint. | Fold into the Assetprice integration design. | CE-8 |

## Cross-cutting notes
- Every added credential flow must keep the rule from the blueprint: no personal data on a public ledger; receipts and roots only.
- Each new element needs an entry in the regulatory traceability matrix, citing the primary legal text rather than a blog summary.
- Redo this review from the full archive before committing CE-9 to CE-12 to a sprint.
