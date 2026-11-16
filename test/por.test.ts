import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LiabilityTree, hashNode, verifyInclusion, isSolvent, recomputeRoot, MAX_BALANCE, type Account } from "../src/por/sumTree.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const h = (c: string) => c.repeat(64);
const accts = (n: number): Account[] =>
  Array.from({ length: n }, (_, i) => ({
    accountIdHash: h((i % 15).toString(16)),
    salt: h(((i + 3) % 15).toString(16)),
    balance: BigInt(100 + i * 7),
  }));

test("root sum equals the sum of all balances", () => {
  const a = accts(37);
  const t = new LiabilityTree(a, 8);
  assert.equal(t.root.sum, a.reduce((s, x) => s + x.balance, 0n));
});

test("every account path verifies against the root, at any size", () => {
  for (const n of [1, 2, 3, 8, 37]) {
    const t = new LiabilityTree(accts(n), 8);
    for (let i = 0; i < n; i++) assert.ok(verifyInclusion(t.root, t.prove(i), 8), `n=${n} i=${i}`);
  }
});

test("tampering with a balance, a sibling sum or the index breaks inclusion", () => {
  const t = new LiabilityTree(accts(10), 8);
  const p = t.prove(4);
  assert.ok(!verifyInclusion(t.root, { ...p, account: { ...p.account, balance: p.account.balance - 1n } }, 8));
  const sums = [...p.siblingSums];
  sums[2] -= 1n;
  assert.ok(!verifyInclusion(t.root, { ...p, siblingSums: sums }, 8));
  assert.ok(!verifyInclusion(t.root, { ...p, index: 5 }, 8));
});

test("a hidden liability cannot be dropped without changing the root", () => {
  const a = accts(10);
  const full = new LiabilityTree(a, 8);
  const understated = new LiabilityTree(a.map((x, i) => (i === 3 ? { ...x, balance: 0n } : x)), 8);
  assert.notEqual(full.root.hash, understated.root.hash);
});

test("solvency is reserves >= total liabilities", () => {
  const t = new LiabilityTree(accts(5), 8);
  assert.ok(isSolvent(t.root, t.root.sum));
  assert.ok(!isSolvent(t.root, t.root.sum - 1n));
});

test("sums beyond the balance range do not overflow (Uint<128>)", () => {
  const big = (i: number): Account => ({ accountIdHash: h("a"), salt: h(String(i)), balance: MAX_BALANCE });
  const t = new LiabilityTree([big(1), big(2), big(3), big(4)], 4);
  assert.equal(t.root.sum, 4n * MAX_BALANCE);
});

test("out-of-range balances and over-full trees are rejected", () => {
  assert.throws(() => new LiabilityTree([{ accountIdHash: h("a"), salt: h("b"), balance: MAX_BALANCE + 1n }], 4), RangeError);
  assert.throws(() => new LiabilityTree(accts(5), 2), RangeError);
});

test("root children hash up to the root with the summed total", () => {
  const t = new LiabilityTree(accts(37), 8);
  const k = t.rootChildren();
  assert.deepEqual(hashNode(k.left, k.right), t.root);
});

test("an understated sub-total is detected only by customers beneath it (the trust model)", () => {
  const depth = 3;
  const a = accts(8);
  const honest = new LiabilityTree(a, depth);
  const { left, right } = honest.rootChildren();
  // The operator declares a left sub-total that is too small and publishes the matching root.
  const forgedLeft = { hash: left.hash, sum: left.sum - 50n };
  const forgedRoot = hashNode(forgedLeft, right);
  assert.equal(forgedRoot.sum, honest.root.sum - 50n);

  // Customers 0..3 sit under the forged node: the sum they recompute does not match.
  for (let i = 0; i < 4; i++) assert.ok(!verifyInclusion(forgedRoot, honest.prove(i), depth), `left customer ${i} must detect`);
  // Customers 4..7 are handed the forged sibling and cannot tell: their proofs still verify.
  for (let i = 4; i < 8; i++) {
    const p = honest.prove(i);
    const top = depth - 1;
    const proof = { ...p, siblingHashes: [...p.siblingHashes], siblingSums: [...p.siblingSums] };
    proof.siblingSums[top] = forgedLeft.sum;
    assert.ok(verifyInclusion(forgedRoot, proof, depth), `right customer ${i} cannot detect`);
  }
});

test("path length is enforced", () => {
  const t = new LiabilityTree(accts(3), 8);
  assert.throws(() => recomputeRoot(t.prove(0), 7), RangeError);
});

test("committed PoR golden vectors match what the reference generates now", () => {
  const committed = JSON.parse(readFileSync(`${root}test/vectors/por-vectors.json`, "utf8"));
  const fresh = execFileSync(process.execPath, ["scripts/gen-por-vectors.ts"], { cwd: root, encoding: "utf8" });
  assert.deepEqual(JSON.parse(fresh), committed);
});
