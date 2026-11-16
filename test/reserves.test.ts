import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  verifyReservePackage, packageHash, attestation, challenge, holdingValue,
  type Holding, type PricePoint, type ReservePackage,
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

function holding(seed: number, amount: bigint, extra: Partial<Holding> = {}, period = PERIOD, root = ROOT): Holding {
  const k = keyFromSeed(seed);
  const h: Holding = {
    chain: "test", address: k.address, asset: "ADA", amount, decimals: 6, snapshotHeight: 1000n,
    control: { publicKey: k.publicKey, signature: "" }, ...extra,
  };
  h.control.signature = sign(null, Buffer.from(challenge(period, root, h.chain, h.address), "hex"), k.priv).toString("hex");
  return h;
}
const price = (asset: string, nokPerUnitE8: bigint, ts = AS_OF - 60n): PricePoint => ({ asset, nokPerUnitE8, timestamp: ts });
const pkg = (holdings: Holding[], prices: PricePoint[] = [price("ADA", 50_000_000n)]): ReservePackage => ({
  period: PERIOD, liabilitiesRoot: ROOT, holdings, prices,
});
const opts = { asOf: AS_OF };

// 1,000 ADA = 1_000_000_000 lovelace at 0.50 NOK = 500 NOK = 50_000 ore
const ADA_1000 = 1_000_000_000n;

test("valuation is integer, in ore, and rounds down", () => {
  assert.equal(holdingValue(holding(1, ADA_1000), price("ADA", 50_000_000n)), 50_000n);
  // 1 lovelace at 0.5 NOK is far below one ore: floor to 0
  assert.equal(holdingValue(holding(1, 1n), price("ADA", 50_000_000n)), 0n);
  // haircut 20 percent
  assert.equal(holdingValue(holding(1, ADA_1000, { haircutBps: 2000 }), price("ADA", 50_000_000n)), 40_000n);
});

test("a valid package verifies and yields the on-chain hashes", () => {
  const p = pkg([holding(1, ADA_1000), holding(2, 2n * ADA_1000)]);
  const r = verifyReservePackage(p, 150_000n, opts);
  assert.ok(r.valid);
  if (r.valid) {
    assert.equal(r.packageHash, packageHash(p));
    assert.equal(r.attestation, attestation(PERIOD, ROOT, 150_000n, r.packageHash));
  }
});

test("package hash does not depend on holding or price order", () => {
  const a = holding(1, ADA_1000), b = holding(2, 5n);
  const prices = [price("ADA", 50_000_000n), price("NIGHT", 1_000_000n)];
  assert.equal(packageHash(pkg([a, b], prices)), packageHash(pkg([b, a], [...prices].reverse())));
});

test("a wrong claimed reserve figure is rejected", () => {
  const r = verifyReservePackage(pkg([holding(1, ADA_1000)]), 50_001n, opts);
  assert.deepEqual(r.valid ? null : r.reason, "RESERVES_MISMATCH");
});

test("tampering with the amount invalidates the control proof via the package or the total", () => {
  const h = holding(1, ADA_1000);
  const inflated = { ...h, amount: 10n * ADA_1000 };
  const r = verifyReservePackage(pkg([inflated]), 500_000n, opts);
  // the signature covers period, root and address, not the amount: the amount is checked against the
  // chain by the auditor. The package hash must change, so the on-chain attestation will not match.
  assert.ok(r.valid);
  assert.notEqual(packageHash(pkg([inflated])), packageHash(pkg([h])));
});

test("control proof for another period or another root is rejected (no replay)", () => {
  const otherPeriod = holding(1, ADA_1000, {}, PERIOD - 1n);
  assert.equal((verifyReservePackage(pkg([otherPeriod]), 50_000n, opts) as { reason: string }).reason, "BAD_CONTROL_PROOF");
  const otherRoot = holding(1, ADA_1000, {}, PERIOD, "cd".repeat(32));
  assert.equal((verifyReservePackage(pkg([otherRoot]), 50_000n, opts) as { reason: string }).reason, "BAD_CONTROL_PROOF");
});

test("a signature by a key that does not own the address is rejected", () => {
  const mine = holding(1, ADA_1000);
  const stolen = { ...mine, address: keyFromSeed(2).address };
  const r = verifyReservePackage(pkg([stolen]), 50_000n, opts);
  assert.equal(r.valid ? "" : r.reason, "ADDRESS_KEY_MISMATCH");
  const forged = { ...mine, control: { ...mine.control, signature: "00".repeat(64) } };
  assert.equal((verifyReservePackage(pkg([forged]), 50_000n, opts) as { reason: string }).reason, "BAD_CONTROL_PROOF");
  const malformed = { ...mine, control: { ...mine.control, signature: "zz" } };
  assert.equal((verifyReservePackage(pkg([malformed]), 50_000n, opts) as { reason: string }).reason, "BAD_CONTROL_PROOF");
});

test("real chains fail closed until address derivation is injected", () => {
  const h = holding(1, ADA_1000, { chain: "cardano" });
  assert.equal((verifyReservePackage(pkg([h]), 50_000n, opts) as { reason: string }).reason, "ADDRESS_DERIVATION_UNSUPPORTED");
  const ok = verifyReservePackage(pkg([h]), 50_000n, { ...opts, deriveAddress: () => h.address });
  assert.ok(ok.valid);
});

test("prices: missing, duplicate, stale and future are rejected", () => {
  const h = holding(1, ADA_1000);
  const code = (p: ReservePackage) => (verifyReservePackage(p, 50_000n, opts) as { reason: string }).reason;
  assert.equal(code(pkg([h], [])), "MISSING_PRICE");
  assert.equal(code(pkg([h], [price("ADA", 1n), price("ADA", 2n)])), "DUPLICATE_PRICE");
  assert.equal(code(pkg([h], [price("ADA", 50_000_000n, AS_OF - 3601n)])), "STALE_PRICE");
  assert.equal(code(pkg([h], [price("ADA", 50_000_000n, AS_OF + 1n)])), "FUTURE_PRICE");
});

test("duplicate holdings and out-of-range fields are rejected", () => {
  const h = holding(1, ADA_1000);
  assert.equal((verifyReservePackage(pkg([h, h]), 100_000n, opts) as { reason: string }).reason, "DUPLICATE_HOLDING");
  const bad = holding(1, ADA_1000, { haircutBps: 10001 });
  assert.equal((verifyReservePackage(pkg([bad]), 0n, opts) as { reason: string }).reason, "BAD_HOLDING");
  const neg = holding(1, -1n);
  assert.equal((verifyReservePackage(pkg([neg]), 0n, opts) as { reason: string }).reason, "BAD_HOLDING");
});

test("the attestation differs per period, root, reserves and package", () => {
  const base = attestation(PERIOD, ROOT, 5n, "11".repeat(32));
  assert.notEqual(base, attestation(PERIOD + 1n, ROOT, 5n, "11".repeat(32)));
  assert.notEqual(base, attestation(PERIOD, "cd".repeat(32), 5n, "11".repeat(32)));
  assert.notEqual(base, attestation(PERIOD, ROOT, 6n, "11".repeat(32)));
  assert.notEqual(base, attestation(PERIOD, ROOT, 5n, "22".repeat(32)));
});
