# Licensing model (open core)

Compliance Engine is owned by Seize it AS (org. no. 911 567 598, Trondheim, Norway) and follows an
open-core model with three parts.

| Part | What it covers | Terms |
|---|---|---|
| **Open core** | Everything in this repository: the proof circuits, the TypeScript reference implementations, the rule API core, the rule packs published here, tests, tooling and documentation | Apache License 2.0 (`LICENSE`). Free to use, change and distribute, also commercially |
| **Commercial modules** | Add-on modules for regulated customers that are not in this repository, for example auditor signing workflows, bank and exchange integrations, regulatory reporting and administration tools | Seize it AS commercial license, by written agreement. Distributed separately |
| **Infrastructure service** | Proof publishing to Midnight from Seize it AS nodes, DUST sponsorship for customers who do not hold tokens, operation, monitoring, updates and support | Monthly service fee under a service agreement with Seize it AS |

## What this means in practice

- The open core stays under Apache 2.0. Code released here will not be withdrawn from that license.
  Anyone may run the open core on their own infrastructure without paying Seize it AS.
- Commercial modules are separate works. They are not committed to this repository, and nothing in
  this repository depends on them.
- When a feature is planned, the backlog item in `docs/SCRUM.md` says whether it belongs to the open
  core or to a commercial module. Open-core items stay open-core.
- The Apache 2.0 license does not grant rights to the names and marks of the project
  (Apache 2.0, section 6). See `TRADEMARKS.md`.
- Contributions are accepted under the terms in `CONTRIBUTING.md` (section "Contribution terms"),
  which let Seize it AS also offer contributed code under commercial terms.

## Third-party material

Parts of `integration/` and `infra/` are derived from Midnight Foundation examples under Apache 2.0.
They remain under that license with their original headers, see `NOTICE`.

## Contact

Commercial licenses and service agreements: Seize it AS, https://sisit.no.
