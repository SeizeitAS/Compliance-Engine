import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { priceLeaf, type PricePoint } from "../src/por/reserves.ts";
import { verifyPriceProof, TAG_PRICE_NODE, type PriceProofResponse } from "../src/por/priceProof.ts";

// SYNTHETIC trees built here with the documented algorithm. They are not recorded Assetprice responses:
// a test against a real response is still open (CE-24 in docs/SCRUM.md).
const pad32 = (t: string) => { const b = Buffer.alloc(32); b.write(t, "ascii"); return b; };
const node = (l: string, r: string) =>
  createHash("sha256").update(pad32(TAG_PRICE_NODE)).update(Buffer.from(l, "hex")).update(Buffer.from(r, "hex")).digest("hex");

/** Merkle tree, odd node moves up unchanged. Returns the root and the proof for one leaf. */
function build(leaves: string[], index: number) {
  let level = leaves;
  let idx = index;
  const proof: [string, "L" | "R"][] = [];
  while (level.length > 1) {
    const sib = idx ^ 1;
    if (sib < level.length) proof.push([level[sib], sib < idx ? "L" : "R"]);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? node(level[i], level[i + 1]) : level[i]);
    level = next;
    idx = idx >> 1;
  }
  return { root: level[0], proof };
}

const NOW = 1_793_000_000n;
const points: PricePoint[] = ["ADA", "ETH", "NIGHT", "BTC", "SOL"].map((asset, i) => ({
  asset, nokPerUnitE8: 1_000_000_00n * BigInt(i + 3), timestamp: NOW - 600n,
}));
const leaves = points.map(priceLeaf);

function response(i: number): PriceProofResponse {
  const { root, proof } = build(leaves, i);
  const p = points[i];
  return {
    compliance_engine_price_point: { asset: p.asset, nokPerUnitE8: p.nokPerUnitE8.toString(), timestamp: p.timestamp.toString() },
    leaf: leaves[i], leafIndex: i, proof,
    window: { windowNo: 7, merkleRoot: root, serializationVersion: "anchor-v1" },
  };
}
const clone = (r: PriceProofResponse): PriceProofResponse => JSON.parse(JSON.stringify(r));

test("every leaf in an odd-sized tree verifies and is reported as not anchored", () => {
  for (let i = 0; i < points.length; i++) {
    const res = verifyPriceProof(response(i), { nowSeconds: NOW });
    assert.equal(res.valid, true, `leaf ${i}`);
    if (res.valid) {
      assert.equal(res.anchored, false);
      assert.equal(res.price.asset, points[i].asset);
      assert.equal(res.windowNo, 7n);
    }
  }
});

test("matching on-chain root marks the price anchored", () => {
  const r = response(2);
  const res = verifyPriceProof(r, { nowSeconds: NOW, onChainRoot: r.window.merkleRoot });
  assert.equal(res.valid && res.anchored, true);
});

test("different on-chain root fails with ANCHOR_MISMATCH", () => {
  const r = response(2);
  const res = verifyPriceProof(r, { nowSeconds: NOW, onChainRoot: "00".repeat(32) });
  assert.deepEqual(res.valid ? null : res.reason, "ANCHOR_MISMATCH");
});

test("changing the price by one unit fails with LEAF_MISMATCH", () => {
  const r = clone(response(1));
  r.compliance_engine_price_point.nokPerUnitE8 = (BigInt(r.compliance_engine_price_point.nokPerUnitE8) + 1n).toString();
  const res = verifyPriceProof(r, { nowSeconds: NOW });
  assert.deepEqual(res.valid ? null : res.reason, "LEAF_MISMATCH");
});

test("a consistent fake leaf with an unchanged path fails with ROOT_MISMATCH", () => {
  const r = clone(response(1));
  r.compliance_engine_price_point.nokPerUnitE8 = "999";
  r.leaf = priceLeaf({ asset: r.compliance_engine_price_point.asset, nokPerUnitE8: 999n, timestamp: BigInt(r.compliance_engine_price_point.timestamp) });
  const res = verifyPriceProof(r, { nowSeconds: NOW });
  assert.deepEqual(res.valid ? null : res.reason, "ROOT_MISMATCH");
});

test("tampered sibling, flipped side and wrong root all fail with ROOT_MISMATCH", () => {
  const a = clone(response(3)); a.proof[0][0] = "11".repeat(32);
  const b = clone(response(3)); b.proof[0][1] = b.proof[0][1] === "L" ? "R" : "L";
  const c = clone(response(3)); c.window.merkleRoot = "22".repeat(32);
  for (const r of [a, b, c]) {
    const res = verifyPriceProof(r, { nowSeconds: NOW });
    assert.deepEqual(res.valid ? null : res.reason, "ROOT_MISMATCH");
  }
});

test("dropping a proof step fails", () => {
  const r = clone(response(0));
  r.proof.pop();
  assert.equal(verifyPriceProof(r, { nowSeconds: NOW }).valid, false);
});

test("stale and future prices fail, the boundary passes", () => {
  const r = response(0); // timestamp NOW - 600
  assert.equal(verifyPriceProof(r, { nowSeconds: NOW - 600n + 3600n }).valid, true);
  const stale = verifyPriceProof(r, { nowSeconds: NOW - 600n + 3601n });
  assert.deepEqual(stale.valid ? null : stale.reason, "STALE_PRICE");
  const future = verifyPriceProof(r, { nowSeconds: NOW - 601n });
  assert.deepEqual(future.valid ? null : future.reason, "FUTURE_PRICE");
  assert.equal(verifyPriceProof(r, { nowSeconds: NOW + 5000n, maxPriceAgeSeconds: 6000n }).valid, true);
});

test("malformed input is rejected without throwing", () => {
  const cases: [string, (r: PriceProofResponse) => void][] = [
    ["price as number", (r) => { (r.compliance_engine_price_point as any).nokPerUnitE8 = 5; }],
    ["price with sign", (r) => { r.compliance_engine_price_point.nokPerUnitE8 = "-5"; }],
    ["price with leading zero", (r) => { r.compliance_engine_price_point.nokPerUnitE8 = "0123"; }],
    ["price zero", (r) => { r.compliance_engine_price_point.nokPerUnitE8 = "0"; }],
    ["price above 256 bits", (r) => { r.compliance_engine_price_point.nokPerUnitE8 = (2n ** 256n).toString(); }],
    ["empty asset", (r) => { r.compliance_engine_price_point.asset = ""; }],
    ["uppercase hex leaf", (r) => { r.leaf = r.leaf.toUpperCase(); }],
    ["bad side", (r) => { (r.proof[0] as any)[1] = "X"; }],
    ["short sibling", (r) => { r.proof[0][0] = "ab"; }],
    ["proof not an array", (r) => { (r as any).proof = "nope"; }],
    ["missing window", (r) => { (r as any).window = undefined; }],
  ];
  for (const [name, mutate] of cases) {
    const r = clone(response(1));
    mutate(r);
    const res = verifyPriceProof(r, { nowSeconds: NOW });
    assert.equal(res.valid, false, name);
    assert.equal(res.valid ? null : res.reason, "MALFORMED_INPUT", name);
  }
});

test("unknown serialization version is refused", () => {
  const r = clone(response(1));
  r.window.serializationVersion = "anchor-v2";
  const res = verifyPriceProof(r, { nowSeconds: NOW });
  assert.deepEqual(res.valid ? null : res.reason, "UNSUPPORTED_VERSION");
});

test("a single-leaf window has an empty proof and verifies", () => {
  const p = points[0];
  const r: PriceProofResponse = {
    compliance_engine_price_point: { asset: p.asset, nokPerUnitE8: p.nokPerUnitE8.toString(), timestamp: p.timestamp.toString() },
    leaf: priceLeaf(p), leafIndex: 0, proof: [],
    window: { windowNo: "1", merkleRoot: priceLeaf(p), serializationVersion: "anchor-v1" },
  };
  assert.equal(verifyPriceProof(r, { nowSeconds: NOW }).valid, true);
});
