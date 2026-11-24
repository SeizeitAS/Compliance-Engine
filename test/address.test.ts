import { test } from "node:test";
import assert from "node:assert/strict";
import { bech32Decode, bech32Encode } from "../src/por/bech32.ts";
import { cardanoAddress, deriveAddress, eip55, midnightAddress, parseAddress } from "../src/por/address.ts";
import { blake2b } from "../src/por/blake2b.ts";

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
const fail = (r: { ok: boolean }) => (r as unknown as { reason: string }).reason;

// ---- Bech32 / Bech32m: vectors from BIP-173 and BIP-350, and from Midnight's own address library ----
test("valid Bech32 and Bech32m strings from BIP-173 and BIP-350 decode, and invalid ones do not", () => {
  for (const s of ["A12UEL5L", "a12uel5l", "an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs", "abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw"]) {
    const d = bech32Decode(s);
    assert.ok(d.ok && d.variant === "bech32", s);
  }
  for (const s of ["A1LQFN3A", "a1lqfn3a", "an83characterlonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11sg7hg6", "abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx"]) {
    const d = bech32Decode(s);
    assert.ok(d.ok && d.variant === "bech32m", s);
  }
  for (const s of ["\x20" + "1nwldj5", "pzry9x0s0muk", "1pzry9x0s0muk", "x1b4n0q5v", "li1dgmt3", "de1lg7wt\xff", "A1G7SGD8", "10a06t8", "1qzzfhee", "A12UEL5l", "abc1qzzfheeq"]) {
    assert.ok(!bech32Decode(s).ok, JSON.stringify(s));
  }
});

test("Bech32 encode round-trips and has no length limit", () => {
  for (const n of [0, 1, 5, 28, 29, 57, 100, 300]) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    for (const v of ["bech32", "bech32m"] as const) {
      const s = bech32Encode(v, "mn_test", data);
      const d = bech32Decode(s);
      assert.ok(d.ok && d.variant === v && d.hrp === "mn_test" && hex(d.data) === hex(data), `${v} ${n}`);
    }
  }
  // the checksum notices one changed character
  const s = bech32Encode("bech32", "addr", Uint8Array.from({ length: 29 }, (_, i) => i));
  assert.ok(!bech32Decode(s.slice(0, 10) + (s[10] === "q" ? "p" : "q") + s.slice(11)).ok);
  assert.ok(!bech32Decode("Addr" + s.slice(4)).ok, "mixed case");
});

// ---- Midnight: strings produced by @midnightntwrk/wallet-sdk-address-format (MidnightBech32m + UnshieldedAddress) ----
const MN = [
  ["mainnet", 7, "mn_addr1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qursj629el"],
  ["mainnet", 255, "mn_addr1lllllllllllllllllllllllllllllllllllllllllllllllllllspg8250"],
  ["preprod", 7, "mn_addr_preprod1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qursfw7h6g"],
  ["preprod", 255, "mn_addr_preprod1llllllllllllllllllllllllllllllllllllllllllllllllllls6unchc"],
  ["preview", 7, "mn_addr_preview1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qursf0q8f4"],
  ["undeployed", 255, "mn_addr_undeployed1lllllllllllllllllllllllllllllllllllllllllllllllllllsq8fxxf"],
  ["testnet", 7, "mn_addr_testnet1qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurskdxm6n"],
] as const;

test("Midnight addresses encode to and parse from the strings the official library produces", () => {
  for (const [net, fill, text] of MN) {
    const payload = Buffer.alloc(32, fill);
    assert.equal(midnightAddress(payload, net), text);
    const p = parseAddress("midnight", text);
    assert.ok(p.ok && p.raw === hex(payload) && p.canonical === hex(payload) && p.network === net, text);
  }
});

test("a Midnight address derived from a key matches the official library", () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  assert.equal(deriveAddress("midnight", hex(key), "preprod"), "mn_addr_preprod14cskcth4y3ar0qkpxhh6y7drunxuvyy5yu8462l9333qfdaxztysey5tve");
  const p = parseAddress("midnight", "mn_addr_preprod14cskcth4y3ar0qkpxhh6y7drunxuvyy5yu8462l9333qfdaxztysey5tve");
  assert.ok(p.ok && p.raw === "ae216c2ef5247a3782c135efa279a3e4cdc61094270f5d2be58c6204b7a612c9");
});

test("Midnight: wrong network, wrong type, wrong variant and tampering are rejected", () => {
  const preprod = MN[2][2];
  assert.equal(fail(parseAddress("midnight", preprod, { midnight: "mainnet" })), "NETWORK_MISMATCH");
  assert.equal(fail(parseAddress("midnight", MN[0][2], { midnight: "preprod" })), "NETWORK_MISMATCH");
  assert.ok(parseAddress("midnight", preprod, { midnight: "preprod" }).ok);
  assert.equal(fail(parseAddress("midnight", "7".repeat(64), { midnight: "preprod" })), "NETWORK_MISMATCH"); // hex has no network
  assert.ok(parseAddress("midnight", "07".repeat(32)).ok);
  assert.equal(fail(parseAddress("midnight", bech32Encode("bech32m", "mn_shield-addr_preprod", Buffer.alloc(32, 1)))), "UNSUPPORTED_ADDRESS_TYPE");
  assert.equal(fail(parseAddress("midnight", bech32Encode("bech32m", "mn_dust_preprod", Buffer.alloc(32, 1)))), "UNSUPPORTED_ADDRESS_TYPE");
  assert.equal(fail(parseAddress("midnight", bech32Encode("bech32", "mn_addr_preprod", Buffer.alloc(32, 7)))), "MALFORMED_ADDRESS"); // bech32, not bech32m
  assert.equal(fail(parseAddress("midnight", bech32Encode("bech32m", "mn_addr_preprod", Buffer.alloc(31, 7)))), "MALFORMED_ADDRESS"); // 31 bytes
  assert.equal(fail(parseAddress("midnight", bech32Encode("bech32m", "xx_addr_preprod", Buffer.alloc(32, 7)))), "MALFORMED_ADDRESS");
  assert.equal(fail(parseAddress("midnight", bech32Encode("bech32m", "mn_addr_mainnet", Buffer.alloc(32, 7)))), "MALFORMED_ADDRESS");
  assert.equal(fail(parseAddress("midnight", preprod.slice(0, 30) + "x" + preprod.slice(31))), "MALFORMED_ADDRESS");
  assert.equal(fail(parseAddress("midnight", preprod.toUpperCase().slice(0, 20) + preprod.slice(20))), "MALFORMED_ADDRESS"); // mixed case
  assert.equal(fail(parseAddress("midnight", "abc")), "MALFORMED_ADDRESS");
});

// ---- Cardano: CIP-19 test vectors ----
const C = {
  base: "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
  enterprise: "addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8",
  enterpriseTest: "addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz",
  stake: "stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw",
  stakeTest: "stake_test1uqehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gssrtvn",
};

test("Cardano CIP-19 vectors parse, report their network and re-encode to the same string", () => {
  const nets: Record<string, string> = { base: "mainnet", enterprise: "mainnet", enterpriseTest: "testnet", stake: "mainnet", stakeTest: "testnet" };
  for (const [k, text] of Object.entries(C)) {
    const p = parseAddress("cardano", text);
    assert.ok(p.ok, k + (p.ok ? "" : p.detail));
    if (!p.ok) continue;
    assert.equal(p.network, nets[k], k);
    assert.equal(p.canonical, text, k);
    assert.equal(cardanoAddress(Buffer.from(p.raw, "hex")), text, k);
    // the raw hex form is accepted too and maps to the same canonical string
    const q = parseAddress("cardano", p.raw);
    assert.ok(q.ok && q.canonical === text && q.raw === p.raw, k);
  }
  const e = parseAddress("cardano", C.enterprise);
  assert.ok(e.ok && e.raw.startsWith("61") && e.raw.length === 58);
  assert.equal(parseAddress("cardano", C.enterpriseTest).ok && (parseAddress("cardano", C.enterpriseTest) as { raw: string }).raw.slice(0, 2), "60");
});

test("Cardano: a testnet address in a mainnet report (and the reverse) fails; so does a mismatch between prefix and header", () => {
  assert.equal(fail(parseAddress("cardano", C.enterpriseTest, { cardano: "mainnet" })), "NETWORK_MISMATCH");
  assert.equal(fail(parseAddress("cardano", C.enterprise, { cardano: "testnet" })), "NETWORK_MISMATCH");
  assert.ok(parseAddress("cardano", C.enterprise, { cardano: "mainnet" }).ok);
  assert.ok(parseAddress("cardano", C.stakeTest, { cardano: "testnet" }).ok);
  // raw hex of a testnet address, expected mainnet
  const raw = (parseAddress("cardano", C.enterpriseTest) as { raw: string }).raw;
  assert.equal(fail(parseAddress("cardano", raw, { cardano: "mainnet" })), "NETWORK_MISMATCH");
  // a mainnet header under the testnet prefix
  const mainRaw = Buffer.from((parseAddress("cardano", C.enterprise) as { raw: string }).raw, "hex");
  assert.equal(fail(parseAddress("cardano", bech32Encode("bech32", "addr_test", mainRaw))), "NETWORK_MISMATCH");
  assert.equal(fail(parseAddress("cardano", bech32Encode("bech32", "stake", mainRaw))), "MALFORMED_ADDRESS"); // payment header under a stake prefix
});

test("Cardano: bad checksum, wrong variant, unknown prefix, Byron and junk are rejected", () => {
  assert.equal(fail(parseAddress("cardano", C.enterprise.slice(0, -1) + "q")), "MALFORMED_ADDRESS");
  assert.equal(fail(parseAddress("cardano", C.enterprise.toUpperCase().slice(0, 10) + C.enterprise.slice(10))), "MALFORMED_ADDRESS");
  const raw = Buffer.from((parseAddress("cardano", C.enterprise) as { raw: string }).raw, "hex");
  assert.equal(fail(parseAddress("cardano", bech32Encode("bech32m", "addr", raw))), "MALFORMED_ADDRESS");
  assert.equal(fail(parseAddress("cardano", bech32Encode("bech32", "xyz", raw))), "MALFORMED_ADDRESS");
  assert.equal(fail(parseAddress("cardano", "82d818582183581c" + "00".repeat(28))), "UNSUPPORTED_ADDRESS_TYPE" /* header 0x82 = Byron */);
  assert.equal(fail(parseAddress("cardano", "")), "MALFORMED_ADDRESS");
  assert.equal(fail(parseAddress("cardano", "6")), "MALFORMED_ADDRESS");
  assert.equal(fail(parseAddress("cardano", "6200")), "MALFORMED_ADDRESS"); // network nibble 2
});

test("Cardano enterprise address derivation: blake2b-224 key hash under the right header", () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
  const a = deriveAddress("cardano", hex(key), "mainnet")!;
  const p = parseAddress("cardano", a);
  assert.ok(p.ok && p.raw === "61" + hex(blake2b(key, 28)));
  const t = parseAddress("cardano", deriveAddress("cardano", hex(key), "testnet")!);
  assert.ok(t.ok && t.raw === "60" + hex(blake2b(key, 28)) && t.network === "testnet");
  assert.equal(deriveAddress("cardano", hex(key)), undefined); // network is required
  assert.equal(deriveAddress("cardano", "ab", "mainnet"), undefined);
});

// ---- Ethereum ----
test("EIP-55 vectors from the specification", () => {
  for (const a of ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"]) {
    assert.equal(eip55(a.toLowerCase()), a);
    const p = parseAddress("ethereum", a);
    assert.ok(p.ok && p.canonical === a.toLowerCase() && p.raw === a.toLowerCase(), a);
    assert.ok(parseAddress("ethereum", a.toLowerCase()).ok);
    assert.ok(parseAddress("ethereum", "0x" + a.slice(2).toUpperCase()).ok);
    const flipped = a.slice(0, 12) + (a[12] === a[12]!.toUpperCase() ? a[12]!.toLowerCase() : a[12]!.toUpperCase()) + a.slice(13);
    if (flipped !== a && /[a-fA-F]/.test(a[12]!)) assert.equal(fail(parseAddress("ethereum", flipped)), "MALFORMED_ADDRESS");
  }
});

test("Ethereum: derivation from a public key and malformed input", () => {
  // private key 1: the generator point, address 0x7e5f4552091a69125d5dfcb7b8c2659029395bdf
  const gx = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", gy = "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";
  const a = deriveAddress("ethereum", gx + gy)!;
  assert.equal(a.toLowerCase(), "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  assert.equal(deriveAddress("ethereum", "04" + gx + gy), a);
  assert.equal(a, eip55(a));
  assert.equal(deriveAddress("ethereum", gx), undefined);
  for (const bad of ["", "0x", "7e5f4552091a69125d5dfcb7b8c2659029395bdf", "0x7e5f4552091a69125d5dfcb7b8c2659029395bd", "0x7e5f4552091a69125d5dfcb7b8c2659029395bdfa", "0xzz5f4552091a69125d5dfcb7b8c2659029395bdf"]) {
    assert.equal(fail(parseAddress("ethereum", bad)), "MALFORMED_ADDRESS", bad);
  }
  assert.equal(fail(parseAddress("solana", "x")), "UNSUPPORTED_CHAIN");
});
