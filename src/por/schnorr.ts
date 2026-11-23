/**
 * BIP-340 Schnorr signature verification over secp256k1 (verification only). Written in BigInt, no dependencies,
 * for the Midnight control proof (CE-21, `midnight-unshielded`): Midnight's unshielded keys are BIP-340 x-only keys,
 * and `node:crypto` has no Schnorr. Not constant time, which does not matter here: it only handles public data.
 * Tested against the official BIP-340 vectors, against signatures made by the Midnight ledger's own `signData`
 * (ledger-v9) and against a real Lace signature; see test/midnight.test.ts. Any message length is accepted, as in
 * BIP-340 as amended. NOTE: the Midnight ledger's `signData` signs the SHA-256 digest of the data it is given, so
 * callers that verify Midnight signatures pass the digest as the message (see midnight.ts).
 */
import { createHash } from "node:crypto";
import { G, N, P, add, liftX, mul, mod as modulo } from "./secp256k1.ts";

const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
const taggedHash = (tag: string, ...parts: Uint8Array[]): Buffer => {
  const t = sha256(Buffer.from(tag, "utf8"));
  return sha256(t, t, ...parts);
};
const toInt = (b: Uint8Array): bigint => BigInt("0x" + (b.length ? Buffer.from(b).toString("hex") : "0"));

/** Verify a BIP-340 signature: `publicKey` 32 bytes (x-only), `signature` 64 bytes, any message length. */
export function schnorrVerify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    const pub = liftX(toInt(publicKey), false); // BIP-340 keys are x-only: the point with even y
    if (pub === null) return false;
    const r = toInt(signature.subarray(0, 32));
    const s = toInt(signature.subarray(32));
    if (r >= P || s >= N) return false;
    const e = toInt(taggedHash("BIP0340/challenge", signature.subarray(0, 32), publicKey, message)) % N;
    const point = add(mul(G, s), mul(pub, modulo(N - e, N)));
    return point !== null && point.y % 2n === 0n && point.x === r;
  } catch {
    return false;
  }
}
