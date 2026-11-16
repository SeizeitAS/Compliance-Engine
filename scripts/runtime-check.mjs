// Execute the COMPILED contracts in the Midnight runtime (no node, no proof server) and check that
// the circuits accept valid inputs, reject invalid ones, and update ledger state as designed.
//   npm run contracts:compile && npm run runtime:check
// Needs @midnight-ntwrk/compact-runtime@0.16.0 (docs/toolchain.md). Runs on Node 18.
// Covers circuit logic, assertions, witnesses, ledger operations and proof-preimage creation.
// The prover itself is exercised by scripts/prove.mjs (docs/proving.md).
import { createHash } from "node:crypto";
import { amlScenario, porScenario, bytes } from "./lib/harness.mjs";

// Same layout as src/por/reserves.ts `attestation` (kept here so this script needs no TypeScript).
const pad32 = (t) => Buffer.concat([Buffer.from(t, "ascii"), Buffer.alloc(32 - t.length)]);
const le32 = (n) => { const b = Buffer.alloc(32); for (let i = 0, x = BigInt(n); i < 32 && x > 0n; i++, x >>= 8n) b[i] = Number(x & 0xffn); return b; };
const expectedAttestation = (period, root, reserves, pkg) =>
  createHash("sha256").update(pad32("ce.por.attest.v1")).update(le32(period)).update(Buffer.from(root, "hex")).update(le32(reserves)).update(Buffer.from(pkg, "hex")).digest("hex");

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `\n   ${detail}`}`);
};
const throwsWith = (name, fn, fragment) => {
  try {
    fn();
    ok(name, false, "expected the circuit to reject, but it succeeded");
  } catch (e) {
    const msg = String(e?.message ?? e);
    ok(name, msg.includes(fragment), `rejected, but with: ${msg}`);
  }
};
const hex = (b) => Buffer.from(b).toString("hex");

// ---------------------------------------------------------------- AML_Gate
{
  const { ledger, m, good, fresh } = await amlScenario();
  const d = fresh();
  const before = ledger(d.ctx.currentQueryContext.state);
  ok("AML: constructor stores the root and version 1", hex(before.sanctions_root) === m.root && before.list_version === 1n);
  const r = d.call("prove_not_sanctioned");
  const after = ledger(d.ctx.currentQueryContext.state);
  ok("AML: unlisted key is accepted and a receipt is recorded", after.receipts.member(r.result) && after.receipts.size() === 1n);
  ok("AML: the proof preimage data is produced", r.proofData !== undefined);

  throwsWith("AML: a listed key (equal to range start) is rejected", () => fresh({ ...good, key: good.lo }).call("prove_not_sanctioned"), good.lo === 0n ? "non-zero" : "above range start");
  throwsWith("AML: a key equal to range end is rejected", () => fresh({ ...good, key: good.hi }).call("prove_not_sanctioned"), "below range end");
  throwsWith("AML: a key outside the claimed range is rejected", () => fresh({ ...good, key: good.hi + 1n }).call("prove_not_sanctioned"), "below range end");
  throwsWith("AML: a forged range with a valid-looking path is rejected", () => fresh({ ...good, hi: good.hi + 5n }).call("prove_not_sanctioned"), "not in the committed");
  throwsWith("AML: the zero key is rejected", () => fresh({ ...good, key: 0n }).call("prove_not_sanctioned"), "non-zero");
  throwsWith("AML: a proof against another root is rejected", () => fresh(good, "11".repeat(32)).call("prove_not_sanctioned"), "not in the committed");

  const d2 = fresh();
  const wrong = { ...good, adminSecret: Uint8Array.from(Buffer.alloc(32, 1)) };
  throwsWith("AML: root update with the wrong admin secret is rejected", () => {
    d2.ctx = { ...d2.ctx, currentPrivateState: wrong };
    d2.call("update_sanctions_root", bytes("22".repeat(32)));
  }, "not authorised");
  d2.ctx = { ...d2.ctx, currentPrivateState: good };
  d2.call("update_sanctions_root", bytes("22".repeat(32)));
  const l2 = ledger(d2.ctx.currentQueryContext.state);
  ok("AML: root update by the admin changes the root and bumps the version", hex(l2.sanctions_root) === "22".repeat(32) && l2.list_version === 2n);
  throwsWith("AML: a proof against the OLD root fails after the update", () => d2.call("prove_not_sanctioned"), "not in the committed");
}

// ---------------------------------------------------------------- PoR
{
  const { ledger, v, good, fresh, total, reservePackage: att } = await porScenario();
  const PERIOD = 202611n;
  const d = fresh();
  const r = d.call("publish_solvency_report", PERIOD, total, att);
  const rep = ledger(d.ctx.currentQueryContext.state).reports.lookup(PERIOD);
  ok("PoR: solvent report (reserves == total) is accepted and stored", rep.total_liabilities === total && rep.reserves === total);
  ok("PoR: the stored root equals the golden-vector root", hex(rep.liabilities_root) === v.tree.root.hash);
  ok("PoR: the attestation is bound in-circuit to period, root, reserves and package", hex(rep.attestation) === expectedAttestation(PERIOD, hex(rep.liabilities_root), total, hex(rep.reserve_package)) && hex(rep.reserve_package) === hex(att));
  ok("PoR: the proof preimage data is produced", r.proofData !== undefined);
  throwsWith("PoR: the same period cannot be reported twice", () => d.call("publish_solvency_report", PERIOD, total + 1n, att), "already reported");
  d.call("publish_solvency_report", PERIOD + 1n, total * 2n, att);
  ok("PoR: a second period with surplus reserves is accepted", ledger(d.ctx.currentQueryContext.state).reports.size() === 2n);

  throwsWith("PoR: reserves one below the total are rejected", () => fresh().call("publish_solvency_report", PERIOD, total - 1n, att), "reserves below");
  throwsWith("PoR: zero reserves are rejected", () => fresh().call("publish_solvency_report", PERIOD, 0n, att), "reserves below");
  throwsWith("PoR: the wrong admin secret is rejected", () => fresh({ ...good, adminSecret: Uint8Array.from(Buffer.alloc(32, 1)) }).call("publish_solvency_report", PERIOD, total, att), "not authorised");

  // Understating a branch by one: the hashes bind the sums, so the circuit computes a DIFFERENT
  // root; the stored report then no longer matches the honest root, which any customer's
  // verify_inclusion check would expose.
  const df = fresh({ ...good, left: { hash: good.left.hash, sum: good.left.sum - 1n } });
  df.call("publish_solvency_report", PERIOD, total, att);
  const frep = ledger(df.ctx.currentQueryContext.state).reports.lookup(PERIOD);
  ok("PoR: an understated branch yields a different root, so inclusion checks expose it", hex(frep.liabilities_root) !== v.tree.root.hash && frep.total_liabilities === total - 1n);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll runtime checks passed.");
process.exit(failures ? 1 : 0);
