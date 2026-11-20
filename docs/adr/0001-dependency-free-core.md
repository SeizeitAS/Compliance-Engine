# The core has no runtime dependencies; the Midnight SDK lives in `integration/`

The reference implementations in `src/` are the oracle that the circuits are cross-checked against.
A dependency in the core would put third-party code into that oracle and into every audit of it.
`src/`, `test/` and `scripts/` therefore use only Node built-ins (`CONTRIBUTING.md`, rule 3).
Work that needs the Midnight SDK (about 400 MB) lives in the separate `integration/` workspace, and nothing in the core imports from it.

**Consequences**: hashes and data formats are written by hand and tested against golden vectors.
Exceptions are recorded as ADRs (ADR 0002).
