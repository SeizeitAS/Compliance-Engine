/**
 * Sorted ("indexed") Merkle tree with non-membership proofs.
 *
 * Idea: sort the sanctioned keys k_1 < ... < k_n and add sentinels so that the
 * key space [0, 2^KEY_BITS) is partitioned into ranges. Each leaf commits to one
 * range (lo, hi) where hi is the next listed key after lo. A key x is NOT on the
 * list if and only if some committed leaf has lo < x < hi. The prover reveals no
 * list entries to the verifier in the circuit; in this reference implementation
 * the proof object contains the range so it can be tested and cross-checked
 * against the Compact circuit in contracts/AML_Gate.compact.
 *
 * Keys are the first KEY_BITS bits of SHA-256(domain || identifier). KEY_BITS is
 * kept in sync with the Uint<KEY_BITS> type in the circuit.
 */
import { createHash } from "node:crypto";

export const KEY_BITS = 128;
export const KEY_SPACE = 1n << BigInt(KEY_BITS); // exclusive upper sentinel
export const DEFAULT_DEPTH = 20; // up to ~1M listed keys (2^20 - 1)

export type Hash = string; // lowercase hex

export interface NonMembershipProof {
  lo: bigint;
  hi: bigint;
  index: number;
  siblings: Hash[]; // leaf-to-root
}

export type VerifyFailure =
  | "KEY_OUT_OF_DOMAIN"
  | "KEY_NOT_IN_RANGE"
  | "BAD_PATH_LENGTH"
  | "ROOT_MISMATCH";

export type VerifyResult = { valid: true } | { valid: false; reason: VerifyFailure };

const sha = (...parts: (string | Uint8Array)[]): Hash => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};

const fixedHex = (n: bigint): string => n.toString(16).padStart(KEY_BITS / 4 + 1, "0");

/** Domain-separated hashes: leaf, inner node and empty padding never collide. */
export const hashLeaf = (lo: bigint, hi: bigint): Hash =>
  sha("\x00", fixedHex(lo), fixedHex(hi));
export const hashNode = (l: Hash, r: Hash): Hash => sha("\x01", l, r);
const EMPTY_LEAF: Hash = sha("\x02");

/** Derive the tree key for an identifier (e.g. a normalised national-ID string). */
export function deriveKey(identifier: string, domain = "ce.sanctions.v1"): bigint {
  const digest = createHash("sha256").update(domain).update("\x00").update(identifier).digest();
  let k = 0n;
  for (let i = 0; i < KEY_BITS / 8; i++) k = (k << 8n) | BigInt(digest[i]);
  // 0 is reserved as the lower sentinel; map it to 1 (probability 2^-128).
  return k === 0n ? 1n : k;
}

export class SanctionsTree {
  readonly depth: number;
  readonly keys: bigint[];
  private readonly levels: Hash[][]; // levels[0] = leaves

  constructor(keys: Iterable<bigint>, depth = DEFAULT_DEPTH) {
    const sorted = [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const k of sorted) {
      if (k <= 0n || k >= KEY_SPACE) throw new RangeError("key outside (0, 2^KEY_BITS)");
    }
    if (sorted.length + 1 > 2 ** depth) throw new RangeError("tree depth too small for key count");
    this.depth = depth;
    this.keys = sorted;

    const leaves: Hash[] = [];
    for (let i = 0; i <= sorted.length; i++) {
      const lo = i === 0 ? 0n : sorted[i - 1];
      const hi = i === sorted.length ? KEY_SPACE : sorted[i];
      leaves.push(hashLeaf(lo, hi));
    }
    // Only materialise populated nodes; empty subtrees use precomputed defaults.
    this.levels = [leaves];
    for (let d = 0; d < depth; d++) {
      const cur = this.levels[d];
      const next: Hash[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hashNode(cur[i], i + 1 < cur.length ? cur[i + 1] : emptyAt(d)));
      }
      this.levels.push(next);
    }
  }

  get root(): Hash {
    return this.levels[this.depth][0];
  }

  has(key: bigint): boolean {
    return this.keys.includes(key);
  }

  /** Build a non-membership proof, or return null if the key IS on the list. */
  prove(key: bigint): NonMembershipProof | null {
    if (key <= 0n || key >= KEY_SPACE) throw new RangeError("key outside (0, 2^KEY_BITS)");
    if (this.has(key)) return null;
    // index = number of listed keys smaller than key
    let index = 0;
    while (index < this.keys.length && this.keys[index] < key) index++;
    const lo = index === 0 ? 0n : this.keys[index - 1];
    const hi = index === this.keys.length ? KEY_SPACE : this.keys[index];
    const siblings: Hash[] = [];
    let i = index;
    for (let d = 0; d < this.depth; d++) {
      const sib = i ^ 1;
      siblings.push(sib < this.levels[d].length ? this.levels[d][sib] : emptyAt(d));
      i >>= 1;
    }
    return { lo, hi, index, siblings };
  }
}

const emptyCache: Hash[] = [EMPTY_LEAF];
function emptyAt(level: number): Hash {
  while (emptyCache.length <= level) {
    const last = emptyCache[emptyCache.length - 1];
    emptyCache.push(hashNode(last, last));
  }
  return emptyCache[level];
}

/** Verify that `key` is not in the set committed to by `root`. Mirrors the circuit. */
export function verifyNonMembership(
  root: Hash,
  key: bigint,
  proof: NonMembershipProof,
  depth = DEFAULT_DEPTH,
): VerifyResult {
  if (key <= 0n || key >= KEY_SPACE) return { valid: false, reason: "KEY_OUT_OF_DOMAIN" };
  if (proof.siblings.length !== depth || proof.index < 0 || proof.index >= 2 ** depth) {
    return { valid: false, reason: "BAD_PATH_LENGTH" };
  }
  // Strict inequalities: key == lo or key == hi means the key IS listed.
  if (!(proof.lo < key && key < proof.hi)) return { valid: false, reason: "KEY_NOT_IN_RANGE" };
  let node = hashLeaf(proof.lo, proof.hi);
  let i = proof.index;
  for (const sib of proof.siblings) {
    node = i & 1 ? hashNode(sib, node) : hashNode(node, sib);
    i >>= 1;
  }
  return node === root ? { valid: true } : { valid: false, reason: "ROOT_MISMATCH" };
}
