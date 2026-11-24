/**
 * Hashing helpers for the rule API (CE-34). Same conventions as `src/por/`: SHA-256 over a 32-byte ASCII domain tag
 * followed by length-prefixed fields, numbers as 32-byte little-endian words. No dependencies.
 */
import { createHash } from "node:crypto";

export type Hash = string; // lowercase hex, 64 characters

export const sha = (...parts: Uint8Array[]): Hash => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};
export const pad32 = (text: string): Buffer => {
  const b = Buffer.alloc(32);
  b.write(text, "ascii");
  return b;
};
/** Non-negative integer as a 32-byte little-endian word. Throws outside 0 .. 2^256-1. */
export const num32 = (n: bigint): Buffer => {
  if (n < 0n || n >= 1n << 256n) throw new RangeError("number outside 0..2^256-1");
  const b = Buffer.alloc(32);
  for (let i = 0, v = n; i < 32 && v > 0n; i++, v >>= 8n) b[i] = Number(v & 0xffn);
  return b;
};
/** Length-prefixed UTF-8, so concatenated fields cannot be shifted into each other. */
export const field = (s: string): Buffer => {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
};
export const hexBytes = (h: Hash): Buffer => Buffer.from(h, "hex");
export const isHash = (s: unknown): s is Hash => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/**
 * Deterministic text form of a value, for hashing. Objects have sorted keys and skip `undefined`; a bigint is written as
 * `{"$bigint":"n"}` so it cannot be confused with a string; a number must be a safe integer (no floating point anywhere).
 */
export function canon(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "bigint") return `{"$bigint":"${v}"}`;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new RangeError("only safe integers can be hashed");
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  throw new TypeError(`cannot hash a value of type ${typeof v}`);
}
