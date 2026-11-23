import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { verifyCip30Proof } from "../src/por/cip30.ts";
import { blake2b } from "../src/por/blake2b.ts";

// ---- a tiny CBOR encoder, only for building test inputs ----
type V = number | string | boolean | null | Uint8Array | V[] | Map<number | string, V>;
const head = (major: number, n: number): Buffer =>
  n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
function enc(v: V): Buffer {
  if (v === null) return Buffer.from([0xf6]);
  if (v === true) return Buffer.from([0xf5]);
  if (v === false) return Buffer.from([0xf4]);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(enc)]);
  return Buffer.concat([head(5, v.size), ...[...v.entries()].flatMap(([k, x]) => [enc(k), enc(x)])]);
}
const map = (...pairs: Array<[number | string, V]>) => new Map<number | string, V>(pairs);

// ---- keys, addresses, challenge ----
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const keyFromSeed = (n: number) => {
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, n)]), format: "der", type: "pkcs8" });
  const x = createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  return { priv, x: Buffer.from(x) };
};
const k1 = keyFromSeed(1);
const k2 = keyFromSeed(2);
const stakeHash = Buffer.alloc(28, 9);
const keyHash = (x: Buffer) => Buffer.from(blake2b(x, 28));
const baseAddress = (x: Buffer, net = 0) => Buffer.concat([Buffer.from([net]), keyHash(x), stakeHash]); // type 0 (key, key)
const enterpriseAddress = (x: Buffer, net = 0) => Buffer.concat([Buffer.from([0x60 | net]), keyHash(x)]); // type 6
const rewardAddress = (x: Buffer, net = 0) => Buffer.concat([Buffer.from([0xe0 | net]), keyHash(x)]); // type 14
const CHALLENGE = Buffer.alloc(32, 0xab);

interface Opts { alg?: number; payload?: Buffer | null; hashed?: boolean; key?: Map<number | string, V>; signedPayload?: Buffer; headerAddress?: Buffer; tamper?: boolean }
function proof(k: typeof k1, address: Buffer, o: Opts = {}) {
  const protectedBytes = enc(map([1, o.alg ?? -8], [4, address], ["address", o.headerAddress ?? address]));
  const embedded = o.payload === undefined ? CHALLENGE : o.payload; // what is placed in the message
  const signed = o.signedPayload ?? embedded ?? CHALLENGE; // what the signature covers
  const sigStructure = enc(["Signature1", protectedBytes, new Uint8Array(0), signed]);
  const sig = sign(null, sigStructure, k.priv);
  if (o.tamper) sig[0] = sig[0]! ^ 1;
  const unprotected = map(["hashed", o.hashed ?? false]);
  const signature = enc([protectedBytes, unprotected, embedded, sig]).toString("hex");
  const key = enc(o.key ?? map([1, 1], [2, address], [3, -8], [-1, 6], [-2, k.x])).toString("hex");
  return { signature, key };
}
const call = (address: Buffer, p: { signature: string; key: string }, extra: { challenge?: string; network?: number } = {}) =>
  verifyCip30Proof({ challenge: extra.challenge ?? CHALLENGE.toString("hex"), address: address.toString("hex"), ...p, ...(extra.network !== undefined ? { network: extra.network } : {}) });
const reason = (r: { valid: boolean }) => (r as { reason: string }).reason;

test("a valid proof verifies for base, enterprise and reward addresses", () => {
  for (const address of [baseAddress(k1.x), enterpriseAddress(k1.x), rewardAddress(k1.x)]) {
    const r = call(address, proof(k1, address));
    assert.ok(r.valid, JSON.stringify(r));
    if (r.valid) assert.equal(r.publicKey, k1.x.toString("hex"));
  }
});

test("a detached payload (null in the message) verifies against the challenge we supplied", () => {
  const a = baseAddress(k1.x);
  assert.ok(call(a, proof(k1, a, { payload: null, signedPayload: CHALLENGE })).valid);
});

test("another challenge is rejected, embedded or detached", () => {
  const a = baseAddress(k1.x);
  assert.equal(reason(call(a, proof(k1, a), { challenge: "cd".repeat(32) })), "PAYLOAD_MISMATCH");
  const detached = proof(k1, a, { payload: null, signedPayload: CHALLENGE });
  assert.equal(reason(call(a, detached, { challenge: "cd".repeat(32) })), "BAD_SIGNATURE");
});

test("a signature over another payload than the embedded one is rejected", () => {
  const a = baseAddress(k1.x);
  assert.equal(reason(call(a, proof(k1, a, { signedPayload: Buffer.alloc(32, 1) }))), "BAD_SIGNATURE");
});

test("another address, another key, and a key that does not own the address are rejected", () => {
  const a = baseAddress(k1.x);
  assert.equal(reason(call(baseAddress(k2.x), proof(k1, a))), "ADDRESS_MISMATCH");
  assert.equal(reason(call(a, proof(k1, a, { headerAddress: baseAddress(k2.x) }))), "ADDRESS_MISMATCH");
  // signed by key 2, address belongs to key 1
  assert.equal(reason(call(a, proof(k2, a))), "KEY_HASH_MISMATCH");
});

test("a tampered signature is rejected", () => {
  const a = baseAddress(k1.x);
  assert.equal(reason(call(a, proof(k1, a, { tamper: true }))), "BAD_SIGNATURE");
});

test("hashed payloads and the wrong algorithm are rejected", () => {
  const a = baseAddress(k1.x);
  assert.equal(reason(call(a, proof(k1, a, { hashed: true }))), "HASHED_PAYLOAD");
  assert.equal(reason(call(a, proof(k1, a, { alg: -7 }))), "BAD_ALGORITHM");
  assert.equal(reason(call(a, proof(k1, a, { key: map([1, 1], [3, -7], [-1, 6], [-2, k1.x]) }))), "BAD_ALGORITHM");
});

test("script addresses cannot produce a control proof", () => {
  const scriptBase = Buffer.concat([Buffer.from([0x10]), keyHash(k1.x), stakeHash]); // type 1: script payment credential
  const scriptEnterprise = Buffer.concat([Buffer.from([0x70]), keyHash(k1.x)]); // type 7
  assert.equal(reason(call(scriptBase, proof(k1, scriptBase))), "SCRIPT_ADDRESS");
  assert.equal(reason(call(scriptEnterprise, proof(k1, scriptEnterprise))), "SCRIPT_ADDRESS");
});

test("Byron and malformed addresses are unsupported", () => {
  const byron = Buffer.concat([Buffer.from([0x82]), Buffer.alloc(28, 1)]);
  assert.equal(reason(call(byron, proof(k1, byron))), "UNSUPPORTED_ADDRESS");
  const short = baseAddress(k1.x).subarray(0, 40);
  assert.equal(reason(call(short, proof(k1, short))), "UNSUPPORTED_ADDRESS");
});

test("the network is checked when requested", () => {
  const testnet = baseAddress(k1.x, 0);
  assert.ok(call(testnet, proof(k1, testnet), { network: 0 }).valid);
  assert.equal(reason(call(testnet, proof(k1, testnet), { network: 1 })), "NETWORK_MISMATCH");
  const mainnet = baseAddress(k1.x, 1);
  assert.equal(reason(call(mainnet, proof(k1, mainnet), { network: 0 })), "NETWORK_MISMATCH");
});

test("a COSE_Key of the wrong type is rejected", () => {
  const a = baseAddress(k1.x);
  assert.equal(reason(call(a, proof(k1, a, { key: map([1, 2], [-1, 6], [-2, k1.x]) }))), "MALFORMED_COSE"); // kty
  assert.equal(reason(call(a, proof(k1, a, { key: map([1, 1], [-1, 4], [-2, k1.x]) }))), "MALFORMED_COSE"); // crv
  assert.equal(reason(call(a, proof(k1, a, { key: map([1, 1], [-1, 6], [-2, k1.x.subarray(0, 31)]) }))), "MALFORMED_COSE"); // x length
});

test("malformed input never throws and is rejected", () => {
  const a = baseAddress(k1.x);
  const good = proof(k1, a);
  const bad = (p: { signature: string; key: string }) => reason(call(a, p));
  assert.equal(bad({ ...good, signature: good.signature.slice(0, -2) }), "MALFORMED_COSE"); // truncated
  assert.equal(bad({ ...good, signature: good.signature + "00" }), "MALFORMED_COSE"); // trailing byte
  assert.equal(bad({ ...good, signature: good.signature.toUpperCase() }), "MALFORMED_COSE"); // not lowercase hex
  assert.equal(bad({ ...good, signature: "abc" }), "MALFORMED_COSE"); // odd length
  assert.equal(bad({ ...good, signature: "" }), "MALFORMED_COSE");
  assert.equal(bad({ ...good, signature: enc([1, 2, 3]).toString("hex") }), "MALFORMED_COSE"); // not four elements
  assert.equal(bad({ ...good, signature: enc("text").toString("hex") }), "MALFORMED_COSE");
  assert.equal(bad({ ...good, signature: "d8" + good.signature.slice(0, 0) + "18" + "00" }), "MALFORMED_COSE"); // a tag
  assert.equal(bad({ ...good, signature: "9f" + "ff" }), "MALFORMED_COSE"); // indefinite-length array
  assert.equal(bad({ ...good, key: enc([1]).toString("hex") }), "MALFORMED_COSE");
  assert.equal(reason(verifyCip30Proof({ challenge: "ab".repeat(31), address: a.toString("hex"), ...good })), "MALFORMED_COSE"); // challenge size
  assert.equal(bad({ ...good, signature: "00".repeat(5000) }), "MALFORMED_COSE"); // too large
});

test("a duplicate map key in the protected header is rejected", () => {
  const a = baseAddress(k1.x);
  // map with two entries for key 1: 0xa2 01 27 01 27
  const protectedBytes = Buffer.from("a201270127", "hex");
  const sig = sign(null, enc(["Signature1", protectedBytes, new Uint8Array(0), CHALLENGE]), k1.priv);
  const signature = enc([protectedBytes, map(), CHALLENGE, sig]).toString("hex");
  const key = enc(map([1, 1], [-1, 6], [-2, k1.x])).toString("hex");
  assert.equal(reason(call(a, { signature, key })), "MALFORMED_COSE");
});
