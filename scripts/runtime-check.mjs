// Execute the COMPILED contracts in the Midnight runtime (no node, no proof server) and check that
// the circuits accept valid inputs, reject invalid ones, and update ledger state as designed.
//   npm run contracts:compile && npm run runtime:check
// Ledger 8: compact-runtime 0.16.0 with the default compiler. Ledger 9: compact-runtime 0.21.0 with
// COMPACT_VERSION=0.36.0 (docs/toolchain.md). The same checks run on both. Runs on Node 18.
// Covers circuit logic, assertions, witnesses, ledger operations and proof-preimage creation.
// The prover itself is exercised by scripts/prove.mjs (docs/proving.md).
import { createHash } from "node:crypto";
import { amlScenario, porScenario, bytes, proofDataOf } from "./lib/harness.mjs";

// Same layout as src/por/reserves.ts `attestation` (kept here so this script needs no TypeScript).
const pad32 = (t) => Buffer.concat([Buffer.from(t, "ascii"), Buffer.alloc(32 - t.length)]);
const le32 = (n) => {
  const b = Buffer.alloc(32);
  for (let i = 0, x = BigInt(n); i < 32 && x > 0n; i++, x >>= 8n) b[i] = Number(x & 0xffn);
  return b;
};
const expectedAttestation = (period, root, reserves, pkg) =>
  createHash("sha256").update(pad32("ce.por.attest.v1")).update(le32(period)).update(Buffer.from(root, "hex")).update(le32(reserves)).update(Buffer.from(pkg, "hex")).digest("hex");

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : `\n   ${detail}`}`);
};
const throwsWith = async (name, fn, fragment) => {
  try {
    await fn();
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
  const d = await fresh();
  const before = ledger(d.state);
  ok("AML: constructor stores the root and version 1", hex(before.sanctions_root) === m.root && before.list_version === 1n);
  const r = await d.call("prove_not_sanctioned");
  const after = ledger(d.state);
  ok("AML: unlisted key is accepted and a receipt is recorded", after.receipts.member(r.result) && after.receipts.size() === 1n);
  ok("AML: the proof preimage data is produced", proofDataOf(r) !== undefined);

  const prove = async (priv, root) => (await fresh(priv, root)).call("prove_not_sanctioned");
  await throwsWith("AML: a listed key (equal to range start) is rejected", () => prove({ ...good, key: good.lo }), good.lo === 0n ? "non-zero" : "above range start");
  await throwsWith("AML: a key equal to range end is rejected", () => prove({ ...good, key: good.hi }), "below range end");
  await throwsWith("AML: a key outside the claimed range is rejected", () => prove({ ...good, key: good.hi + 1n }), "below range end");
  await throwsWith("AML: a forged range with a valid-looking path is rejected", () => prove({ ...good, hi: good.hi + 5n }), "not in the committed");
  await throwsWith("AML: the zero key is rejected", () => prove({ ...good, key: 0n }), "non-zero");
  await throwsWith("AML: a proof against another root is rejected", () => prove(good, "11".repeat(32)), "not in the committed");

  const d2 = await fresh();
  const wrong = { ...good, adminSecret: Uint8Array.from(Buffer.alloc(32, 1)) };
  await throwsWith("AML: root update with the wrong admin secret is rejected", () => {
    d2.setPrivate(wrong);
    return d2.call("update_sanctions_root", bytes("22".repeat(32)));
  }, "not authorised");
  d2.setPrivate(good);
  await d2.call("update_sanctions_root", bytes("22".repeat(32)));
  const l2 = ledger(d2.state);
  ok("AML: root update by the admin changes the root and bumps the version", hex(l2.sanctions_root) === "22".repeat(32) && l2.list_version === 2n);
  await throwsWith("AML: a proof against the OLD root fails after the update", () => d2.call("prove_not_sanctioned"), "not in the committed");
}

// ---------------------------------------------------------------- PoR
{
  const { ledger, v, good, fresh, total, reservePackage: att } = await porScenario();
  const PERIOD = 202611n;
  const publish = async (priv, reserves) => (await fresh(priv)).call("publish_solvency_report", PERIOD, reserves, att);
  const d = await fresh();
  const r = await d.call("publish_solvency_report", PERIOD, total, att);
  const rep = ledger(d.state).reports.lookup(PERIOD);
  ok("PoR: solvent report (reserves == total) is accepted and stored", rep.total_liabilities === total && rep.reserves === total);
  ok("PoR: the stored root equals the golden-vector root", hex(rep.liabilities_root) === v.tree.root.hash);
  ok("PoR: the attestation is bound in-circuit to period, root, reserves and package", hex(rep.attestation) === expectedAttestation(PERIOD, hex(rep.liabilities_root), total, hex(rep.reserve_package)) && hex(rep.reserve_package) === hex(att));
  ok("PoR: the proof preimage data is produced", proofDataOf(r) !== undefined);
  await throwsWith("PoR: the same period cannot be reported twice", () => d.call("publish_solvency_report", PERIOD, total + 1n, att), "already reported");
  await d.call("publish_solvency_report", PERIOD + 1n, total * 2n, att);
  ok("PoR: a second period with surplus reserves is accepted", ledger(d.state).reports.size() === 2n);

  await throwsWith("PoR: reserves one below the total are rejected", () => publish(undefined, total - 1n), "reserves below");
  await throwsWith("PoR: zero reserves are rejected", () => publish(undefined, 0n), "reserves below");
  await throwsWith("PoR: the wrong admin secret is rejected", () => publish({ ...good, adminSecret: Uint8Array.from(Buffer.alloc(32, 1)) }, total), "not authorised");

  // Understating a branch by one: the hashes bind the sums, so the circuit computes a DIFFERENT
  // root; the stored report then no longer matches the honest root, which any customer's
  // verify_inclusion check would expose.
  const df = await fresh({ ...good, left: { hash: good.left.hash, sum: good.left.sum - 1n } });
  await df.call("publish_solvency_report", PERIOD, total, att);
  const frep = ledger(df.state).reports.lookup(PERIOD);
  ok("PoR: an understated branch yields a different root, so inclusion checks expose it", hex(frep.liabilities_root) !== v.tree.root.hash && frep.total_liabilities === total - 1n);
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll runtime checks passed.");
process.exit(failures ? 1 : 0);
