# Execution and proving of the circuits

Two scripts exercise the compiled contracts beyond hash cross-checks. Neither submits anything to a
chain; there is no wallet, deployment or transaction in this repository yet.

## `npm run runtime:check` (no proof server)
Runs the compiled contracts in the Midnight runtime, in memory (`scripts/runtime-check.mjs`):
valid inputs are accepted, invalid ones are rejected with the expected assertion, and ledger state
(roots, receipts, reports, versions) changes as designed. 22 checks:
- AML_Gate: unlisted key accepted and receipt recorded; listed key, range end, out-of-range key, forged
  range, zero key and foreign root rejected; admin-only root update; old root fails after the update.
- PoR: solvent report stored; duplicate period, reserves below total, zero reserves and wrong admin
  rejected; the attestation is bound in-circuit; an understated branch yields a different root.

## `npm run prove` (needs a proof server)
For each proving circuit (`prove_not_sanctioned`, `publish_solvency_report`) the script builds the proof
preimage in the runtime, asks the server to `/check` the witness, then `/prove`s it (`scripts/prove.mjs`).
Result on 2026-11-16 against proof server **8.1.0** (ledger 8) with compiler 0.31.0 outputs:

| Circuit | /check | /prove |
|---|---|---|
| `AML_Gate.prove_not_sanctioned` | accepted | 4508 bytes, 40 to 87 s on a 4-core host (first call loads keys) |
| `PoR.publish_solvency_report` | accepted | 4508 bytes, 3 to 7 s |

Ledger 9 (compiler 0.36.0, compact-runtime 0.21.0, proof server **9.0.0**, same day):

| Circuit | /check | /prove |
|---|---|---|
| `AML_Gate.prove_not_sanctioned` | accepted | 5420 bytes, 112 s |
| `PoR.publish_solvency_report` | accepted | 5420 bytes, 5 s |

Setup for ledger 9 is in `docs/toolchain.md` ("Ledger 9 migration"); run with `LEDGER=9` and the
ledger 9 proof server URL.

`update_sanctions_root` is a proving circuit too and has been exercised only in `runtime:check`.

Setup on the compiler host:
```
npm install --no-save @midnight-ntwrk/compact-runtime@0.16.0 @midnightntwrk/ledger-v8@8.1.3
PROOF_SERVER=http://localhost:6300 npm run prove
```
The packages must match the ledger version of the compiler output and the proof server (see
`docs/toolchain.md`, "Ledger target"). Installing both in one command matters: a later
`npm install --no-save` removes packages added by an earlier one.

## `npm run ledger:check` (proof server, in-memory ledger)
Builds real deploy and call transactions for both proving circuits, has the proof server prove them, and
applies them to a blank in-memory ledger state (`scripts/ledger-check.mjs`; `LEDGER=9
PROOF_SERVER=http://localhost:6301` or ledger 8 with port 6300). It shows that:
- the call transaction assembles from the runtime's proof data and the proof server proves it (5420 byte
  proof on ledger 9, 4508 on ledger 8);
- `wellFormed` and `apply` accept it, which replays the circuit's public transcript against the on-chain
  state, and for PoR a replay of the same call is refused (the duplicate-period guard works at ledger level).

**It does not verify the proofs, and neither does the ledger library it uses.** Controls on 2026-11-16, on
both ledger 8 and 9, with contract proof checking switched on: a transaction with half its bytes zeroed was
accepted, an unproven transaction was accepted, and a genuine proof under another circuit's verifier key
was accepted. So the wasm `wellFormed` does not check contract proofs (the script prints this as a NOTE
and will say so if a later version starts rejecting them). A first version of this check claimed "proof
verified"; those claims were withdrawn once the controls were run.

## What is still not verified
- The generated proofs were **not verified.** The in-memory ledger does not check contract proofs (above) and the proof
  server only checks witnesses and produces proofs. Real verification happens in a Midnight node: it needs a
  node, an indexer and a funded wallet for fees. A local dev network or Preprod with a faucet test wallet are
  the routes (CE-29); the ledger 8 dev node on the compiler host has no indexer and is too old for ledger 9.
- No transaction: nothing was deployed or submitted; wallet, DUST fees and indexer are untouched.
- Public networks run ledger 9, and the ledger 9 build is proved as shown above. Neither build has been
  deployed or submitted to a network.
- `/check` and `/prove` accept only witnesses that satisfy the circuit, so a rejected witness never
  reaches the prover; the negative cases are covered by `runtime:check`, not by the server.
