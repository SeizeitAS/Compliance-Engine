/**
 * secp256k1 group arithmetic in BigInt, shared by the BIP-340 verifier (./schnorr.ts) and the Ethereum signature
 * recovery (./evm.ts). Affine coordinates, not constant time: it only handles public data (verification and
 * recovery), never a secret key. No dependencies (CONTRIBUTING.md rule 3).
 */
export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

export type Point = { x: bigint; y: bigint } | null; // null = point at infinity
export const G: Point = { x: GX, y: GY };
export const mod = (a: bigint, m: bigint): bigint => ((a % m) + m) % m;

export function inv(a: bigint, m: bigint): bigint {
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("not invertible");
  return mod(s0, m);
}
export function pow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b = mod(b, m);
  for (; e > 0n; e >>= 1n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
  }
  return r;
}
export function add(a: Point, b: Point): Point {
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
export function mul(p: Point, k: bigint): Point {
  let r: Point = null;
  let q = p;
  for (; k > 0n; k >>= 1n) {
    if (k & 1n) r = add(r, q);
    q = add(q, q);
  }
  return r;
}

/** The curve point with this x and a y of the requested parity, or null if x is not the x of a curve point. */
export function liftX(x: bigint, odd: boolean): Point {
  if (x < 0n || x >= P) return null;
  const c = mod(x * x * x + 7n, P);
  const y = pow(c, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== c) return null;
  return { x, y: (y % 2n === 1n) === odd ? y : P - y };
}
