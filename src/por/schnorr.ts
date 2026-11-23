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

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

type Point = { x: bigint; y: bigint } | null; // null = point at infinity
const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

function inv(a: bigint, m: bigint): bigint {
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("not invertible");
  return mod(s0, m);
}
function pow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b = mod(b, m);
  for (; e > 0n; e >>= 1n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
  }
  return r;
}
function add(a: Point, b: Point): Point {
  if (a === null) return b;
  if (b === null) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, P) === 0n) return null;
    const l = mod(3n * a.x * a.x * inv(2n * a.y, P), P);
    const x = mod(l * l - 2n * a.x, P);
    return { x, y: mod(l * (a.x - x) - a.y, P) };
  }
  const l = mod((b.y - a.y) * inv(b.x - a.x, P), P);
  const x = mod(l * l - a.x - b.x, P);
  return { x, y: mod(l * (a.x - x) - a.y, P) };
}
function mul(p: Point, k: bigint): Point {
  let r: Point = null;
  let q = p;
  for (; k > 0n; k >>= 1n) {
    if (k & 1n) r = add(r, q);
    q = add(q, q);
  }
  return r;
}
const G: Point = { x: GX, y: GY };

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

/** The curve point with even y for an x-only key, or null if x is not on the curve. */
function liftX(x: bigint): Point {
  if (x >= P) return null;
  const c = mod(x * x * x + 7n, P);
  const y = pow(c, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== c) return null;
  return { x, y: y % 2n === 0n ? y : P - y };
}

/** Verify a BIP-340 signature: `publicKey` 32 bytes (x-only), `signature` 64 bytes, any message length. */
export function schnorrVerify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    if (publicKey.length !== 32 || signature.length !== 64) return false;
    const pub = liftX(toInt(publicKey));
    if (pub === null) return false;
    const r = toInt(signature.subarray(0, 32));
    const s = toInt(signature.subarray(32));
    if (r >= P || s >= N) return false;
    const e = toInt(taggedHash("BIP0340/challenge", signature.subarray(0, 32), publicKey, message)) % N;
    const point = add(mul(G, s), mul(pub, mod(N - e, N)));
    return point !== null && point.y % 2n === 0n && point.x === r;
  } catch {
    return false;
  }
}
