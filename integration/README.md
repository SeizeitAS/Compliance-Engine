# integration: the circuits against a real Midnight node (CE-29)

Separate from the core on purpose: the core (`src/`, `test/`, `scripts/`) has no dependencies, while this
workspace needs the Midnight SDK (about 400 MB of `node_modules`). Nothing in the core imports from here.

## What it does
`scripts/chain-check.ts` deploys `AML_Gate` and `PoR` to a real node, calls their circuits through the
normal midnight-js path (local circuit execution, proof server, wallet balancing with DUST, node
submission), reads the state back through the indexer, and then tries to get the node to accept a
corrupted proof. Results and limits are in `docs/proving.md`; the plan and background in `docs/network-plan.md`.

## Prerequisites (ledger 9)
- **Node 22 or newer** (the SDK needs it; the compiler host's system Node is 18, a user-directory Node 22
  is at `~/node22`).
- The **local network**: `infra/ce-local/compose.yml` (node 2.1.101 and indexer 4.4.101 from the pins in
  midnight-examples `toolchain.json`) on alternative ports 19944 and 18088, and a **ledger 9 proof server**
  (`midnightntwrk/proof-server:9.0.0`) on 6301.
  ```
  docker compose -f infra/ce-local/compose.yml up -d --wait
  docker run -d --name proof-server-l9 -p 127.0.0.1:6301:6300 midnightntwrk/proof-server:9.0.0
  ```
- The **ledger 9 artefacts** from `COMPACT_VERSION=0.36.0 OUT_DIR=managed-l9 npm run contracts:compile`,
  copied to `integration/managed/` (or point `CE_MANAGED_DIR` at them).

## Run
```
cd integration
npm install                  # exact versions are pinned in package.json
npm run wait:dust            # optional: the dev wallet is funded and has DUST at once
npm run chain:check          # CHECK_STAGES=por,aml,neg (default: all); about 6 minutes, the AML proof dominates
```
Environment: `MIDNIGHT_PROOF_SERVER` (default `http://127.0.0.1:6301`), `CE_MANAGED_DIR`, `CE_NODE_CONTAINER`
(the node container whose log is read for the rejection reason, default `ce-local-node-1`), `DUST_COINS`
(spendable DUST coins to wait for, default 2: one spend can be rejected on ledger 9).

## Safety
- The wallet is the local network's **dev genesis wallet** (the well-known seed `00...01`). It exists only
  on the `undeployed` network and holds no real value. **Never use this seed or this script's defaults on a
  public network.** Preview and Preprod need a throwaway wallet whose seed goes in a git-ignored
  `.env.<network>` file (`docs/network-plan.md`, CE-30), never in code, git, logs or chat.
- The negative tests only make sense on the local network and are not to be run on a public chain.

## Provenance
`src/wallet.ts`, `src/providers.ts`, `src/config.ts` and `scripts/wait-for-dust.ts` are derived from the
example template in github.com/midnightntwrk/midnight-examples (Apache-2.0), with the template's
preprocessor markers resolved to the monorepo variant, ports changed, and the contract-specific parts
removed. Their license headers are kept. `scripts/chain-check.ts` is ours.

## Preprod (CE-30, run on 2026-11-19)
Positive path only. Needs a throwaway test wallet and a Blockfrost Preprod token in the git-ignored
`.env.preprod` at the repository root (variables in `docs/network-plan.md`). Never put a seed or a token in chat,
logs or git.
```
ADDRESS_ONLY=1 MIDNIGHT_NETWORK=preprod npm run chain:check   # prints the public address for the faucet, exits
MIDNIGHT_NETWORK=preprod npm run chain:check                  # syncs (first time over an hour), waits for tNIGHT and DUST, deploys and calls
```
The stage with corrupted proofs refuses to run on a public chain. The Blockfrost token is redacted in output.

**Saved wallet state.** The first sync of a public network takes hours (several hours for Assetprice on the same
host). The sync saves a snapshot to the git-ignored `integration/.wallet-state/` (mode 600, one file per network and
seed) every 10 minutes and once more when the sync is complete. A new run restores the last snapshot and syncs only
the gap; if restoring fails it logs a warning and syncs from genesis. Before 2026-11-19 the state was saved only
after a complete sync, so a run that stopped half-way lost all progress. The snapshot was not available during the first
Preprod run (2026-11-19) and is not tested yet against a restore from a partial sync. `MIDNIGHT_WALLET_STATE=off` turns saving off. The directory holds wallet state
derived from the seed: treat it like the seed and never commit or share it.

## Shared with Assetprice (from 2026-11-17)
The local stack on shaun3 is also used by the Assetprice publisher. It links to this workspace's
`node_modules` and uses the same genesis wallet (ALICE). So: do not change or delete the installed packages
or `src/{wallet,providers,config}.ts` without telling the Assetprice side, and do not run `npm run chain:check`
while it is publishing (UTXO conflict). Details in `docs/network-plan.md`.

## Cleaning up
**Do not run these on shaun3 while Assetprice depends on the stack** (see above); agree it first.
```
docker compose -f infra/ce-local/compose.yml down -v     # the local chain starts empty again next time
docker rm -f proof-server-l9                              # only if nothing else uses it
rm -rf integration/node_modules integration/managed integration/midnight-level-db
```
