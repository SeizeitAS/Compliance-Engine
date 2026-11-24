/**
 * Record format and commitment for the rule API (CE-34, `docs/rule-api.md`).
 *
 * A `LedgerRecord` is one movement as a source stated it. The set of records is committed as a Merkle tree over the
 * records sorted by id, so the order they arrive in does not matter, and a record can later be shown to belong to the
 * committed set with a path (selective disclosure) without showing the others.
 */
import { type Hash, sha, pad32, num32, field, hexBytes, isHash } from "./hash.ts";

/** One movement. Amounts are integers in the asset's base unit; values in NOK are integers in ore. */
export interface LedgerRecord {
  id: string; // unique within the set, stable across runs
  time: bigint; // unix seconds, UTC
  asset: string;
  amount: bigint; // base units, signed (inflow positive)
  /** Absolute value in NOK ore from a committed price. Absent when no price exists: packs treat that as a finding. */
  valueNokOre?: bigint;
  priceRef?: Hash; // hash of the price point used; required when valueNokOre is present
  counterparty?: string; // as stated by the source
  counterpartyClass?: string; // "exchange" | "own-wallet" | "bank" | "unknown" ...
  jurisdiction?: string; // ISO 3166 code if the source states it
  sourceDocument: Hash; // hash of the statement or export the record came from
  evidence: Hash[]; // hashes of vouchers or approvals attached in the books
}

export const MAX_ABS = (1n << 128n) - 1n;
export const TAG_RECORD = "ce.review.record.v1";
export const TAG_NODE = "ce.review.node.v1";
export const TAG_EMPTY = "ce.review.empty.v1";
export const TAG_ROOT = "ce.review.root.v1";

const isInt = (n: unknown): n is bigint => typeof n === "bigint";
const optText = (s: unknown) => s === undefined || (typeof s === "string" && s.length > 0 && s.length <= 256);

/** `undefined` when the record is well formed, otherwise what is wrong. A record that fails is never silently skipped. */
export function checkRecord(r: LedgerRecord): string | undefined {
  if (typeof r !== "object" || r === null) return "record is not an object";
  if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 256) return "id must be a non-empty string";
  if (!isInt(r.time) || r.time < 0n || r.time >= 1n << 64n) return `${r.id}: time must be unix seconds`;
  if (typeof r.asset !== "string" || r.asset.length === 0 || r.asset.length > 64) return `${r.id}: asset must be a non-empty string`;
  if (!isInt(r.amount) || r.amount > MAX_ABS || r.amount < -MAX_ABS) return `${r.id}: amount must be an integer`;
  if (r.valueNokOre !== undefined && (!isInt(r.valueNokOre) || r.valueNokOre < 0n || r.valueNokOre > MAX_ABS)) return `${r.id}: valueNokOre must be a non-negative integer`;
  if (r.valueNokOre !== undefined && !isHash(r.priceRef)) return `${r.id}: a valued record needs the hash of its price (priceRef)`;
  if (r.priceRef !== undefined && !isHash(r.priceRef)) return `${r.id}: priceRef must be a hash`;
  if (!optText(r.counterparty) || !optText(r.counterpartyClass) || !optText(r.jurisdiction)) return `${r.id}: counterparty fields must be short non-empty text`;
  if (!isHash(r.sourceDocument)) return `${r.id}: sourceDocument must be a hash`;
  if (!Array.isArray(r.evidence) || r.evidence.some((e) => !isHash(e)) || new Set(r.evidence).size !== r.evidence.length) return `${r.id}: evidence must be a list of distinct hashes`;
  return undefined;
}

const opt = (b: Buffer | undefined): Buffer => (b === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), b]));
const optField = (s: string | undefined) => opt(s === undefined ? undefined : field(s));

export const recordLeaf = (r: LedgerRecord): Hash =>
  sha(
    pad32(TAG_RECORD), field(r.id), num32(r.time), field(r.asset),
    Buffer.from([r.amount < 0n ? 1 : 0]), num32(r.amount < 0n ? -r.amount : r.amount),
    opt(r.valueNokOre === undefined ? undefined : num32(r.valueNokOre)), opt(r.priceRef === undefined ? undefined : hexBytes(r.priceRef)),
    optField(r.counterparty), optField(r.counterpartyClass), optField(r.jurisdiction),
    hexBytes(r.sourceDocument), num32(BigInt(r.evidence.length)), ...[...r.evidence].sort().map(hexBytes),
  );

const EMPTY: Hash = sha(pad32(TAG_EMPTY));
const node = (l: Hash, r: Hash): Hash => sha(pad32(TAG_NODE), hexBytes(l), hexBytes(r));
export const byId = (a: LedgerRecord, b: LedgerRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function levels(sorted: LedgerRecord[]): Hash[][] {
  const out: Hash[][] = [sorted.map(recordLeaf)];
  while (out[out.length - 1]!.length > 1) {
    const cur = out[out.length - 1]!;
    const next: Hash[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(node(cur[i]!, i + 1 < cur.length ? cur[i + 1]! : EMPTY));
    out.push(next);
  }
  return out;
}
/** The count is part of the root, so a tree cannot be extended with empty leaves or shortened without changing it. */
const rootOf = (top: Hash, count: number): Hash => sha(pad32(TAG_ROOT), num32(BigInt(count)), hexBytes(top));

export interface Commitment { root: Hash; count: number }

/** Order-independent commitment to a set of records. Throws if two records share an id or a record is malformed. */
export function commitRecords(records: readonly LedgerRecord[]): Commitment {
  const sorted = validSorted(records);
  const lv = levels(sorted);
  return { root: rootOf(lv.length === 0 || lv[0]!.length === 0 ? EMPTY : lv[lv.length - 1]![0]!, sorted.length), count: sorted.length };
}

function validSorted(records: readonly LedgerRecord[]): LedgerRecord[] {
  for (const r of records) {
    const bad = checkRecord(r);
    if (bad !== undefined) throw new Error(bad);
  }
  const sorted = [...records].sort(byId);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.id === sorted[i - 1]!.id) throw new Error(`duplicate record id ${sorted[i]!.id}`);
  return sorted;
}

/** Position of a record in the sorted set, with the sibling hashes from leaf to root. */
export interface RecordPath { index: number; count: number; siblings: Hash[] }

export function recordPath(records: readonly LedgerRecord[], id: string): RecordPath {
  const sorted = validSorted(records);
  const index = sorted.findIndex((r) => r.id === id);
  if (index < 0) throw new RangeError(`no record ${id}`);
  const lv = levels(sorted);
  const siblings: Hash[] = [];
  let i = index;
  for (let d = 0; d < lv.length - 1; d++) {
    siblings.push(lv[d]![i ^ 1] ?? EMPTY);
    i >>= 1;
  }
  return { index, count: sorted.length, siblings };
}

/** True when `record` is the leaf at `path.index` of a set of `path.count` records with this root. Never throws. */
export function verifyRecordPath(root: Hash, record: LedgerRecord, path: RecordPath): boolean {
  if (checkRecord(record) !== undefined || !isHash(root)) return false;
  if (!Number.isSafeInteger(path.index) || !Number.isSafeInteger(path.count) || path.index < 0 || path.index >= path.count) return false;
  let depth = 0;
  for (let n = path.count; n > 1; n = Math.ceil(n / 2)) depth++;
  if (!Array.isArray(path.siblings) || path.siblings.length !== depth || path.siblings.some((s) => !isHash(s))) return false;
  let h = recordLeaf(record), i = path.index;
  for (const s of path.siblings) {
    h = i % 2 === 0 ? node(h, s) : node(s, h);
    i >>= 1;
  }
  return rootOf(h, path.count) === root;
}
