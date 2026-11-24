/**
 * Bech32 and Bech32m (BIP-173, BIP-350) without dependencies, for the address formats of Cardano (Bech32, CIP-19) and
 * Midnight (Bech32m, `mn_addr_<network>`). Unlike BIP-173 there is no 90-character limit: Cardano base addresses are
 * 103 characters and Midnight's own library enforces none. Strict: mixed case, bad characters, bad checksum, a
 * separator in the wrong place and non-zero padding bits are all rejected. `decode` never throws.
 */
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
export type Variant = "bech32" | "bech32m";
const CONST: Record<Variant, number> = { bech32: 1, bech32m: 0x2bc830a3 };

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk >>> 0;
}
const hrpExpand = (hrp: string): number[] => [...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

/** Regroup bits. `pad` true when encoding (8 to 5); false when decoding (5 to 8), where leftover bits must be zero and fewer than 5. */
function convertBits(data: ArrayLike<number>, from: number, to: number, pad: boolean): number[] | undefined {
  let acc = 0, bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (v < 0 || v >> from !== 0) return undefined;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
    acc &= (1 << bits) - 1;
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || ((acc << (to - bits)) & max) !== 0) {
    return undefined;
  }
  return out;
}

export function bech32Encode(variant: Variant, hrp: string, data: Uint8Array): string {
  if (hrp.length === 0 || hrp !== hrp.toLowerCase() || [...hrp].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126)) {
    throw new Error("invalid human-readable part");
  }
  const words = convertBits(data, 8, 5, true)!;
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ CONST[variant];
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...words, ...checksum].map((w) => CHARSET[w]).join("");
}

export type Bech32Decoded = { ok: true; variant: Variant; hrp: string; data: Uint8Array } | { ok: false; detail: string };

export function bech32Decode(text: string): Bech32Decoded {
  if (typeof text !== "string") return { ok: false, detail: "not a string" };
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return { ok: false, detail: "mixed case" };
  const s = text.toLowerCase();
  const sep = s.lastIndexOf("1");
  if (sep < 1) return { ok: false, detail: "missing human-readable part" };
  if (s.length - sep - 1 < 6) return { ok: false, detail: "data part too short for a checksum" };
  const hrp = s.slice(0, sep);
  if ([...hrp].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126)) return { ok: false, detail: "invalid character in the human-readable part" };
  const words: number[] = [];
  for (const c of s.slice(sep + 1)) {
    const v = CHARSET.indexOf(c);
    if (v < 0) return { ok: false, detail: `invalid character '${c}'` };
    words.push(v);
  }
  const check = polymod([...hrpExpand(hrp), ...words]);
  const variant: Variant | undefined = check === CONST.bech32 ? "bech32" : check === CONST.bech32m ? "bech32m" : undefined;
  if (variant === undefined) return { ok: false, detail: "bad checksum" };
  const bytes = convertBits(words.slice(0, -6), 5, 8, false);
  if (bytes === undefined) return { ok: false, detail: "invalid padding" };
  return { ok: true, variant, hrp, data: Uint8Array.from(bytes) };
}
