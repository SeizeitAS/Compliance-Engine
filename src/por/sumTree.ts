/**
 * Merkle SUM tree for proof of reserves (CE-6). Reference implementation of the structure verified
 * by contracts/PoR.compact.
 *
 * Every node carries (hash, sum). A parent hash covers both children hashes AND sums, so the
 * root commits to the total liability: nobody can shrink a sub-total without changing the root.
 * Balances are non-negative bigints (NOK minor units) that must fit Uint<64>; sums fit Uint<128>.
 * Layout mirrors the circuit: H(tag32 || words) over 32-byte words, numbers 32-byte little-endian.
 */
import { createHash } from "node:crypto";

export const DEPTH = 20; // up to 2^20 (about 1M) accounts
export const MAX_BALANCE = (1n << 64n) - 1n;
export const MAX_SUM = (1n << 128n) - 1n;

export type Hash = string; // lowercase hex
export interface SumNode {
  hash: Hash;
  sum: bigint;
}
export interface Account {
  accountIdHash: Hash;
  salt: Hash;
  balance: bigint;
}
export interface InclusionProof {
  account: Account;
  index: number;
  siblingHashes: Hash[]; // leaf-to-root
  siblingSums: bigint[];
}

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
const num32 = (n: bigint): Buffer => {
  const b = Buffer.alloc(32);
  for (let i = 0, v = n; i < 32 && v > 0n; i++, v >>= 8n) b[i] = Number(v & 0xffn);
  return b;
};
const hex32 = (h: Hash): Buffer => Buffer.from(h, "hex");

export const TAG_LEAF = "ce.por.leaf.v1";
export const TAG_NODE = "ce.por.node.v1";
export const TAG_EMPTY = "ce.por.empty.v1";

export const hashLeaf = (a: Account): Hash => {
  if (a.balance < 0n || a.balance > MAX_BALANCE) throw new RangeError("balance outside Uint<64>");
  return sha(pad32(TAG_LEAF), hex32(a.accountIdHash), hex32(a.salt), num32(a.balance));
};
export const leafNode = (a: Account): SumNode => ({ hash: hashLeaf(a), sum: a.balance });

export function hashNode(l: SumNode, r: SumNode): SumNode {
  const sum = l.sum + r.sum;
  if (sum > MAX_SUM) throw new RangeError("sum exceeds Uint<128>");
  return { hash: sha(pad32(TAG_NODE), hex32(l.hash), num32(l.sum), hex32(r.hash), num32(r.sum)), sum };
}

const EMPTY: SumNode = { hash: sha(pad32(TAG_EMPTY)), sum: 0n };
const emptyCache: SumNode[] = [EMPTY];
const emptyAt = (level: number): SumNode => {
  while (emptyCache.length <= level) {
    const last = emptyCache[emptyCache.length - 1];
    emptyCache.push(hashNode(last, last));
  }
  return emptyCache[level];
};

export class LiabilityTree {
  readonly depth: number;
  readonly accounts: Account[];
  private readonly levels: SumNode[][];

  constructor(accounts: Account[], depth = DEPTH) {
    if (accounts.length > 2 ** depth) throw new RangeError("tree depth too small for account count");
    this.depth = depth;
    this.accounts = accounts;
    this.levels = [accounts.map(leafNode)];
    for (let d = 0; d < depth; d++) {
      const cur = this.levels[d];
      const next: SumNode[] = [];
      for (let i = 0; i < Math.max(cur.length, 1); i += 2) {
        next.push(hashNode(cur[i] ?? emptyAt(d), i + 1 < cur.length ? cur[i + 1] : emptyAt(d)));
      }
      this.levels.push(next);
    }
  }

  get root(): SumNode {
    return this.levels[this.depth][0];
  }

  /** The two children of the root: what the circuit takes as private witnesses. */
  rootChildren(): { left: SumNode; right: SumNode } {
    const top = this.levels[this.depth - 1];
    return { left: top[0], right: top[1] ?? emptyAt(this.depth - 1) };
  }

  prove(index: number): InclusionProof {
    if (index < 0 || index >= this.accounts.length) throw new RangeError("no such account index");
    const siblingHashes: Hash[] = [];
    const siblingSums: bigint[] = [];
    let i = index;
    for (let d = 0; d < this.depth; d++) {
      const sib = i ^ 1;
      const node = sib < this.levels[d].length ? this.levels[d][sib] : emptyAt(d);
      siblingHashes.push(node.hash);
      siblingSums.push(node.sum);
      i >>= 1;
    }
    return { account: this.accounts[index], index, siblingHashes, siblingSums };
  }
}

export const pathDirections = (index: number, depth: number): boolean[] =>
  Array.from({ length: depth }, (_, d) => ((index >> d) & 1) === 1);

/** Recompute (root hash, total) from one account path. Mirrors the circuit verify_inclusion. */
export function recomputeRoot(p: InclusionProof, depth = DEPTH): SumNode {
  if (p.siblingHashes.length !== depth || p.siblingSums.length !== depth) throw new RangeError("bad path length");
  let node = leafNode(p.account);
  let i = p.index;
  for (let d = 0; d < depth; d++) {
    const sib: SumNode = { hash: p.siblingHashes[d], sum: p.siblingSums[d] };
    node = i & 1 ? hashNode(sib, node) : hashNode(node, sib);
    i >>= 1;
  }
  return node;
}

/** Customer check: does my account path lead to the published root, with this total? */
export function verifyInclusion(root: SumNode, p: InclusionProof, depth = DEPTH): boolean {
  try {
    const r = recomputeRoot(p, depth);
    return r.hash === root.hash && r.sum === root.sum;
  } catch {
    return false;
  }
}

/** Solvency: reserves must cover the total the root commits to. */
export const isSolvent = (root: SumNode, reserves: bigint): boolean => reserves >= root.sum;
