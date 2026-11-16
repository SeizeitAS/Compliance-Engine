// Build REAL transactions for the compiled circuits and apply them to an in-memory Midnight ledger.
//   LEDGER=9 PROOF_SERVER=http://localhost:6301 npm run ledger:check     (ledger 8: LEDGER=8, port 6300)
// No node, wallet, funds or network. For each proving circuit: deploy the contract into a blank
// ledger state with its verifier key, build a call transaction from the runtime's proof data, have
// the proof server prove it, then run `wellFormed` and `apply`. `apply` replays the public
// transcript against the on-chain state, so this checks that the circuit's ledger operations are
// consistent with the contract state, and that a replayed call is refused where the circuit says so.
//
// WHAT THIS DOES NOT DO: it does not verify the zero-knowledge proofs. The controls at the end show
// that the ledger library (wasm build) accepts tampered, wrong-key and even unproven transactions
// with contract proof checking switched on, so a PASS here says nothing about proof validity. Real
// verification happens in a Midnight node (docs/proving.md, SR-13). The controls are printed as
// NOTE lines; if a later library version starts rejecting them, the notes say so.
import { webcrypto } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { amlScenario, porScenario, proofDataOf } from "./lib/harness.mjs";

// Node 18 has no global WebCrypto; the ledger needs it for the randomised deployment and address.
globalThis.crypto ??= webcrypto;

const LEDGER = process.env.LEDGER ?? "8";
const L = await import(`@midnightntwrk/ledger-v${LEDGER}`);
const server = process.env.PROOF_SERVER ?? "http://localhost:6300";
const TIMEOUT = Number(process.env.PROOF_TIMEOUT_MS ?? 900000);
const NETWORK = "undeployed";

// Retries only network-level failures (for example a keep-alive connection the server already closed);
// /check and /prove are idempotent, and HTTP error statuses are never retried.
const post = async (path, payload) => {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(server + path, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(payload),
        signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (e) {
      if (attempt >= 3) throw e;
      continue;
    }
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return new Uint8Array(await res.arrayBuffer());
  }
};
const file = (contract, p) => new Uint8Array(readFileSync(resolve(`managed/${contract}/${p}`)));
const keyMaterial = (contract, circuit) => ({
  proverKey: file(contract, `keys/${circuit}.prover`),
  verifierKey: file(contract, `keys/${circuit}.verifier`),
  ir: file(contract, `zkir/${circuit}.bzkir`),
});
/** A ProvingProvider backed by the HTTP proof server; the key location is the circuit name. */
const provider = (contract) => ({
  lookupKey: async (loc) => keyMaterial(contract, loc),
  check: async (pre, loc) => L.parseCheckResult(await post("/check", L.createCheckPayload(pre, keyMaterial(contract, loc).ir))),
  prove: async (pre, loc, binding) => post("/prove", L.createProvingPayload(pre, binding, keyMaterial(contract, loc))),
});

const strictness = (verifyContractProofs) => {
  const s = new L.WellFormedStrictness();
  s.enforceBalancing = false; // no fees or wallet
  s.verifyNativeProofs = false; // no shielded inputs
  s.verifyContractProofs = verifyContractProofs;
  s.enforceLimits = false;
  s.verifySignatures = false;
  return s;
};
const strict = strictness(true);

const now = () => new Date();
const block = () => ({
  secondsSinceEpoch: BigInt(Math.floor(Date.now() / 1000)),
  secondsSinceEpochErr: 0,
  parentBlockHash: "00".repeat(32),
  lastBlockTime: BigInt(Math.floor(Date.now() / 1000) - 6),
});
const ttl = () => new Date(Date.now() + 3600_000);

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `\n   ${detail}`}`);
};
const note = (text) => console.log(`NOTE  ${text}`);

/** Deploy `runtimeState` into a blank ledger with every circuit's verifier key registered. */
const deployInto = async (contract, runtimeState, circuit) => {
  const cs = L.ContractState.deserialize(runtimeState.serialize());
  let op;
  for (const f of readdirSync(resolve(`managed/${contract}/keys`)).filter((x) => x.endsWith(".verifier"))) {
    const name = f.replace(/\.verifier$/, "");
    const o = new L.ContractOperation();
    o.verifierKey = file(contract, `keys/${f}`);
    cs.setOperation(name, o);
    if (name === circuit) op = o;
  }
  const deploy = new L.ContractDeploy(cs);
  // A real prove() (nothing to prove for a deployment) gives a valid binding; mockProve() does not.
  const unproven = L.Transaction.fromParts(NETWORK, undefined, undefined, L.Intent.new(ttl()).addDeploy(deploy));
  const tx = (await unproven.prove(provider(contract), L.CostModel.initialCostModel())).bind();
  const ledger = L.LedgerState.blank(NETWORK);
  const [after, res] = ledger.apply(tx.wellFormed(ledger, strict, now()), new L.TransactionContext(ledger, block()));
  if (res.type !== "success") throw new Error(`deploy failed: ${res.error}`);
  return { ledger: after, address: deploy.address, op };
};

/** The unproven call transaction for a circuit run, built from the runtime's proof data. */
const buildCall = (circuit, ledger, address, op, pd) => {
  const state = ledger.index(address);
  const pre = new L.PreTranscript(new L.QueryContext(state.data, address), pd.publicTranscript, pd.commCommData?.commComm);
  const [guaranteed, fallible] = L.partitionTranscripts([pre], ledger.parameters)[0];
  const rand = pd.commCommData?.commCommRand ?? L.communicationCommitmentRandomness();
  const proto = new L.ContractCallPrototype(address, circuit, op, guaranteed, fallible, pd.privateTranscriptOutputs, pd.input, pd.output, rand, circuit);
  return L.Transaction.fromParts(NETWORK, undefined, undefined, L.Intent.new(ttl()).addCall(proto));
};

const checkCircuit = async (label, contract, circuit, makeRun, { replayMustFail }) => {
  console.log(`-- ${label}`);
  const d = await makeRun();
  const r = await d.call(circuit.name, ...circuit.args);
  const pd = proofDataOf(r);
  const dep = await deployInto(contract, d.initialState, circuit.name);

  const unproven = buildCall(circuit.name, dep.ledger, dep.address, dep.op, pd);
  const t0 = Date.now();
  const bound = (await unproven.prove(provider(contract), L.CostModel.initialCostModel())).bind();
  const proofBytes = [...bound.intents.values()][0].actions[0].proof.serialize().length;
  ok(`${label}: call transaction assembled and proved by the proof server (${proofBytes} byte proof, ${((Date.now() - t0) / 1000).toFixed(0)} s)`, proofBytes > 1000);

  const verified = bound.wellFormed(dep.ledger, strict, now());
  ok(`${label}: transaction is well-formed`, true);
  const [ledger2, res] = dep.ledger.apply(verified, new L.TransactionContext(dep.ledger, block()));
  ok(`${label}: applies to the on-chain state (public transcript replays)`, res.type === "success", `result: ${res.type} ${res.error ?? ""}`);

  if (replayMustFail) {
    const [, again] = ledger2.apply(verified, new L.TransactionContext(ledger2, block()));
    ok(`${label}: replaying the same call is refused by the ledger`, again.type !== "success", `replay result: ${again.type}`);
  }

  // Controls: is contract proof verification actually active in this library build?
  const raw = bound.serialize();
  const wiped = Uint8Array.from(raw);
  for (let i = Math.floor(raw.length * 0.25); i < Math.floor(raw.length * 0.75); i++) wiped[i] = 0;
  let wipedAccepted;
  try {
    L.Transaction.deserialize("signature", "proof", "binding", wiped).wellFormed(dep.ledger, strict, now());
    wipedAccepted = true;
  } catch {
    wipedAccepted = false;
  }
  let unprovenAccepted;
  try {
    unproven.wellFormed(dep.ledger, strict, now());
    unprovenAccepted = true;
  } catch {
    unprovenAccepted = false;
  }
  if (wipedAccepted || unprovenAccepted) {
    note(`${label}: contract proofs are NOT verified by this ledger library (half of the transaction zeroed: ${wipedAccepted ? "accepted" : "rejected"}; unproven transaction: ${unprovenAccepted ? "accepted" : "rejected"}). The PASS lines above do not show proof validity.`);
  } else {
    note(`${label}: the library rejected a zeroed and an unproven transaction, so proof checking may be active in this version; add proper negative tests before relying on it.`);
  }
};

console.log(`ledger ${LEDGER}, proof server ${server}`);
{
  const { fresh } = await amlScenario();
  await checkCircuit("AML_Gate.prove_not_sanctioned", "AML_Gate", { name: "prove_not_sanctioned", args: [] }, () => fresh(), { replayMustFail: false });
}
{
  const { fresh, total, reservePackage } = await porScenario();
  await checkCircuit("PoR.publish_solvency_report", "PoR", { name: "publish_solvency_report", args: [202611n, total, reservePackage] }, () => fresh(), { replayMustFail: true });
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nTransactions assemble, prove and apply. Proof validity is NOT verified here (see NOTE lines).");
process.exit(failures ? 1 : 0);
