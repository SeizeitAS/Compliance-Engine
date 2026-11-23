import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { verifyReservePackage, packageHash, challenge, holdingLeaf, type Holding, type PricePoint, type ReservePackage } from "../src/por/reserves.ts";
import { blake2b } from "../src/por/blake2b.ts";

const ROOT = "ab".repeat(32);
const PERIOD = 202611n;
const AS_OF = 1_793_000_000n;
const opts = { asOf: AS_OF };
const price = (asset: string, nokPerUnitE8: bigint): PricePoint => ({ asset, nokPerUnitE8, timestamp: AS_OF - 60n });
const pkg = (holdings: Holding[], prices: PricePoint[] = [price("ADA", 50_000_000n), price("NIGHT", 10_000_000n)]): ReservePackage => ({ period: PERIOD, liabilitiesRoot: ROOT, holdings, prices });
const reason = (r: { valid: boolean }) => (r as { reason: string }).reason;
const detail = (r: { valid: boolean }) => (r as { detail: string }).detail;

// ---- Cardano: a CIP-30 style proof built from generated keys ----
const head = (major: number, n: number): Buffer =>
  n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const bytes = (b: Uint8Array) => Buffer.concat([head(2, b.length), b]);
const text = (s: string) => Buffer.concat([head(3, s.length), Buffer.from(s)]);
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const edKey = (n: number) => {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, n)]), format: "der", type: "pkcs8" });
  return { priv, x: Buffer.from(createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32)) };
};
function cardanoHolding(seed: number, amount: bigint, mutate: (c: { protectedBytes: Buffer; payload: Buffer }) => void = () => undefined): Holding {
  const k = edKey(seed);
  const address = Buffer.concat([Buffer.from([0x00]), Buffer.from(blake2b(k.x, 28)), Buffer.alloc(28, 9)]);
  const addressHex = address.toString("hex");
  const payload = Buffer.from(challenge(PERIOD, ROOT, "cardano", addressHex), "hex");
  const parts = { protectedBytes: Buffer.concat([Buffer.from([0xa3, 0x01, 0x27, 0x04]), bytes(address), text("address"), bytes(address)]), payload };
  mutate(parts);
  const sigStructure = Buffer.concat([Buffer.from([0x84, 0x6a]), Buffer.from("Signature1"), bytes(parts.protectedBytes), Buffer.from([0x40]), bytes(payload)]);
  const sig = sign(null, sigStructure, k.priv);
  const signature = Buffer.concat([Buffer.from([0x84]), bytes(parts.protectedBytes), Buffer.from([0xa1]), text("hashed"), Buffer.from([0xf4]), bytes(parts.payload), bytes(sig)]).toString("hex");
  const key = Buffer.concat([Buffer.from([0xa4, 0x01, 0x01, 0x03, 0x27, 0x20, 0x06, 0x21]), bytes(k.x)]).toString("hex");
  return { chain: "cardano", address: addressHex, asset: "ADA", amount, decimals: 6, snapshotHeight: 1000n, control: { scheme: "cip30-ed25519", signature, key, network: 0 } };
}

// ---- Midnight: signatures made by the ledger's signData over the framed challenge (throwaway keys, 2 holdings) ----
const MN = [
  { vk: "af0553c4bc93087aa54dd6c88f05ad7936a98bf8496bb13159bccd1298eb99c2", address: "2c98e07df829a37a62fff73745fe60f8970a71586a2fbb064f4829ffd69f4be3",
    challenge: "775ce1f4f2cd6f977e0362917394013f8b442b8e74c230f33f1efef6908c0936",
    signature: "6f72b219d3f5d838dd6357e2995cf925a4ec69c0840626790e1940b0368593c7e4e3df2e71ebc54d731010f358c782fdc8fbb08695dbaba7352a0cf083178e2e" },
  { vk: "8f6f991c5b40f7a9f9025fd2e8f707c22eb14aaa86491be9aaace85ecf0bf1dd", address: "46c17e1156e207edeeb2f8ee7768ff9210c90eb8e45a6f15bc3a95ac6adf9ff9",
    challenge: "60b186d20392caf271c9235fe56c691a75e0f4a24de49fed6744b35b6cb5687a",
    signature: "ed938d94c289a464a3e332b8e83eace8ac5166a654feda3b62fd658c401e4167fdc74fbd63e84d55e01523ea6423b2302f2b4e60bfffb3381c259e58358b8a8a" },
];
const midnightHolding = (i: number, amount: bigint, extra: Partial<Holding> = {}): Holding => ({
  chain: "midnight", address: MN[i]!.address, asset: "NIGHT", amount, decimals: 6, snapshotHeight: 500n,
  control: { scheme: "midnight-unshielded", verifyingKey: MN[i]!.vk, signature: MN[i]!.signature }, ...extra,
});

test("the Midnight test vectors were signed over this package's challenge", () => {
  for (let i = 0; i < 2; i++) assert.equal(challenge(PERIOD, ROOT, "midnight", MN[i]!.address), MN[i]!.challenge);
});

test("a package with a Cardano CIP-30 holding and a Midnight holding verifies and counts both", () => {
  const ada = cardanoHolding(1, 1_000_000_000n); // 1000 ADA at 0.50 NOK = 50_000 ore
  const night = midnightHolding(0, 5_000_000_000n); // 5000 NIGHT at 0.10 NOK = 50_000 ore
  const r = verifyReservePackage(pkg([ada, night]), 100_000n, opts);
  assert.ok(r.valid, r.valid ? "" : r.detail);
  if (r.valid) {
    assert.equal(r.reserves, 100_000n);
    assert.ok(r.lines.every((l) => l.counted && l.kind === "control-proof"));
  }
});

test("a proof for another period, another root or another address is rejected", () => {
  const h = cardanoHolding(1, 1_000_000_000n);
  const r1 = verifyReservePackage({ ...pkg([h]), period: PERIOD + 1n }, 50_000n, opts);
  assert.equal(reason(r1), "BAD_CONTROL_PROOF");
  assert.match(detail(r1), /PAYLOAD_MISMATCH/);
  const r2 = verifyReservePackage({ ...pkg([h]), liabilitiesRoot: "cd".repeat(32) }, 50_000n, opts);
  assert.equal(reason(r2), "BAD_CONTROL_PROOF");
  const n = midnightHolding(0, 1n);
  assert.equal(reason(verifyReservePackage({ ...pkg([n]), period: PERIOD + 1n }, 0n, opts)), "BAD_CONTROL_PROOF");
  assert.equal(reason(verifyReservePackage(pkg([midnightHolding(1, 1n, { address: MN[0]!.address })]), 0n, opts)), "BAD_CONTROL_PROOF");
});

test("a tampered Cardano or Midnight proof is rejected", () => {
  const bad = cardanoHolding(1, 1_000_000_000n);
  const c = bad.control as { signature: string };
  c.signature = c.signature.slice(0, -2) + (c.signature.endsWith("00") ? "01" : "00");
  assert.equal(reason(verifyReservePackage(pkg([bad]), 50_000n, opts)), "BAD_CONTROL_PROOF");
  const n = midnightHolding(0, 1n);
  const m = n.control as { signature: string };
  m.signature = m.signature.slice(0, -1) + (m.signature.endsWith("0") ? "1" : "0");
  assert.equal(reason(verifyReservePackage(pkg([n]), 0n, opts)), "BAD_CONTROL_PROOF");
});

test("a script address cannot prove control", () => {
  const h = cardanoHolding(1, 1n);
  const script = { ...h, address: "10" + h.address.slice(2) }; // type 1: script payment credential
  assert.equal(reason(verifyReservePackage(pkg([script]), 0n, opts)), "BAD_CONTROL_PROOF");
});

test("a scheme must match its chain, and unknown schemes fail closed", () => {
  const ada = cardanoHolding(1, 1n);
  const wrongChain = { ...ada, chain: "ethereum" };
  assert.equal(reason(verifyReservePackage(pkg([wrongChain]), 0n, opts)), "UNSUPPORTED_CONTROL_SCHEME");
  const night = midnightHolding(0, 1n, { chain: "cardano" });
  assert.equal(reason(verifyReservePackage(pkg([night]), 0n, opts)), "UNSUPPORTED_CONTROL_SCHEME");
  const unknown = { ...ada, control: { scheme: "made-up", signature: "00", key: "00" } as unknown as Holding["control"] };
  assert.equal(reason(verifyReservePackage(pkg([unknown]), 0n, opts)), "UNSUPPORTED_CONTROL_SCHEME");
});

test("malformed tagged proofs are rejected before verification", () => {
  const ada = cardanoHolding(1, 1n);
  const bad = { ...ada, control: { ...(ada.control as object), signature: "zz" } as Holding["control"] };
  assert.equal(reason(verifyReservePackage(pkg([bad]), 0n, opts)), "MALFORMED_INPUT");
  const night = midnightHolding(0, 1n);
  const badNight = { ...night, control: { ...(night.control as object), verifyingKey: "ab" } as Holding["control"] };
  assert.equal(reason(verifyReservePackage(pkg([badNight]), 0n, opts)), "MALFORMED_INPUT");
});

test("the package hash covers the scheme, the signature and the key", () => {
  const a = cardanoHolding(1, 1n), b = cardanoHolding(2, 1n);
  assert.notEqual(holdingLeaf(a), holdingLeaf(b));
  assert.notEqual(packageHash(pkg([a])), packageHash(pkg([b])));
  const night = midnightHolding(0, 1n);
  const other = { ...night, control: { ...(night.control as object), verifyingKey: MN[1]!.vk } as Holding["control"] };
  assert.notEqual(holdingLeaf(night), holdingLeaf(other));
  // order does not matter
  assert.equal(packageHash(pkg([a, night])), packageHash(pkg([night, a])));
});

test("a raw ed25519 holding keeps its v1 leaf (earlier reports stay valid)", () => {
  const raw: Holding = { chain: "test", address: "aa", asset: "ADA", amount: 1n, decimals: 6, snapshotHeight: 1n, control: { publicKey: "11".repeat(32), signature: "22".repeat(64) } };
  const tagged: Holding = { ...raw, control: { scheme: "midnight-unshielded", verifyingKey: "11".repeat(32), signature: "22".repeat(64) } };
  assert.notEqual(holdingLeaf(raw), holdingLeaf(tagged));
});
