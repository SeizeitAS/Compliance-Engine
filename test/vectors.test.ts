import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashLeaf, hashNode, verifyNonMembership, pathDirections } from "../src/sanctions/indexedMerkleTree.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const committed = JSON.parse(readFileSync(`${root}test/vectors/nonmembership-vectors.json`, "utf8"));

test("committed golden vectors match what the reference implementation generates now", () => {
  const regenerated = execFileSync(process.execPath, ["scripts/gen-vectors.ts"], { cwd: root, encoding: "utf8" });
  assert.deepEqual(JSON.parse(regenerated), committed);
});

test("golden vectors are internally consistent and verify", () => {
  for (const v of committed.hashLeaf) assert.equal(hashLeaf(BigInt(v.lo), BigInt(v.hi)), v.out);
  for (const v of committed.hashNode) assert.equal(hashNode(v.left, v.right), v.out);
  const m = committed.nonMember;
  assert.deepEqual(m.isRight, pathDirections(m.index, committed.depth));
  const proof = { lo: BigInt(m.lo), hi: BigInt(m.hi), index: m.index, siblings: m.siblings };
  assert.deepEqual(verifyNonMembership(m.root, BigInt(m.key), proof, committed.depth), { valid: true });
});
