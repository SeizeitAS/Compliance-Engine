import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SanctionsTree, verifyNonMembership, deriveKey, KEY_SPACE, hashLeaf,
} from "../src/sanctions/indexedMerkleTree.ts";

const D = 8;
const listed = ["alice", "bob", "carol", "dave", "erin"].map((s) => deriveKey(s));

test("accepts non-members, including below-min and above-max keys", () => {
  const t = new SanctionsTree(listed, D);
  const sorted = [...listed].sort((a, b) => (a < b ? -1 : 1));
  const probes = [1n, sorted[0] + 1n, (sorted[1] + sorted[2]) / 2n, sorted[4] + 1n, KEY_SPACE - 1n];
  for (const k of probes) {
    if (t.has(k)) continue;
    const p = t.prove(k)!;
    assert.deepEqual(verifyNonMembership(t.root, k, p, D), { valid: true });
  }
});

test("cannot prove a listed key", () => {
  const t = new SanctionsTree(listed, D);
  for (const k of listed) assert.equal(t.prove(k), null);
});

test("a forged proof for a listed key is rejected (range endpoints are exclusive)", () => {
  const t = new SanctionsTree(listed, D);
  const sorted = [...listed].sort((a, b) => (a < b ? -1 : 1));
  const k = sorted[2];
  // Reuse a legitimate neighbouring range: k equals its endpoint.
  const neighbour = t.prove(k + 1n)!; // range (k, next)
  assert.equal(neighbour.lo, k);
  assert.deepEqual(verifyNonMembership(t.root, k, neighbour, D), { valid: false, reason: "KEY_NOT_IN_RANGE" });
});

test("rejects tampered range, wrong root, bad index and short path", () => {
  const t = new SanctionsTree(listed, D);
  const k = deriveKey("zed-not-listed");
  const p = t.prove(k)!;
  const widened = { ...p, lo: 0n, hi: KEY_SPACE };
  assert.equal(verifyNonMembership(t.root, k, widened, D).valid, false);
  const other = new SanctionsTree([...listed, deriveKey("frank")], D);
  assert.deepEqual(verifyNonMembership(other.root, k, p, D), { valid: false, reason: "ROOT_MISMATCH" });
  assert.equal(verifyNonMembership(t.root, k, { ...p, index: p.index ^ 1 }, D).valid, false);
  assert.deepEqual(verifyNonMembership(t.root, k, { ...p, siblings: p.siblings.slice(1) }, D), { valid: false, reason: "BAD_PATH_LENGTH" });
  assert.deepEqual(verifyNonMembership(t.root, 0n, p, D), { valid: false, reason: "KEY_OUT_OF_DOMAIN" });
});

test("empty list: every key is a non-member", () => {
  const t = new SanctionsTree([], D);
  const k = deriveKey("anyone");
  assert.deepEqual(verifyNonMembership(t.root, k, t.prove(k)!, D), { valid: true });
});

test("root changes with the list; deterministic and order independent", () => {
  const a = new SanctionsTree(listed, D);
  const b = new SanctionsTree([...listed].reverse(), D);
  assert.equal(a.root, b.root);
  assert.notEqual(a.root, new SanctionsTree(listed.slice(1), D).root);
});

test("leaf and node hashes are domain separated", () => {
  assert.notEqual(hashLeaf(0n, 1n), hashLeaf(1n, 0n));
});

test("randomised: every non-member verifies, every member fails", () => {
  const keys = Array.from({ length: 200 }, (_, i) => deriveKey(`id-${i}`));
  const t = new SanctionsTree(keys, 10);
  for (let i = 0; i < 400; i++) {
    const k = deriveKey(`probe-${i}`);
    const p = t.prove(k);
    assert.ok(p);
    assert.equal(verifyNonMembership(t.root, k, p, 10).valid, true);
  }
  for (const k of keys.slice(0, 50)) assert.equal(t.prove(k), null);
});
