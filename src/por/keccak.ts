/**
 * Keccak-256 (the original Keccak padding that Ethereum uses, NOT the NIST SHA3-256 padding). `node:crypto` offers
 * only SHA3-256. BigInt implementation for short inputs, no dependencies (CONTRIBUTING.md rule 3). The permutation and
 * absorb logic are validated by running the same sponge with the SHA3 padding byte against `node:crypto`'s sha3-256
 * for many lengths, and the Keccak padding against known Ethereum vectors; see test/keccak.test.ts.
 */
const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// rotation offsets ROT[x][y]
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const rotl = (x: bigint, n: number): bigint => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK);

function keccakF(a: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const c: bigint[] = [];
    for (let x = 0; x < 5; x++) c[x] = a[x]! ^ a[x + 5]! ^ a[x + 10]! ^ a[x + 15]! ^ a[x + 20]!;
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 5; y++) a[x + 5 * y] = a[x + 5 * y]! ^ d;
    }
    const b: bigint[] = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y]!, ROT[x]![y]!);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) a[x + 5 * y] = b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & MASK & b[((x + 2) % 5) + 5 * y]!);
    }
    a[0] = a[0]! ^ RC[round]!;
  }
}

/** The sponge with a 256-bit output. `domain` is 0x01 for Keccak (Ethereum) and 0x06 for NIST SHA3. */
export function sponge256(data: Uint8Array, domain: number): Uint8Array {
  const rate = 136; // 1088 bits
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] ^= domain;
  padded[padded.length - 1] ^= 0x80;
  const a: bigint[] = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let w = 0n;
      for (let j = 7; j >= 0; j--) w = (w << 8n) | BigInt(padded[off + i * 8 + j]!);
      a[i] = a[i]! ^ w;
    }
    keccakF(a);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let w = a[i]!;
    for (let j = 0; j < 8; j++) { out[i * 8 + j] = Number(w & 0xffn); w >>= 8n; }
  }
  return out;
}

/** Keccak-256 as used by Ethereum (addresses, `personal_sign` message hash). */
export const keccak256 = (data: Uint8Array): Uint8Array => sponge256(data, 0x01);
