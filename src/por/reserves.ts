/**
 * Reserve side of the Proof of Reserves (CE-6 follow-up). Off-circuit reference verifier.
 *
 * The Compact circuit cannot check signatures of other chains or read their balances, so the reserve
 * figure is bound to a signed, hashed RESERVE PACKAGE instead:
 *   - holdings: chain, address, asset, amount in base units, snapshot height, optional haircut;
 *   - a control proof per holding: an ed25519 signature, by the key behind the address, over a
 *     challenge that commits to the period and the liabilities root (no replay for another report);
 *   - prices: NOK per whole unit (scaled 1e8) with a timestamp, from the Assetprice oracle.
 * `verifyReservePackage` recomputes the NOK reserve total with integer arithmetic (rounding down, so
 * reserves are never overstated) and the hashes that `contracts/PoR.compact` stores
 * (`reserve_package`, `attestation`). An auditor runs this against the published report.
 *
 * CUSTODIAL HOLDINGS (CE-27). Assets held at a third party (an exchange) have no key the company controls, so
 * no control proof exists. They are listed in `ReservePackage.custodial` with the custodian, the account
 * reference and the hash of the custodian's statement, and are DOCUMENTED, never COUNTED: the NOK value goes
 * in `documentedCustodial`, never in `reserves`. A package that contains custodial holdings or a policy hash
 * is hashed with the v2 tag; a package without them keeps the v1 hash, so existing reports and vectors stay valid.
 *
 * NOT covered (see docs/proof-of-reserves.md): reading the real balance at the snapshot height from
 * each chain, address derivation for real chains (needs blake2b-224 or keccak, so it is injectable and
 * fails closed), secp256k1 control proofs, and Merkle-anchored price inclusion.
 */
import { createHash, createPublicKey, verify } from "node:crypto";

export type Hash = string; // lowercase hex

export interface Holding {
  chain: string;
  address: string;
  asset: string;
  amount: bigint; // base units (for example lovelace)
  decimals: number; // base units per whole unit = 10^decimals
  snapshotHeight: bigint;
  haircutBps?: number; // 0..10000, value counted = value * (10000 - haircut) / 10000
  control: { publicKey: Hash; signature: Hash }; // ed25519, 32-byte key and 64-byte signature
}
/** An asset held at a third party. Documented, never counted as a proven reserve. */
export interface CustodialHolding {
  custodian: string; // for example "NBX"
  accountRef: string; // the custodian's account reference, no secrets
  asset: string;
  amount: bigint; // base units, as stated by the custodian
  decimals: number;
  asOf: bigint; // unix seconds the statement is valid for
  staked: boolean; // part of the balance is staked at the custodian (a claim on the custodian)
  statementHash: Hash; // sha-256 of the custodian's statement (32 bytes hex); the statement itself is not published
}
export interface PricePoint {
  asset: string;
  nokPerUnitE8: bigint; // NOK per whole unit times 10^8
  timestamp: bigint; // unix seconds
}
export interface ReservePackage {
  period: bigint;
  liabilitiesRoot: Hash;
  holdings: Holding[];
  prices: PricePoint[];
  custodial?: CustodialHolding[];
  /** sha-256 of the counting policy document that was applied (32 bytes hex). Bound into the package hash. */
  policyHash?: Hash;
}
export interface Options {
  asOf: bigint; // unix seconds of the snapshot the prices must match
  maxPriceAgeSeconds?: bigint; // default 3600
  /** Map (chain, ed25519 public key) to the address it controls. Unknown chains fail closed. */
  deriveAddress?: (chain: string, publicKeyHex: Hash) => string | undefined;
}

export type Failure =
  | "DUPLICATE_HOLDING"
  | "BAD_HOLDING"
  | "MISSING_PRICE"
  | "DUPLICATE_PRICE"
  | "STALE_PRICE"
  | "FUTURE_PRICE"
  | "DUPLICATE_CUSTODIAL"
  | "FUTURE_STATEMENT"
  | "BAD_CONTROL_PROOF"
  | "ADDRESS_DERIVATION_UNSUPPORTED"
  | "ADDRESS_KEY_MISMATCH"
  | "RESERVES_MISMATCH"
  | "MALFORMED_INPUT";
/** One line of the report: every holding appears, with whether it counts and why (D3). */
export interface ReportLine {
  kind: "control-proof" | "custodial-attested";
  label: string;
  asset: string;
  counted: boolean;
  reason: string;
  valueNok: bigint; // ore; for a proven holding after haircut, for a custodial one the documented value
}
export type Result =
  | {
      valid: true;
      reserves: bigint; // counted only: holdings with a verified control proof
      documentedCustodial: bigint; // NOK ore documented at custodians, NEVER part of `reserves`
      lines: ReportLine[];
      packageHash: Hash;
      attestation: Hash;
    }
  | { valid: false; reason: Failure; detail: string };

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
const hexBytes = (h: Hash): Buffer => Buffer.from(h, "hex");
/** Length-prefixed UTF-8, so concatenated fields cannot be shifted into each other. */
const field = (s: string): Buffer => {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
};

export const TAG_HOLDING = "ce.por.holding.v1";
export const TAG_PRICE = "ce.por.price.v1";
export const TAG_PACKAGE = "ce.por.package.v1";
export const TAG_PACKAGE_V2 = "ce.por.package.v2";
export const TAG_CUSTODIAL = "ce.por.custodial.v1";
export const TAG_CHALLENGE = "ce.por.challenge.v1";
export const TAG_ATTEST = "ce.por.attest.v1";

/** What each address key must sign: binds the proof to this period, root and address. */
export const challenge = (period: bigint, liabilitiesRoot: Hash, chain: string, address: string): Hash =>
  sha(pad32(TAG_CHALLENGE), num32(period), hexBytes(liabilitiesRoot), field(chain), field(address));

export const holdingLeaf = (h: Holding): Hash =>
  sha(
    pad32(TAG_HOLDING), field(h.chain), field(h.address), field(h.asset), num32(h.amount),
    num32(BigInt(h.decimals)), num32(h.snapshotHeight), num32(BigInt(h.haircutBps ?? 0)),
    hexBytes(h.control.publicKey), hexBytes(h.control.signature),
  );
export const priceLeaf = (p: PricePoint): Hash => sha(pad32(TAG_PRICE), field(p.asset), num32(p.nokPerUnitE8), num32(p.timestamp));

const orderedHash = (leaves: Hash[]): Hash => sha(...[...leaves].sort().map(hexBytes));

export const custodialLeaf = (c: CustodialHolding): Hash =>
  sha(
    pad32(TAG_CUSTODIAL), field(c.custodian), field(c.accountRef), field(c.asset), num32(c.amount),
    num32(BigInt(c.decimals)), num32(c.asOf), num32(c.staked ? 1n : 0n), hexBytes(c.statementHash),
  );

/**
 * Hash stored on-chain as `reserve_package`. Order of holdings, custodial holdings and prices does not matter.
 * Without custodial holdings and without a policy hash this is the v1 hash; otherwise the v2 hash that also
 * covers them, so a changed statement hash, amount or policy changes the package hash.
 */
export const packageHash = (pkg: ReservePackage): Hash => {
  const holdings = hexBytes(orderedHash(pkg.holdings.map(holdingLeaf)));
  const prices = hexBytes(orderedHash(pkg.prices.map(priceLeaf)));
  const custodial = pkg.custodial ?? [];
  if (custodial.length === 0 && pkg.policyHash === undefined) {
    return sha(pad32(TAG_PACKAGE), num32(pkg.period), hexBytes(pkg.liabilitiesRoot), holdings, prices);
  }
  return sha(
    pad32(TAG_PACKAGE_V2), num32(pkg.period), hexBytes(pkg.liabilitiesRoot), holdings, prices,
    hexBytes(orderedHash(custodial.map(custodialLeaf))), pkg.policyHash === undefined ? Buffer.alloc(32) : hexBytes(pkg.policyHash),
  );
};

/** Mirrors the circuit `bind_attestation`. */
export const attestation = (period: bigint, liabilitiesRoot: Hash, reserves: bigint, pkgHash: Hash): Hash =>
  sha(pad32(TAG_ATTEST), num32(period), hexBytes(liabilitiesRoot), num32(reserves), hexBytes(pkgHash));

/** NOK minor units (ore) counted for one holding: floor(amount * price / 10^(decimals+6)), then haircut. */
export function holdingValue(h: Holding, p: PricePoint): bigint {
  const gross = (h.amount * p.nokPerUnitE8) / (10n ** BigInt(h.decimals) * 10n ** 6n);
  return (gross * BigInt(10000 - (h.haircutBps ?? 0))) / 10000n;
}
/** NOK ore documented for a custodial holding (no haircut: it is never counted). */
export const custodialValue = (c: CustodialHolding, p: PricePoint): bigint =>
  (c.amount * p.nokPerUnitE8) / (10n ** BigInt(c.decimals) * 10n ** 6n);

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const verifyEd25519 = (publicKeyHex: Hash, messageHex: Hash, signatureHex: Hash): boolean => {
  try {
    if (publicKeyHex.length !== 64 || signatureHex.length !== 128) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, hexBytes(publicKeyHex)]), format: "der", type: "spki" });
    return verify(null, hexBytes(messageHex), key, hexBytes(signatureHex));
  } catch {
    return false;
  }
};

/** Test chain: the address is the hex SHA-256 of the key. Real chains must inject `deriveAddress`. */
const defaultDerive = (chain: string, publicKeyHex: Hash): string | undefined =>
  chain === "test" ? sha(hexBytes(publicKeyHex)) : undefined;

const fail = (reason: Failure, detail: string): Result => ({ valid: false, reason, detail });

const MAX_U64 = (1n << 64n) - 1n;
const MAX_U128 = (1n << 128n) - 1n; // the circuit's Uint<128> reserve and sum type
const isHex = (s: unknown, bytes: number): boolean => typeof s === "string" && s.length === bytes * 2 && /^[0-9a-f]+$/.test(s);

/** Reject anything that would be silently truncated or reinterpreted by hashing (Buffer.from(hex) drops bad input). */
function malformed(pkg: ReservePackage, claimed: bigint): string | undefined {
  if (pkg.period < 0n || pkg.period > MAX_U64) return "period outside Uint<64>";
  if (claimed < 0n || claimed > MAX_U128) return "claimed reserves outside Uint<128>";
  if (!isHex(pkg.liabilitiesRoot, 32)) return "liabilitiesRoot must be 64 lowercase hex characters";
  for (const h of pkg.holdings) {
    if (!isHex(h.control.publicKey, 32)) return "control public key must be 64 lowercase hex characters";
    if (!isHex(h.control.signature, 64)) return "control signature must be 128 lowercase hex characters";
    if (h.amount > MAX_U128) return "amount outside Uint<128>";
    if (h.snapshotHeight < 0n) return "negative snapshot height";
  }
  if (pkg.policyHash !== undefined && !isHex(pkg.policyHash, 32)) return "policyHash must be 64 lowercase hex characters";
  for (const c of pkg.custodial ?? []) {
    if (!isHex(c.statementHash, 32)) return "custodial statementHash must be 64 lowercase hex characters";
    if (typeof c.custodian !== "string" || c.custodian === "" || typeof c.accountRef !== "string" || c.accountRef === "") {
      return "custodial holding needs a custodian and an account reference";
    }
    if (c.amount > MAX_U128) return "custodial amount outside Uint<128>";
    if (c.asOf < 0n || c.asOf > MAX_U64) return "custodial asOf outside Uint<64>";
  }
  return undefined;
}

/** Verify a reserve package and recompute the figures the circuit stores. */
export function verifyReservePackage(pkg: ReservePackage, claimedReserves: bigint, opts: Options): Result {
  const bad = malformed(pkg, claimedReserves);
  if (bad) return fail("MALFORMED_INPUT", bad);
  const maxAge = opts.maxPriceAgeSeconds ?? 3600n;
  const derive = opts.deriveAddress ?? defaultDerive;

  const prices = new Map<string, PricePoint>();
  for (const p of pkg.prices) {
    if (prices.has(p.asset)) return fail("DUPLICATE_PRICE", p.asset);
    if (p.nokPerUnitE8 <= 0n) return fail("BAD_HOLDING", `non-positive price for ${p.asset}`);
    if (p.timestamp > opts.asOf) return fail("FUTURE_PRICE", p.asset);
    if (opts.asOf - p.timestamp > maxAge) return fail("STALE_PRICE", p.asset);
    prices.set(p.asset, p);
  }

  const seen = new Set<string>();
  const lines: ReportLine[] = [];
  let total = 0n;
  for (const h of pkg.holdings) {
    const id = JSON.stringify([h.chain, h.address, h.asset]);
    if (seen.has(id)) return fail("DUPLICATE_HOLDING", `${h.chain}:${h.address}:${h.asset}`);
    seen.add(id);
    const haircut = h.haircutBps ?? 0;
    if (h.amount < 0n || h.decimals < 0 || h.decimals > 36 || haircut < 0 || haircut > 10000 || !Number.isInteger(haircut)) {
      return fail("BAD_HOLDING", id);
    }
    const price = prices.get(h.asset);
    if (!price) return fail("MISSING_PRICE", h.asset);

    const derived = derive(h.chain, h.control.publicKey);
    if (derived === undefined) return fail("ADDRESS_DERIVATION_UNSUPPORTED", `chain ${h.chain}`);
    if (derived !== h.address) return fail("ADDRESS_KEY_MISMATCH", id);
    if (!verifyEd25519(h.control.publicKey, challenge(pkg.period, pkg.liabilitiesRoot, h.chain, h.address), h.control.signature)) {
      return fail("BAD_CONTROL_PROOF", id);
    }
    const value = holdingValue(h, price);
    total += value;
    lines.push({ kind: "control-proof", label: `${h.chain}:${h.address}`, asset: h.asset, counted: true, reason: "control proof verified", valueNok: value });
  }

  // Custodial holdings: documented, never counted.
  const seenCustodial = new Set<string>();
  let documented = 0n;
  for (const c of pkg.custodial ?? []) {
    const id = JSON.stringify([c.custodian, c.accountRef, c.asset]);
    if (seenCustodial.has(id)) return fail("DUPLICATE_CUSTODIAL", `${c.custodian}:${c.accountRef}:${c.asset}`);
    seenCustodial.add(id);
    if (c.amount < 0n || !Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 36) return fail("BAD_HOLDING", id);
    if (c.asOf > opts.asOf) return fail("FUTURE_STATEMENT", id);
    const price = prices.get(c.asset);
    if (!price) return fail("MISSING_PRICE", c.asset);
    const value = custodialValue(c, price);
    documented += value;
    lines.push({
      kind: "custodial-attested", label: `${c.custodian}:${c.accountRef}`, asset: c.asset, counted: false,
      reason: c.staked ? "third-party custody, staked at the custodian" : "third-party custody", valueNok: value,
    });
  }
  if (documented > MAX_U128) return fail("MALFORMED_INPUT", "documented custodial value exceeds Uint<128>");

  if (total > MAX_U128) return fail("MALFORMED_INPUT", "computed reserves exceed Uint<128>");
  if (total !== claimedReserves) return fail("RESERVES_MISMATCH", `computed ${total}, claimed ${claimedReserves}`);
  const pkgHash = packageHash(pkg);
  return {
    valid: true, reserves: total, documentedCustodial: documented, lines,
    packageHash: pkgHash, attestation: attestation(pkg.period, pkg.liabilitiesRoot, total, pkgHash),
  };
}

/** What the books say a custodian holds (for example from Business 20), for reconciliation with a statement. */
export interface BookBalance { custodian: string; accountRef: string; asset: string; amount: bigint }
export interface ReconciliationLine {
  custodian: string;
  accountRef: string;
  asset: string;
  statement: bigint | undefined; // base units, from the custodial holding
  books: bigint | undefined;
  difference: bigint | undefined; // statement minus books
  status: "match" | "mismatch" | "missing-in-books" | "missing-in-statement";
}
/** Compare custodian statements with the books, line by line. Books are not an independent source; this only finds differences. */
export function reconcileCustodial(custodial: CustodialHolding[], books: BookBalance[]): ReconciliationLine[] {
  const key = (x: { custodian: string; accountRef: string; asset: string }) => JSON.stringify([x.custodian, x.accountRef, x.asset]);
  const stmt = new Map(custodial.map((c) => [key(c), c] as const));
  const book = new Map(books.map((b) => [key(b), b] as const));
  const out: ReconciliationLine[] = [];
  for (const k of [...new Set([...stmt.keys(), ...book.keys()])].sort()) {
    const s = stmt.get(k), b = book.get(k);
    const ref = (s ?? b)!;
    const status = s && b ? (s.amount === b.amount ? "match" : "mismatch") : s ? "missing-in-books" : "missing-in-statement";
    out.push({
      custodian: ref.custodian, accountRef: ref.accountRef, asset: ref.asset, statement: s?.amount, books: b?.amount,
      difference: s && b ? s.amount - b.amount : undefined, status,
    });
  }
  return out;
}
