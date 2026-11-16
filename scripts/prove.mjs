// Generate REAL zero-knowledge proofs for the compiled circuits with a Midnight proof server.
//   ledger 8: npm install --no-save @midnight-ntwrk/compact-runtime@0.16.0 @midnightntwrk/ledger-v8@8.1.3
//   ledger 9: npm install --no-save @midnight-ntwrk/compact-runtime@0.21.0 @midnightntwrk/ledger-v9@1.0.0
//   PROOF_SERVER=http://localhost:6300 [LEDGER=9] npm run prove
// The proof server and the compiler outputs must target the same ledger version (docs/proving.md).
// For each circuit: run it in the runtime to get the proof preimage, ask the server to /check that
// the witness satisfies the circuit, then /prove. Needs Node >= 18 (global fetch). Does not submit
// anything to a chain.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// LEDGER=8 (default) uses ledger-v8 with compact-runtime 0.16.0; LEDGER=9 uses ledger-v9 with 0.21.0.
const LEDGER = process.env.LEDGER ?? "8";
const { createCheckPayload, createProvingPayload, parseCheckResult } = await import(`@midnightntwrk/ledger-v${LEDGER}`);
import { amlScenario, porScenario, proofDataOf, rt } from "./lib/harness.mjs";

const server = process.env.PROOF_SERVER ?? "http://localhost:6300";
const TIMEOUT = Number(process.env.PROOF_TIMEOUT_MS ?? 900000);
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

const keyMaterial = (contract, circuit) => {
  const f = (p) => new Uint8Array(readFileSync(resolve(`managed/${contract}/${p}`)));
  return { proverKey: f(`keys/${circuit}.prover`), verifierKey: f(`keys/${circuit}.verifier`), ir: f(`zkir/${circuit}.bzkir`) };
};

let failures = 0;
const prove = async (label, contract, circuit, run) => {
  try {
    const r = await run();
    const pd = proofDataOf(r);
    const preimage = rt.proofDataIntoSerializedPreimage(pd.input, pd.output, pd.publicTranscript, pd.privateTranscriptOutputs, circuit);
    const km = keyMaterial(contract, circuit);
    const check = parseCheckResult(await post("/check", createCheckPayload(preimage, km.ir)));
    console.log(`PASS  ${label}: /check accepted the witness (${check.length} public-input checks)`);
    const t0 = Date.now();
    const proof = await post("/prove", createProvingPayload(preimage, undefined, km));
    console.log(`PASS  ${label}: proof generated, ${proof.length} bytes in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${label}: ${String(e?.message ?? e).split("\n")[0]}`);
  }
};

console.log(`proof server: ${server}`);
{
  const { fresh } = await amlScenario();
  const d = await fresh();
  await prove("AML prove_not_sanctioned", "AML_Gate", "prove_not_sanctioned", () => d.call("prove_not_sanctioned"));
}
{
  const { fresh, total, reservePackage } = await porScenario();
  const d = await fresh();
  await prove("PoR publish_solvency_report", "PoR", "publish_solvency_report", () => d.call("publish_solvency_report", 202611n, total, reservePackage));
}
console.log(failures ? `\n${failures} proving step(s) failed.` : "\nAll circuits proved.");
process.exit(failures ? 1 : 0);
