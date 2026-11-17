/**
 * Price inclusion proofs from Assetprice (CE-24). Off-circuit reference verifier.
 *
 * Assetprice returns a blended NOK price per asset and hour together with a Merkle inclusion proof against
 * a window root. The leaf is exactly `priceLeaf()` from reserves.ts. This module checks, with no network
 * access and no dependencies:
 *   1. the leaf is recomputed from the price point and equals the leaf in the response;
 *   2. the path leads to the window root in the response
 *      (`node = SHA-256(pad32("assetprice.node.v1") || left || right)`, an odd node moves up unchanged);
 *   3. the price is not stale and not from the future;
 *   4. optionally, the root equals the root read from the PriceAnchor contract for that window.
 * Only step 4 makes the price independently anchored. Without it the result says `anchored: false`.
 *
 * NOT covered: reading the on-chain root (the caller supplies it), the correctness of the blended price
 * itself (sources and method are Assetprice's responsibility, see `method` in the response), and that the
 * leaf index matches the path directions for the leaf count (the path is trusted only through the root).
 */
import { createHash } from "node:crypto";
import { priceLeaf, type PricePoint } from "./reserves.ts";

export type Hash = string; // lowercase hex

export const TAG_PRICE_NODE = "assetprice.node.v1";
export const DEFAULT_MAX_PRICE_AGE_SECONDS = 3600n;

export interface PriceProofResponse {
  compliance_engine_price_point: { asset: string; nokPerUnitE8: string; timestamp: string };
  leaf: Hash;
  leafIndex: number;
  proof: [Hash, "L" | "R"][];
  window: { windowNo: number | string; merkleRoot: Hash; serializationVersion: string };
}

export type PriceProofFailure =
  | "MALFORMED_INPUT"
  | "LEAF_MISMATCH"
  | "ROOT_MISMATCH"
  | "STALE_PRICE"
  | "FUTURE_PRICE"
  | "ANCHOR_MISMATCH"
  | "UNSUPPORTED_VERSION";

export type PriceProofResult =
  | { valid: true; price: PricePoint; windowNo: bigint; root: Hash; anchored: boolean }
  | { valid: false; reason: PriceProofFailure; detail: string };

export interface PriceProofOptions {
  /** Snapshot time, unix seconds. The price must be at most `maxPriceAgeSeconds` older and not newer. */
  nowSeconds: bigint;
  maxPriceAgeSeconds?: bigint;
  /** Root stored in the PriceAnchor contract for this window, if it was read. Undefined means not checked. */
  onChainRoot?: Hash;
}

const HEX64 = /^[0-9a-f]{64}$/;
const DIGITS = /^(0|[1-9][0-9]*)$/;
const U256_MAX = (1n << 256n) - 1n;

const sha = (...parts: Uint8Array[]): Hash => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};
const pad32 = (text: string): Buffer => {
  const b = Buffer.alloc(32);
  b.write(text, "ascii");
  return b;
};

const bad = (reason: PriceProofFailure, detail: string): PriceProofResult => ({ valid: false, reason, detail });

function parseUint(s: unknown): bigint | undefined {
  if (typeof s !== "string" || !DIGITS.test(s)) return undefined;
  const n = BigInt(s);
  return n <= U256_MAX ? n : undefined;
}

export function verifyPriceProof(resp: PriceProofResponse, opts: PriceProofOptions): PriceProofResult {
  const pp = resp?.compliance_engine_price_point;
  if (!pp || typeof pp.asset !== "string" || pp.asset.length === 0) return bad("MALFORMED_INPUT", "price point asset");
  const nokPerUnitE8 = parseUint(pp.nokPerUnitE8);
  const timestamp = parseUint(pp.timestamp);
  if (nokPerUnitE8 === undefined) return bad("MALFORMED_INPUT", "nokPerUnitE8 must be a decimal string");
  if (timestamp === undefined) return bad("MALFORMED_INPUT", "timestamp must be a decimal string");
  if (nokPerUnitE8 === 0n) return bad("MALFORMED_INPUT", "price is zero");
  if (typeof resp.leaf !== "string" || !HEX64.test(resp.leaf)) return bad("MALFORMED_INPUT", "leaf");
  const w = resp.window;
  if (!w || typeof w.merkleRoot !== "string" || !HEX64.test(w.merkleRoot)) return bad("MALFORMED_INPUT", "window.merkleRoot");
  if (w.serializationVersion !== "anchor-v1") return bad("UNSUPPORTED_VERSION", String(w.serializationVersion));
  const windowNo = parseUint(String(w.windowNo));
  if (windowNo === undefined) return bad("MALFORMED_INPUT", "window.windowNo");
  if (!Array.isArray(resp.proof) || resp.proof.length > 64) return bad("MALFORMED_INPUT", "proof");
  if (opts.onChainRoot !== undefined && !HEX64.test(opts.onChainRoot)) return bad("MALFORMED_INPUT", "onChainRoot");

  const price: PricePoint = { asset: pp.asset, nokPerUnitE8, timestamp };
  const leaf = priceLeaf(price);
  if (leaf !== resp.leaf) return bad("LEAF_MISMATCH", "leaf recomputed from the price point differs from the response");

  let h = leaf;
  for (const step of resp.proof) {
    if (!Array.isArray(step) || step.length !== 2 || typeof step[0] !== "string" || !HEX64.test(step[0])
      || (step[1] !== "L" && step[1] !== "R")) return bad("MALFORMED_INPUT", "proof step");
    const sibling = Buffer.from(step[0], "hex");
    const cur = Buffer.from(h, "hex");
    h = step[1] === "L" ? sha(pad32(TAG_PRICE_NODE), sibling, cur) : sha(pad32(TAG_PRICE_NODE), cur, sibling);
  }
  if (h !== w.merkleRoot) return bad("ROOT_MISMATCH", "path does not lead to the window root");

  const maxAge = opts.maxPriceAgeSeconds ?? DEFAULT_MAX_PRICE_AGE_SECONDS;
  if (timestamp > opts.nowSeconds) return bad("FUTURE_PRICE", "price timestamp is after the snapshot time");
  if (opts.nowSeconds - timestamp > maxAge) return bad("STALE_PRICE", `older than ${maxAge} seconds`);

  if (opts.onChainRoot !== undefined && opts.onChainRoot !== w.merkleRoot) {
    return bad("ANCHOR_MISMATCH", "window root differs from the root stored on chain");
  }
  return { valid: true, price, windowNo, root: w.merkleRoot, anchored: opts.onChainRoot !== undefined };
}
