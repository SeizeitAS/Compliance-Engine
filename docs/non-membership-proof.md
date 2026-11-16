# Sanctions non-membership proof

## Problem
Prove that a subject is **not** on a sanctions list without revealing the subject and without
the verifier learning the list. A plain Merkle tree proves membership. Non-membership needs more.

## Scheme: sorted Merkle tree of ranges
1. Normalise each listed identifier and derive a key: the first 128 bits of
   `SHA-256("ce.sanctions.v1" || 0x00 || identifier)` (`deriveKey`).
2. Sort the keys: `k_1 < ... < k_n`. Add sentinels `0` and `2^128`.
3. Create `n + 1` leaves, one per gap: leaf `i` = `H_leaf(lo_i, hi_i)` with `lo_1 = 0`,
   `hi_{n+1} = 2^128`, otherwise adjacent keys.
4. Build a fixed-depth binary tree (depth 20, up to about one million entries). Empty positions
   use a domain-separated empty hash. Inner nodes use `H_node(left, right)`. The root is published on-chain together with a list version.
5. To prove `x` is not listed, show a leaf with `lo < x < hi` and its Merkle path.

Why it is sound: the ranges tile the whole key space, and every listed key is an endpoint of
a range. Inequalities are strict, so a listed key never lies strictly inside any range.
Why it is private: inside the circuit, `x`, `lo`, `hi` and the path are witnesses. Only the
root, version and an opaque receipt are public.

## Files
- `src/sanctions/indexedMerkleTree.ts`: reference implementation, used as test oracle.
- `test/nonMembership.test.ts`: positive, negative, forged-proof, tamper and randomised tests.
- `contracts/AML_Gate.compact`: the circuit. **Draft, not compiled.**

## Security notes and limits
- **Key truncation.** 128-bit keys give about 2^-128 chance of an accidental collision with a listed key, and finding an unlisted identity that collides with a listed one costs about 2^128 work. Acceptable for screening; revisit if an adversary can choose identifiers freely and a second-preimage of 2^128 is not enough for your risk model.
- **Normalisation is the weak point.** The proof shows an exact key is absent. Fuzzy matching (spelling variants, transliteration, aliases) is out of scope for the cryptography and must be handled by canonicalisation and by listing alias keys. Documented in CE-7.
- **List governance.** `update_sanctions_root` is guarded by a single admin hash. Production needs multi-party control and publication of the source list hash.
- **Freshness.** A receipt is bound to a list version; verifiers must reject receipts from versions older than their policy allows.
- **Hash agreement.** The TypeScript SHA-256 hashing and the circuit's `persistentHash` are different functions today. The TS code is the algorithm oracle; a circuit-compatible hash must be added before cross-testing real proofs (CE-5).
- **Not legal advice.** A passing proof is evidence for a documented screening step, not a determination of compliance.

## Run the tests
```
npm test
```
