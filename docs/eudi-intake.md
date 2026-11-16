# EUDI credential intake (CE-9)

## Goal
The sanctions gate (`docs/non-membership-proof.md`) proves a *key* is not listed. This work
makes the key come from an **issuer-signed credential** (an EUDI PID or similar) instead of a
value the prover merely claims, so a screening result is tied to a real, verified identity.

## What is implemented and tested (`src/eudi/sdJwtVc.ts`, `test/sdJwtVc.test.ts`)
Reference verifier for SD-JWT VC presentations (IETF SD-JWT, profile ES256 / P-256 / SHA-256):

1. Issuer JWT: `alg` must be exactly `ES256` (so `none`, HS* and other curves are rejected),
   `typ` `dc+sd-jwt` or `vc+sd-jwt`, signature in raw `r||s` form, issuer found in the trusted list
   and the list entry valid now, `exp` required and enforced, `nbf` and `iat` checked, 60 s skew.
2. Disclosures: each must be `[salt, name, value]`, unique, and its SHA-256 digest must appear in
   the signed `_sd` array. Unreferenced, duplicate, name-colliding and array-element disclosures
   are rejected.
3. `vct` must be on an allow-list and the configured identifier claim must be disclosed.
4. Holder binding (default required): a `kb+jwt` signed by the credential's `cnf` key, with our
   audience and a fresh nonce, a recent `iat`, and `sd_hash` over exactly the presented disclosures.
5. The identifier is normalised (NFKC, whitespace and hyphens removed, upper-case), prefixed with a
   scheme (for example `NO:fnr`) and turned into the sanctions-tree key with `deriveKey`.

The end-to-end test shows a credential becoming a key, an unlisted holder getting a valid
non-membership proof, and a listed holder being unable to get one. Mutation checks (signature
always valid, no `sd_hash` check, no digest-membership check) each make tests fail.

## Where this runs, and what it protects
The verifier runs **at the screening party** (a CASP, bank or accountant) which already holds the
customer's data under its own KYC duties. What the design protects is the *counterparty and the
public ledger*: they receive a proof and an opaque receipt, never the identifier or credential.

## Target: in-circuit verification (not implemented, blocked on CE-5)
Today the TypeScript verifier is trusted by whoever runs it. To let a *third party* trust the result
without seeing the credential, the circuit should verify the same statements as private witnesses:

| Public inputs | Private witnesses |
|---|---|
| sanctions root and list version; issuer-registry root; allowed `vct` hash; verifier audience hash and nonce | issuer JWT header and payload; issuer signature; disclosures; issuer public key and its registry path; holder key, key-binding JWT and signature; sanctions range and path |

Checks, mirroring the TypeScript order: ES256 verify of the issuer signature over the signing input;
issuer key is a leaf of the issuer registry (the Digdir trust list or the planned Passport v2 issuer
registry); `exp` against a block-time bound; disclosure digest is in `_sd`; the identifier claim hashes to the
subject key; key-binding signature by the `cnf` key with the expected nonce; then the existing range
non-membership proof. Open questions: availability and cost of in-circuit SHA-256 and P-256 on the
current toolchain (ledger 9 articles mention P-256 verification since toolchain 0.35: **verify**),
how a circuit reads a trustworthy time, and the circuit size of base64url JSON parsing (likely
needs the claim positions as witnesses with fixed-size windows).

## Known gaps
- **mdoc (ISO 18013-5):** not supported; needs CBOR/COSE and the mobile security object.
- **Revocation:** no status-list check. A revoked credential still verifies until it expires.
- **Issuer trust:** a static list; no x5c chain validation, no live Digdir trust-list sync.
- **Algorithms:** ES256 only; ES384/ES512 and EdDSA are rejected.
- **Nested and array disclosures:** rejected, not ignored.
- **What gets screened:** sanctions lists mostly name people; matching a *national ID* key only works
  if the list data is mapped to the same identifier scheme. Name and alias matching remains outside
  the cryptography (see CE-7).
- **Unlinkability:** SD-JWT presentations are linkable if the same issuer JWT is reused; batch
  issuance is an issuer-side matter. The in-circuit variant avoids revealing the JWT at all.
- **Real wallets:** untested against the Digdir sandbox issuer ("Bevisporten"); tests use synthetic keys.
