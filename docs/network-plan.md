# Plan: verify the proofs and deploy on a real Midnight network (CE-29, CE-30)

Status: **Phase 1 (CE-29) done on the local network, 2026-11-16; Phase 2 (CE-30, Preprod) not started.** Date: 2026-11-16. Facts come from the Midnight
documentation retrieved the same day (sources at the end); items marked "to check" were not on the pages.

## Goal
1. **Verify the proofs** (CE-29): have a real Midnight node accept the transactions our circuits produce and,
   just as important, **reject** a corrupted proof and a wrong verifier key. Nothing local does this today
   (`docs/proving.md`, SR-13).
2. **Deploy and call on Preprod** (CE-30): a smoke test of both contracts on a public test network, with a
   throwaway test wallet and faucet tokens only. Nothing touches the company's funds or a mainnet wallet.

## What the documentation says (2026-11-16)
- Mainnet, Preview and Preprod all run **ledger 9**: node 2.1.101, indexer 4.4.101, proof server 9.0.0,
  **wallet SDK 2.0.0, midnight-js 5.0.0, testkit-js 5.0.0**, compact-js 3.0.0, runtime 0.21.0, toolchain 0.36.0.
  Our artefacts already match this (`docs/toolchain.md`). Ledger 8 artefacts cannot be deployed.
- midnight-js 5 and compact-js 3 are **ESM only**; the SDK needs **Node 22 or newer** (shaun3 has Node 18).
- Every transaction costs **DUST**. NIGHT alone is not enough: the wallet must register its NIGHT UTXOs for
  DUST generation (`registerNightUtxosForDustGeneration`) and wait for DUST to accrue. Fees need two or more
  DUST spends (one spend can be rejected with `OutsideTimeToDismiss`) and there is a new minimum block price.
- **Preprod** access is through **Blockfrost** and needs a project token on every request. The Midnight-hosted
  Preprod endpoints were retired on 2026-10-09 (an earlier search result still showed them: ignore it).
  Faucet: `midnight-tmnight-preprod.nethermind.dev`, 5,000 tNIGHT per request, rate limited, unshielded
  address only. Preprod moved to ledger 9 in place on 2026-11-09, so DUST registrations had to be redone.
- **Preview** needs no token (public endpoints) but was relaunched as a new chain on 2026-11-07.
- **Local network ("undeployed")**: node, indexer and proof server in Docker from the `midnight-local-dev`
  repository (`npm start`, or `docker compose -f standalone.yml up -d`). The genesis wallet is pre-funded and
  registered for DUST, there is no faucet, DUST appears in about 5 minutes. **The ledger version of the
  local images is not stated on the pages (to check in `standalone.yml`).**
- The proof server runs locally on every network because it sees private inputs.
- Known issues: `VerifierKeyRemove` is rejected by ledger 9.1.0.0 clients (relevant to the updatability
  decision in CE-25); spending a held shielded coin with `writeCoin` fails.

## Environments compared
| | Local (undeployed) | Preview | Preprod |
|---|---|---|---|
| Accounts to create | none | none | **Blockfrost project and token** |
| Wallet | pre-funded genesis (dev) wallet | throwaway test wallet | throwaway test wallet |
| Tokens | already funded | faucet | faucet (rate limited) |
| Needs a node we run | yes (Docker, shaun3) | no | no |
| Can show a node rejecting bad proofs | **yes, without side effects** | possible, not advisable | possible, not advisable |
| Closest to mainnet | no | partly | **yes** |

## Recommendation
1. **Local network first (CE-29).** It needs no external account, funds or token, and it is the only place
   where we can submit corrupted proofs repeatedly and read the node's reason. This is what closes SR-13.
2. **Then Preprod (CE-30)**, as asked: closest to mainnet and keeps the contracts on a public chain. Preview
   is the fallback if the Blockfrost account is unwanted: same flow, no token.
Preprod adds nothing for proof verification (the local node verifies the same way), so verification does not
wait for the Blockfrost decision.

## Decisions and permissions needed from you
| # | Item | Why |
|---|---|---|
| D5 | Run the local stack on **shaun3** | Docker and 11 GB RAM are there; this Windows machine has no Docker. Existing containers already use ports 6300 (proof server 8.1.0) and 9944/9933 (old node), so the new stack gets alternative host ports through a compose override and the old containers stay untouched. |
| D6 | **Downloads** | The `midnight-local-dev` repository (GitHub), its Docker images (size to be stated before pulling), npm packages (midnight-js 5.0.0, wallet SDK 2.0.0, testkit-js 5.0.0 and dependencies), and a Node 22 or newer runtime for the client scripts (install on shaun3, or run the client on this machine with Node 24 against shaun3's ports). |
| D7 | **Create a throwaway test wallet** (Preprod/Preview) | A new seed is a new identity. It would be generated locally, stored only in a git-ignored `.env.<network>` file on the host, never printed to chat or committed. It holds only test tokens. The local network uses the dev genesis wallet and needs no new wallet. |
| D8 | **Blockfrost account** (Preprod only) | You create it and the token; I do not create accounts. Free-plan limits are not stated in the docs (to check). |
| D9 | Contract **maintenance authority** at deploy | Test deploys use a throwaway signing key. The real decision belongs to CE-25. |

## Steps

### Phase 0: preparation (1 point)
- Pin exact versions (no caret or tilde): midnight-js 5.0.0, wallet SDK 2.0.0, testkit-js 5.0.0, compact-js 3.0.0.
- Add `.env.*` to `.gitignore` (done with this plan; `.env` was already ignored).
- Work in the ledger 9 copy (`~/ce-l9`) or a new `integration/` workspace, not in the core.

### Phase 1: local network, verify the proofs (CE-29, 8 points)
1. **Stack:** clone `midnight-local-dev`, read `standalone.yml`, state the image versions and sizes, and **stop if
   they are ledger 8** (then wait for a ledger 9 tag or pin one). Start with alternative host ports.
   Check `midnight_ledgerVersion`, the indexer block height and `/health` on all three services.
2. **Wallet:** use the genesis (Alice) dev wallet through testkit-js `FluentWalletBuilder`; wait for DUST
   (about 5 minutes). Use two or more DUST spends per transaction.
3. **Deploy** AML_Gate and PoR (the ledger 9 artefacts) with `deployContract`; record the addresses.
4. **Call** `prove_not_sanctioned`, `update_sanctions_root` and `publish_solvency_report` with the witnesses the
   runtime checks already use; the node accepts them. Read the state back through the indexer and compare with
   `runtime:check` (roots, receipts, reports).
5. **Negative tests at the node** (the point of the exercise):
   - **Corrupted proof:** wrap the proof provider so `prove()` flips one byte of the real proof; the wallet then
     balances and signs around it, so the only defect is the proof. The node must reject with a
     proof-verification reason.
   - **Wrong verifier key:** deploy a variant whose registered key belongs to another circuit and call it with a
     genuine proof; the node must reject.
   - **Replay:** the same PoR period twice is refused.
   If a rejection comes from anything other than proof verification (signature, binding, balance), the test is
   not counted and is reworked.
6. **Record** results, fees in DUST and timings in `docs/proving.md`; update SR-13.
- **Acceptance:** positive calls accepted by the node; both corrupted-proof and wrong-key cases rejected with
  a proof-verification reason; the state read through the indexer equals the runtime-check expectation. Only
  then is the claim "proofs verified by a Midnight node" allowed.

### Phase 2: Preprod smoke test (CE-30, 5 points)
1. **Blockfrost** project for Midnight Preprod, created by you; token in `.env.preprod` only.
2. **Wallet:** generate a throwaway mnemonic locally; show only the unshielded address (`mn_addr_preprod1...`,
   not secret). Request tNIGHT at the faucet, **to the unshielded address** (shielded and DUST addresses are
   rejected), register the NIGHT UTXOs for DUST and wait (reports say 1 to 20 minutes; a fresh wallet's first
   sync is slow).
3. **Proof server:** the ledger 9 container on shaun3 (`proof-server-l9`), never a third-party one.
4. **Deploy and call** both contracts on Preprod (positive path only; no corrupted proofs on a public chain).
   Record the addresses and transaction hashes (public) in `docs/`.
5. **Tidy up:** delete the seed file when finished, or keep it deliberately and say so.
- **Acceptance:** both contracts deployed, circuits called, state read through Blockfrost's indexer, fees
  recorded; no secret in git, logs or chat.

## Effort and order
Phase 0 (1) + Phase 1 (8) + Phase 2 (5) = 14 points, roughly one sprint. Phase 1 can start as soon as D5 and D6
are answered; Phase 2 waits for D7 and D8.

## Risks
- The `midnight-local-dev` images may still be ledger 8: then step 1 stops and we report instead of working around it.
- Port conflicts with the existing containers, and RAM: node, indexer and proof server next to the existing
  three containers on 11 GB. Check memory before starting.
- Faucet outages and rate limits (forum reports exist), slow first wallet sync, DUST accruing slowly.
- Documentation churn: some guides still describe ledger 8 packages; follow the ledger 9 upgrade page.
- Secrets: seeds and the Blockfrost token never leave the host files; they are test values but the habit
  matters for 2027.
- A node accepting our proofs shows the circuits and proving pipeline work as built. It does **not** show that
  the circuits are sound for compliance (SR-1, SR-2 still stand) or that we are ready for mainnet.

## Cleaning up
Local stack: `docker compose down` (and remove its volumes) on shaun3, delete the cloned repository and the
Node 22 install if one was added. Preprod: delete `.env.preprod`, nothing else persists.

## Phase 1 results and deviations from the plan (2026-11-16)
- **The planned repository was archived.** `midnight-local-dev` pins ledger 8 images (node 1.0.0, indexer 4.3.3,
  proof server 8.1.0) and points to `midnight-examples`, which is ledger 9 (`toolchain.json`: node 2.1.101,
  indexer 4.4.101, proof server 9.0.0, wallet SDK 2.0.0, midnight-js 5.0.0). That one was used: the owner approved starting Phase 1 and its downloads but had not
  named this repository (the archived one points to it); the archived clone was deleted.
- **Stack** (`infra/ce-local/compose.yml`): node image 1.08 GB and indexer image 321 MB, host ports 19944 and
  18088, the existing ledger 9 proof server on 6301 reused. The runtime reports spec version 2001100
  (ledger 9); `midnight_ledgerVersion` returns `1.0.1`, not a 9.x string. Memory stayed small: node 76 to
  200 MiB, indexer 35 to 95 MiB, host available memory never below 4 GB with the older containers left running.
  The proof server 8.1.0 was not stopped.
- **Client:** Node 22.23.5 in `~/node22` (tarball checksum verified) on shaun3, so the Windows PC stayed free;
  `integration/` holds about 410 MB of `node_modules`.
- **Wallet:** the local network's dev genesis wallet, funded and holding DUST at once; no new wallet was
  created (D7 does not apply locally).
- **Results:** see `docs/proving.md`. Deviation from the acceptance criteria: a wrong verifier key is refused by
  the client and the proof server before the node, so the node-level rejection is shown for a corrupted proof only.
- **D9 (maintenance authority):** test deploys used the client's default (a freshly sampled signing key); the
  real decision stays with CE-25.
- **Left running on shaun3:** the ce-local node and indexer containers (light) and `proof-server-l9`.
  Stop with `docker compose -f infra/ce-local/compose.yml down`.

## Sources (retrieved 2026-11-16)
- Networks and environments: https://docs.midnight.network/guides/networks-and-environments
- Local network: https://docs.midnight.network/guides/midnight-local-network
- Deploy a Midnight app (still on ledger 8 versions): https://docs.midnight.network/guides/deploy-mn-app
- Ledger 9 upgrade: https://docs.midnight.network/relnotes/ledger-9
- Release compatibility matrix: https://docs.midnight.network/relnotes/support-matrix
