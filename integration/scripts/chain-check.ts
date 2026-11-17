// Deploys both contracts to a REAL Midnight node (the local ledger 9 network by default), calls their
// circuits through the normal midnight-js path (local circuit execution, proof server, wallet balancing
// with DUST, node submission) and reads the state back through the indexer. Then it tries to get the
// node to accept things it must refuse. A node verifies zero-knowledge proofs; the in-memory ledger
// used by scripts/ledger-check.mjs does not (docs/proving.md).
//
//   cd integration && npm run chain:check           (stages: CHECK_STAGES=por,aml,neg, default all)
//   MIDNIGHT_NETWORK=preprod npm run chain:check    (positive path only; needs .env.preprod, see docs/network-plan.md)
//
// Negative tests (stage "neg"), on the PoR contract because proving it is fast:
//  - corrupted proof: a small proxy in front of the proof server flips one byte of the proof it
//    returns, so the wallet balances, signs and submits a transaction whose ONLY defect is the proof;
//  - wrong verifier key: a contract is deployed with another circuit's verifier key (the client's
//    artefact-integrity check is satisfied by editing the compiled hash in a COPY of the artefacts), then
//    called with the genuine ones. This is refused before the node by the client and the proof server,
//    which the script records; it is not a node test.
// A node rejection counts only if the same call succeeds without the defect (control) and the node's own
// log gives a proof-verification reason ("failed to verify proof: Invalid proof"), because the client
// redacts the provider's message. Nothing here touches real funds: the local dev wallet only.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import pino from 'pino';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { attestation as expectedAttestation } from '../../src/por/reserves.ts';
import { getConfig } from '../src/config.js';
import { MidnightWalletProvider, resolveWallet, syncWallet, waitForDust, waitForNightThenDust } from '../src/wallet.js';
import { buildProviders, ledgerState } from '../src/providers.js';

// @ts-expect-error WebSocket global assignment for apollo (GraphQL subscriptions in Node)
globalThis.WebSocket = WebSocket;

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn', transport: { target: 'pino-pretty' } });
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const managed = process.env['CE_MANAGED_DIR'] ?? resolve(root, 'managed');
// Network selection. Default is the local ce-local stack. For a remote network (preprod, preview) the wallet
// seed and the Blockfrost token come from the git-ignored repo-root .env.<network>; nothing from it is printed.
const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const remote = network !== 'local';
if (remote) {
  try {
    for (const line of readFileSync(resolve(root, '..', `.env.${network}`), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#') && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {
    /* no file: the variables may be exported in the shell instead */
  }
}
const redact = (s: string) => s.replace(/project_id=[^&\s"']+/g, 'project_id=***');
const stages = (process.env['CHECK_STAGES'] ?? (remote ? 'por,aml' : 'por,aml,neg')).split(',');
if (remote && stages.includes('neg')) {
  throw new Error('The negative stage (corrupted proofs) is only for the local network, never for a public chain.');
}
const ALICE_SEED = '0000000000000000000000000000000000000000000000000000000000000001'; // local dev genesis wallet

const vectors = (name: string) => JSON.parse(readFileSync(resolve(root, '../test/vectors', name), 'utf8'));
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const pad32 = (t: string) => Buffer.concat([Buffer.from(t, 'ascii'), Buffer.alloc(32 - t.length)]);
const adminCommitment = (tag: string, secret: Uint8Array) =>
  Uint8Array.from(createHash('sha256').update(pad32(tag)).update(secret).digest());

let failures = 0;
const ok = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `\n   ${detail}`}`);
};
const note = (text: string) => console.log(`NOTE  ${text}`);
const errText = (e: unknown): string => {
  const parts: string[] = [];
  for (let x: any = e, i = 0; x && i < 4; x = x.cause, i++) parts.push(redact(String(x?.message ?? x).split('\n')[0]!.slice(0, 900)));
  return parts.join(' | ');
};

/**
 * The node's own reason for refusing a transaction. The client redacts the provider's message, so the
 * node log is the evidence: "failed to verify proof: Invalid proof" / Malformed(InvalidProof) means the
 * proof verifier rejected it, as opposed to a signature, binding or balance problem. Needs docker access
 * to the node container (CE_NODE_CONTAINER, default ce-local-node-1); returns undefined without it.
 */
const NODE_CONTAINER = process.env['CE_NODE_CONTAINER'] ?? 'ce-local-node-1';
const invalidProofLogLines = (sinceMs: number): string[] | undefined => {
  const r = spawnSync('docker', ['logs', '--since', new Date(sinceMs).toISOString(), NODE_CONTAINER], { encoding: 'utf8' });
  if (r.status !== 0) return undefined;
  return `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /failed to verify proof|Malformed\(InvalidProof\)/.test(l));
};
const expectProofRejectionInNodeLog = (label: string, sinceMs: number) => {
  const lines = invalidProofLogLines(sinceMs);
  if (lines === undefined) {
    note(`${label}: node log not readable (docker access to ${NODE_CONTAINER}); the rejection reason is unconfirmed.`);
    return;
  }
  ok(`${label}: the node's log gives a proof-verification reason ("failed to verify proof: Invalid proof")`, lines.length > 0, 'no such line in the node log: the rejection came from something else');
  if (lines[0]) console.log(`        node log: ${lines[0].trim().slice(0, 200)}`);
};

// ---- proof-server proxy with an optional one-byte corruption of /prove responses -------------------
const config = getConfig();
let corruptNext = false;
let corrupted = 0;
const proxy = http.createServer(async (req, res) => {
  try {
    const body: Buffer[] = [];
    for await (const c of req) body.push(c as Buffer);
    const upstream = await fetch(config.proofServer + (req.url ?? '/'), {
      method: req.method,
      headers: { 'content-type': req.headers['content-type'] ?? 'application/octet-stream' },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(body),
    });
    const out = Buffer.from(await upstream.arrayBuffer());
    if (corruptNext && upstream.ok && (req.url ?? '').startsWith('/prove')) {
      out[Math.floor(out.length / 2)] ^= 0x01;
      corruptNext = false;
      corrupted++;
    }
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' });
    res.end(out);
  } catch (e) {
    console.error(`proxy error on ${req.method} ${req.url}:`, e);
    res.writeHead(502);
    res.end(String(e));
  }
});
await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
const proxyPort = (proxy.address() as { port: number }).port;
const cfg = { ...config, proofServer: `http://127.0.0.1:${proxyPort}` };

// ---- wallet ----------------------------------------------------------------------------------------
setNetworkId(config.networkId);
const envConfig = { walletNetworkId: config.networkId, ...cfg } as EnvironmentConfiguration;
const secret = remote ? resolveWallet(network, 'ALICE').secret : ({ kind: 'seed', value: ALICE_SEED } as const);
const wallet = await MidnightWalletProvider.build(logger, envConfig, secret);
await wallet.start();
if (remote) console.log(`unshielded address (public, for the faucet): ${String(wallet.unshieldedKeystore.getBech32Address())}`);
if (process.env['ADDRESS_ONLY'] === '1') {
  await wallet.stop().catch(() => undefined);
  proxy.close();
  process.exit(0);
}
const cleanup = async () => {
  await wallet.stop().catch(() => undefined);
  proxy.close();
};
process.on('SIGINT', () => void cleanup().then(() => process.exit(130)));

try {
  console.log(`network ${config.networkId}, node ${redact(config.node)}, proof server ${config.proofServer} (via proxy :${proxyPort})`);
  // A first sync of a public network can take over an hour; the local one takes seconds.
  await syncWallet(logger, wallet.wallet, remote ? 7_200_000 : 600_000);
  if (remote) await waitForNightThenDust(logger, wallet.wallet, wallet.unshieldedKeystore, envConfig, config.faucet);
  else await waitForDust(logger, wallet.wallet, Number(process.env['DUST_COINS'] ?? 2), 600_000, config.indexer);
  console.log('wallet synced, DUST available');

  const load = async (name: string) => import(pathToFileURL(join(managed, name, 'contract', 'index.js')).href);
  const dirOf = (name: string) => join(managed, name);
  const providersFor = (dir: string, store: string) =>
    buildProviders(wallet, dir, cfg, { dbName: 'midnight-level-db', storeName: store, password: 'Ce-Integration-Test-Pw1!' });
  const stateOf = async (providers: any, address: string, ledger: (s: any) => any) =>
    ledger(ledgerState(await providers.publicDataProvider.queryContractState(address)));
  const compile = (name: string, Contract: any, witnesses: any, dir: string) =>
    (CompiledContract.make(name, Contract) as any).pipe(
      (CompiledContract as any).withWitnesses(witnesses),
      (CompiledContract as any).withCompiledFileAssets(dir),
    );

  // ---- PoR -----------------------------------------------------------------------------------------
  const por = await load('PoR');
  const pv = vectors('por-vectors.json');
  const porAdminSecret = Buffer.alloc(32, 5);
  const node = (n: { hash: string; sum: string }) => ({ hash: bytes(n.hash), sum: BigInt(n.sum) });
  // Private state is kept JSON-safe (strings), the witnesses convert.
  const porState = {
    left: pv.tree.rootChildren.left, right: pv.tree.rootChildren.right, adminSecret: hex(porAdminSecret),
  };
  const porWitnesses = {
    wit_root_left: ({ privateState: p }: any) => [p, node(p.left)],
    wit_root_right: ({ privateState: p }: any) => [p, node(p.right)],
    wit_admin_secret: ({ privateState: p }: any) => [p, bytes(p.adminSecret)],
  };
  const total = BigInt(pv.tree.root.sum);
  const reservePackage = bytes('ab'.repeat(32));
  const porArgs = [adminCommitment('ce.por.admin.v1', porAdminSecret)];
  let porProviders: any;
  let porCompiled: any;
  let porAddress = '';

  if (stages.includes('por') || stages.includes('neg')) {
    console.log('-- PoR');
    porProviders = providersFor(dirOf('PoR'), 'por-1');
    porCompiled = compile('PoR', por.Contract, porWitnesses, dirOf('PoR'));
    const t0 = Date.now();
    const deployed = await deployContract(porProviders, { compiledContract: porCompiled, privateStateId: 'por-1', initialPrivateState: porState, args: porArgs } as any);
    porAddress = (deployed as any).deployTxData.public.contractAddress;
    ok(`PoR: deployed at ${porAddress.slice(0, 12)}... (${((Date.now() - t0) / 1000).toFixed(0)} s)`, porAddress.length > 0);
    const l0 = await stateOf(porProviders, porAddress, por.ledger);
    ok('PoR: indexer shows the initial state (no reports, admin commitment stored)', l0.reports.isEmpty() && hex(l0.admin_commitment) === hex(porArgs[0]!));

    const t1 = Date.now();
    await submitCallTx(porProviders, { compiledContract: porCompiled, contractAddress: porAddress, privateStateId: 'por-1', circuitId: 'publish_solvency_report', args: [202611n, total, reservePackage] } as any);
    const l1 = await stateOf(porProviders, porAddress, por.ledger);
    const rep = l1.reports.lookup(202611n);
    ok(`PoR: publish_solvency_report accepted by the node (${((Date.now() - t1) / 1000).toFixed(0)} s)`, rep.total_liabilities === total && hex(rep.liabilities_root) === pv.tree.root.hash, 'state read back through the indexer does not match the expected report');
    ok('PoR: the on-chain attestation equals the one computed by src/por/reserves.ts', hex(rep.attestation) === expectedAttestation(202611n, pv.tree.root.hash, total, hex(reservePackage)), `on chain ${hex(rep.attestation)}`);
  }

  // ---- AML_Gate ------------------------------------------------------------------------------------
  if (stages.includes('aml')) {
    console.log('-- AML_Gate');
    const aml = await load('AML_Gate');
    const m = vectors('nonmembership-vectors.json').nonMember;
    const amlAdminSecret = Buffer.alloc(32, 7);
    const amlState = {
      key: m.key, lo: m.lo, hi: m.hi, siblings: m.siblings, isRight: m.isRight,
      nonce: hex(Buffer.alloc(32, 9)), adminSecret: hex(amlAdminSecret),
    };
    const amlWitnesses = {
      wit_subject_key: ({ privateState: p }: any) => [p, BigInt(p.key)],
      wit_range_lo: ({ privateState: p }: any) => [p, BigInt(p.lo)],
      wit_range_hi: ({ privateState: p }: any) => [p, BigInt(p.hi)],
      wit_path_siblings: ({ privateState: p }: any) => [p, p.siblings.map(bytes)],
      wit_path_is_right: ({ privateState: p }: any) => [p, p.isRight],
      wit_receipt_nonce: ({ privateState: p }: any) => [p, bytes(p.nonce)],
      wit_admin_secret: ({ privateState: p }: any) => [p, bytes(p.adminSecret)],
    };
    const providers = providersFor(dirOf('AML_Gate'), 'aml-1');
    const compiled = compile('AML_Gate', aml.Contract, amlWitnesses, dirOf('AML_Gate'));
    const args = [bytes(m.root), adminCommitment('ce.admin.v1', amlAdminSecret)];
    const deployed = await deployContract(providers, { compiledContract: compiled, privateStateId: 'aml-1', initialPrivateState: amlState, args } as any);
    const address = (deployed as any).deployTxData.public.contractAddress;
    ok(`AML: deployed at ${address.slice(0, 12)}...`, address.length > 0);
    const l0 = await stateOf(providers, address, aml.ledger);
    ok('AML: indexer shows the initial root and list version 1', hex(l0.sanctions_root) === m.root && l0.list_version === 1n);

    const t1 = Date.now();
    await submitCallTx(providers, { compiledContract: compiled, contractAddress: address, privateStateId: 'aml-1', circuitId: 'prove_not_sanctioned', args: [] } as any);
    const l1 = await stateOf(providers, address, aml.ledger);
    ok(`AML: prove_not_sanctioned accepted by the node, receipt recorded (${((Date.now() - t1) / 1000).toFixed(0)} s)`, l1.receipts.size() === 1n);

    const newRoot = bytes('22'.repeat(32));
    await submitCallTx(providers, { compiledContract: compiled, contractAddress: address, privateStateId: 'aml-1', circuitId: 'update_sanctions_root', args: [newRoot] } as any);
    const l2 = await stateOf(providers, address, aml.ledger);
    ok('AML: update_sanctions_root accepted, root changed and version is 2', hex(l2.sanctions_root) === '22'.repeat(32) && l2.list_version === 2n);
  }

  // ---- negative tests at the node ------------------------------------------------------------------
  if (stages.includes('neg')) {
    console.log('-- negative tests at the node (PoR)');
    const call = (period: bigint, providers = porProviders, compiled = porCompiled, address = porAddress, sid = 'por-1') =>
      submitCallTx(providers, { compiledContract: compiled, contractAddress: address, privateStateId: sid, circuitId: 'publish_solvency_report', args: [period, total, reservePackage] } as any);

    // 1. corrupted proof
    const tCorrupt = Date.now() - 2000;
    corruptNext = true;
    let corruptedMsg = '';
    try {
      await call(202612n);
    } catch (e) {
      corruptedMsg = errText(e);
    }
    ok('PoR: a call whose proof has one flipped byte is rejected', corrupted === 1 && corruptedMsg !== '', corrupted !== 1 ? 'the proxy did not corrupt a proof, so nothing was tested' : 'the node accepted a corrupted proof');
    if (corruptedMsg) console.log(`        client error: ${corruptedMsg}`);
    expectProofRejectionInNodeLog('PoR: corrupted proof', tCorrupt);
    corruptNext = false;
    await call(202613n);
    const lc = await stateOf(porProviders, porAddress, por.ledger);
    ok('PoR: control: the same call without corruption is accepted', lc.reports.member(202613n));
    ok('PoR: the corrupted call left no report behind', !lc.reports.member(202612n));

    // 2. wrong verifier key. The client library compares each artefact's verifier key with the hash the
    // compiled contract carries (`expectedVk`) and refuses a mismatch, so a plain swap never reaches the
    // node. To test the NODE, a copy of the artefacts gets AML_Gate's verifier key AND the matching
    // `expectedVk` hash: the client then agrees with itself and deploys the wrong key. The prover key and
    // circuit stay PoR's, so the proofs are genuine for the real circuit and wrong only for the registered key.
    const wrongDir = mkdtempSync(join(root, '.tmp-wrongvk-'));
    try {
      cpSync(dirOf('PoR'), wrongDir, { recursive: true });
      const vkFile = join(wrongDir, 'keys', 'publish_solvency_report.verifier');
      const oldHash = createHash('sha256').update(readFileSync(vkFile)).digest('hex');
      const amlVk = readFileSync(join(dirOf('AML_Gate'), 'keys', 'prove_not_sanctioned.verifier'));
      writeFileSync(vkFile, amlVk);
      const newHash = createHash('sha256').update(amlVk).digest('hex');
      const indexFile = join(wrongDir, 'contract', 'index.js');
      const src = readFileSync(indexFile, 'utf8');
      if (!src.includes(oldHash)) throw new Error('could not find expectedVk hash in the copied contract');
      writeFileSync(indexFile, src.split(oldHash).join(newHash));
      const manifestFile = join(wrongDir, 'compiler', 'contract-manifest.json');
      writeFileSync(manifestFile, readFileSync(manifestFile, 'utf8').split(oldHash).join(newHash));
      const wrong = await import(pathToFileURL(indexFile).href);
      const wrongProviders = providersFor(wrongDir, 'por-wrongvk');
      const wrongCompiled = compile('PoR', wrong.Contract, porWitnesses, wrongDir);
      const dep = await deployContract(wrongProviders, { compiledContract: wrongCompiled, privateStateId: 'por-wrongvk', initialPrivateState: porState, args: porArgs } as any);
      const wrongAddress = (dep as any).deployTxData.public.contractAddress;
      ok(`PoR: a contract with the wrong verifier key was deployed (${wrongAddress.slice(0, 12)}...)`, wrongAddress.length > 0);
      let msg = '';
      const tWrong = Date.now() - 2000;
      // The call uses the GENUINE artefacts: the proof server then verifies its proof against the right key
      // and hands it over. (Given the wrong key it refuses to prove at all, HTTP 400, so the node is never
      // reached; an earlier run of this script showed that.) The contract on chain still holds the wrong key.
      const genuineProviders = providersFor(dirOf('PoR'), 'por-wrongvk');
      try {
        await call(202611n, genuineProviders, porCompiled, wrongAddress, 'por-wrongvk');
      } catch (e) {
        msg = errText(e);
      }
      void tWrong;
      ok('PoR: a call against a contract whose on-chain verifier key is wrong is refused', msg !== '', 'the call went through');
      ok('PoR: ...by the CLIENT, which sees that no local artefact matches the deployed verifier key', /No ZK artifact bundle matches the deployed verifier key/.test(msg), msg);
      note('A wrong verifier key on chain cannot reach the node through the standard client: (1) the artefact integrity check refuses to deploy a key that differs from the compiled hash, (2) the proof server refuses to prove under a key that does not match (HTTP 400), (3) the client refuses to call a contract whose deployed key matches no local artefact. The node-side proof check is shown by the corrupted-proof test above.');
      const lw = await stateOf(wrongProviders, wrongAddress, wrong.ledger);
      ok('PoR: that rejected call left no report behind', lw.reports.isEmpty());
    } finally {
      rmSync(wrongDir, { recursive: true, force: true });
    }
    note('Read the printed errors: a rejection only counts as proof verification if the reason is about the proof, not about a signature, binding, balance or a client-side key check.');
  }
} catch (e) {
  failures++;
  console.log(`FAIL  chain-check stopped: ${errText(e)}`);
  if (process.env['LOG_LEVEL'] === 'debug') console.error(e);
} finally {
  await cleanup();
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll chain checks passed.');
process.exit(failures ? 1 : 0);
