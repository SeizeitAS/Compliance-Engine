import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  verifyReservePackage, packageHash, challenge, reconcileCustodial,
  type CustodialHolding, type Holding, type PricePoint, type ReservePackage,
} from "../src/por/reserves.ts";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const keyFromSeed = (n: number) => {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, n)]), format: "der", type: "pkcs8" });
  const raw = createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  return { priv, publicKey: raw.toString("hex"), address: createHash("sha256").update(raw).digest("hex") };
};

const ROOT = "ab".repeat(32);
const PERIOD = 202611n;
const AS_OF = 1_793_000_000n;
const ADA_1000 = 1_000_000_000n; // lovelace; at 0.50 NOK this is 500 NOK = 50_000 ore
const opts = { asOf: AS_OF };

function proven(seed: number, amount: bigint): Holding {
  const k = keyFromSeed(seed);
  const h: Holding = {
    chain: "test", address: k.address, asset: "ADA", amount, decimals: 6, snapshotHeight: 1000n,
    control: { publicKey: k.publicKey, signature: "" },
  };
  h.control.signature = sign(null, Buffer.from(challenge(PERIOD, ROOT, h.chain, h.address), "hex"), k.priv).toString("hex");
  return h;
}
const custodial = (extra: Partial<CustodialHolding> = {}): CustodialHolding => ({
  custodian: "NBX", accountRef: "acct-1", asset: "ADA", amount: 4n * ADA_1000, decimals: 6, asOf: AS_OF - 60n,
  staked: false, statementHash: "11".repeat(32), ...extra,
});
const price = (asset: string, nokPerUnitE8: bigint, ts = AS_OF - 60n): PricePoint => ({ asset, nokPerUnitE8, timestamp: ts });
const pkg = (holdings: Holding[], cust: CustodialHolding[] | undefined, extra: Partial<ReservePackage> = {}): ReservePackage => ({
  period: PERIOD, liabilitiesRoot: ROOT, holdings, prices: [price("ADA", 50_000_000n)],
  ...(cust ? { custodial: cust } : {}), ...extra,
});
const reason = (r: { valid: boolean }) => (r as { reason: string }).reason;

test("only custodial holdings: verifies as documented, reserves counted = 0", () => {
  const r = verifyReservePackage(pkg([], [custodial()]), 0n, opts);
  assert.ok(r.valid);
  if (!r.valid) return;
  assert.equal(r.reserves, 0n);
  assert.equal(r.documentedCustodial, 200_000n); // 4000 ADA at 0.50 NOK = 2000 NOK
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0]!.counted, false);
  assert.equal(r.lines[0]!.kind, "custodial-attested");
  assert.equal(r.lines[0]!.reason, "third-party custody");
});

test("claiming the documented value as reserves is rejected: counted and documented never mix", () => {
  const r = verifyReservePackage(pkg([], [custodial()]), 200_000n, opts);
  assert.equal(reason(r), "RESERVES_MISMATCH");
});

test("proven and custodial together: reserves count only the proven holding", () => {
  const r = verifyReservePackage(pkg([proven(1, ADA_1000)], [custodial()]), 50_000n, opts);
  assert.ok(r.valid);
  if (!r.valid) return;
  assert.equal(r.reserves, 50_000n);
  assert.equal(r.documentedCustodial, 200_000n);
  assert.deepEqual(r.lines.map((l) => [l.kind, l.counted]), [["control-proof", true], ["custodial-attested", false]]);
});

test("staked holdings are labelled as a claim on the custodian", () => {
  const r = verifyReservePackage(pkg([], [custodial({ staked: true })]), 0n, opts);
  assert.ok(r.valid && r.lines[0]!.reason === "third-party custody, staked at the custodian");
});

test("a changed statement hash, amount, custodian or staked flag changes the package hash", () => {
  const base = packageHash(pkg([], [custodial()]));
  assert.notEqual(base, packageHash(pkg([], [custodial({ statementHash: "22".repeat(32) })])));
  assert.notEqual(base, packageHash(pkg([], [custodial({ amount: 4n * ADA_1000 + 1n })])));
  assert.notEqual(base, packageHash(pkg([], [custodial({ custodian: "Coinbase" })])));
  assert.notEqual(base, packageHash(pkg([], [custodial({ staked: true })])));
  assert.notEqual(base, packageHash(pkg([], [custodial({ asOf: AS_OF - 61n })])));
});

test("removing the custodial section changes the package hash", () => {
  assert.notEqual(packageHash(pkg([], [custodial()])), packageHash(pkg([], [])));
});

test("a package without custodial holdings and policy keeps the v1 hash", () => {
  const withoutField = packageHash(pkg([proven(1, ADA_1000)], undefined));
  assert.equal(withoutField, packageHash(pkg([proven(1, ADA_1000)], [])));
});

test("the policy hash is bound into the package hash", () => {
  const a = packageHash(pkg([], [], { policyHash: "aa".repeat(32) }));
  assert.notEqual(a, packageHash(pkg([], [], { policyHash: "bb".repeat(32) })));
  assert.notEqual(a, packageHash(pkg([], [])));
});

test("order of custodial holdings does not matter", () => {
  const a = custodial(), b = custodial({ accountRef: "acct-2", asset: "ADA" });
  assert.equal(packageHash(pkg([], [a, b])), packageHash(pkg([], [b, a])));
});

test("custodial holdings need a price, a valid statement hash and a statement that is not from the future", () => {
  assert.equal(reason(verifyReservePackage({ ...pkg([], [custodial({ asset: "ETH" })]) }, 0n, opts)), "MISSING_PRICE");
  assert.equal(reason(verifyReservePackage(pkg([], [custodial({ statementHash: "zz".repeat(32) })]), 0n, opts)), "MALFORMED_INPUT");
  assert.equal(reason(verifyReservePackage(pkg([], [custodial({ statementHash: "11".repeat(31) })]), 0n, opts)), "MALFORMED_INPUT");
  assert.equal(reason(verifyReservePackage(pkg([], [custodial({ asOf: AS_OF + 1n })]), 0n, opts)), "FUTURE_STATEMENT");
  assert.equal(reason(verifyReservePackage(pkg([], [custodial({ amount: -1n })]), 0n, opts)), "BAD_HOLDING");
  assert.equal(reason(verifyReservePackage(pkg([], [custodial({ custodian: "" })]), 0n, opts)), "MALFORMED_INPUT");
  assert.equal(reason(verifyReservePackage(pkg([], [custodial({ amount: 1n << 128n })]), 0n, opts)), "MALFORMED_INPUT");
  assert.equal(reason(verifyReservePackage(pkg([], [custodial()], { policyHash: "ZZ".repeat(32) }), 0n, opts)), "MALFORMED_INPUT");
});

test("duplicate custodial holdings are rejected", () => {
  assert.equal(reason(verifyReservePackage(pkg([], [custodial(), custodial()]), 0n, opts)), "DUPLICATE_CUSTODIAL");
});

test("reconciliation: books against custodian statements", () => {
  const stmt = [custodial(), custodial({ accountRef: "acct-2", amount: 5n }), custodial({ accountRef: "acct-3" })];
  const books = [
    { custodian: "NBX", accountRef: "acct-1", asset: "ADA", amount: 4n * ADA_1000 },
    { custodian: "NBX", accountRef: "acct-2", asset: "ADA", amount: 7n },
    { custodian: "NBX", accountRef: "acct-9", asset: "ADA", amount: 1n },
  ];
  const lines = reconcileCustodial(stmt, books);
  const byAcct = Object.fromEntries(lines.map((l) => [l.accountRef, l]));
  assert.equal(byAcct["acct-1"]!.status, "match");
  assert.equal(byAcct["acct-1"]!.difference, 0n);
  assert.equal(byAcct["acct-2"]!.status, "mismatch");
  assert.equal(byAcct["acct-2"]!.difference, -2n);
  assert.equal(byAcct["acct-3"]!.status, "missing-in-books");
  assert.equal(byAcct["acct-9"]!.status, "missing-in-statement");
  assert.equal(lines.length, 4);
});
