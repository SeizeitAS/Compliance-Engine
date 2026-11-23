/**
 * Control proof for a Cardano address: verifies the output of CIP-30 `api.signData(address, payload)`
 * (CIP-8 `COSE_Sign1` plus `COSE_Key`). CE-21, scheme `cip30-ed25519`. Written from the specifications and checked
 * against a real Lace signature on 2026-11-23 (see docs/research/ce-21-spike.md). No dependencies: Ed25519 from
 * `node:crypto`, a strict CBOR reader below, blake2b-224 from ./blake2b.ts.
 *
 * What the proof shows: the holder of the payment key behind `address` (or the staking key for a reward address) signed
 * exactly our challenge. It does NOT show that the funds are unencumbered, and it cannot exist for script (multisig)
 * addresses: CIP-30 wallets answer `AddressNotPK` for them, so they are rejected here with a clear reason.
 *
 * Checks, in order: the hex inputs and sizes; `COSE_Sign1` has four elements; protected header has `alg` = -8 (EdDSA)
 * and `address` equal to the holding address; `hashed` is not true (we sign a fixed 32-byte challenge, hashing would
 * hide what was signed); the payload is the challenge (embedded, or detached and supplied by us); `COSE_Key` is
 * OKP/Ed25519 with a 32-byte `x`; the address is a key-hash address and blake2b-224(x) equals its key hash; the
 * Ed25519 signature verifies over `["Signature1", protected, h'', payload]`.
 */
import { createPublicKey, verify } from "node:crypto";
import { blake2b } from "./blake2b.ts";

export type Cip30Failure =
  | "MALFORMED_COSE"
  | "BAD_ALGORITHM"
  | "HASHED_PAYLOAD"
  | "PAYLOAD_MISMATCH"
  | "ADDRESS_MISMATCH"
  | "UNSUPPORTED_ADDRESS"
  | "SCRIPT_ADDRESS"
  | "NETWORK_MISMATCH"
  | "KEY_HASH_MISMATCH"
  | "BAD_SIGNATURE";
export type Cip30Result =
  | { valid: true; publicKey: string }
  | { valid: false; reason: Cip30Failure; detail: string };

// ---- strict CBOR reader (definite lengths, no tags, no floats, no duplicate keys, bounded depth and size) ----
type Cbor = number | string | boolean | null | Uint8Array | Cbor[] | Map<number | string, Cbor>;
class CborError extends Error {}
const MAX_BYTES = 4096;
const MAX_DEPTH = 6;

function readItem(buf: Uint8Array, pos: number, depth: number): [Cbor, number] {
  if (depth > MAX_DEPTH) throw new CborError("nesting too deep");
  if (pos >= buf.length) throw new CborError("unexpected end");
  const ib = buf[pos]!;
  const major = ib >> 5;
  const ai = ib & 31;
  pos += 1;
  if (major === 7) {
    if (ai === 20) return [false, pos];
    if (ai === 21) return [true, pos];
    if (ai === 22) return [null, pos];
    throw new CborError("unsupported simple value");
  }
  if (major === 6) throw new CborError("tags are not accepted");
  let arg: number;
  if (ai < 24) arg = ai;
  else if (ai === 24 || ai === 25 || ai === 26) {
    const n = ai === 24 ? 1 : ai === 25 ? 2 : 4;
    if (pos + n > buf.length) throw new CborError("unexpected end");
    arg = 0;
    for (let i = 0; i < n; i++) arg = arg * 256 + buf[pos + i]!;
    pos += n;
  } else throw new CborError("indefinite or 64-bit length not accepted");
  if (major === 0) return [arg, pos];
  if (major === 1) return [-1 - arg, pos];
  if (major === 2 || major === 3) {
    if (pos + arg > buf.length) throw new CborError("string runs past the end");
    const bytes = buf.subarray(pos, pos + arg);
    pos += arg;
    return [major === 2 ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes), pos];
  }
  if (major === 4) {
    if (arg > 64) throw new CborError("array too long");
    const out: Cbor[] = [];
    for (let i = 0; i < arg; i++) { const [v, p] = readItem(buf, pos, depth + 1); out.push(v); pos = p; }
    return [out, pos];
  }
  // major 5: map
  if (arg > 64) throw new CborError("map too long");
  const m = new Map<number | string, Cbor>();
  for (let i = 0; i < arg; i++) {
    const [k, p1] = readItem(buf, pos, depth + 1);
    if (typeof k !== "number" && typeof k !== "string") throw new CborError("map key must be an integer or text");
    if (m.has(k)) throw new CborError("duplicate map key");
    const [v, p2] = readItem(buf, p1, depth + 1);
    m.set(k, v);
    pos = p2;
  }
  return [m, pos];
}
function decode(buf: Uint8Array): Cbor {
  if (buf.length > MAX_BYTES) throw new CborError("input too large");
  const [v, end] = readItem(buf, 0, 0);
  if (end !== buf.length) throw new CborError("trailing bytes");
  return v;
}
const isBytes = (v: Cbor | undefined): v is Uint8Array => v instanceof Uint8Array;

const bstr = (b: Uint8Array): Buffer => {
  if (b.length < 24) return Buffer.concat([Buffer.from([0x40 + b.length]), b]);
  if (b.length < 256) return Buffer.concat([Buffer.from([0x58, b.length]), b]);
  return Buffer.concat([Buffer.from([0x59, b.length >> 8, b.length & 255]), b]);
};

const HEX = /^(?:[0-9a-f]{2})+$/;
const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const fail = (reason: Cip30Failure, detail: string): Cip30Result => ({ valid: false, reason, detail });

/**
 * @param challenge 32 bytes as lowercase hex: what the wallet was asked to sign (see `challenge()` in reserves.ts)
 * @param address   the holding's address as lowercase hex of the RAW address bytes (the bech32 form is CE-22)
 * @param signature `DataSignature.signature`: hex of the CBOR `COSE_Sign1`
 * @param key       `DataSignature.key`: hex of the CBOR `COSE_Key`
 * @param network   optional: required network nibble of the address (0 = testnet, 1 = mainnet)
 */
export function verifyCip30Proof(input: { challenge: string; address: string; signature: string; key: string; network?: number }): Cip30Result {
  for (const [name, v] of [["challenge", input.challenge], ["address", input.address], ["signature", input.signature], ["key", input.key]] as const) {
    if (typeof v !== "string" || !HEX.test(v) || v.length > 2 * MAX_BYTES) return fail("MALFORMED_COSE", `${name} must be lowercase hex`);
  }
  const challengeBytes = Buffer.from(input.challenge, "hex");
  const addressBytes = Buffer.from(input.address, "hex");
  if (challengeBytes.length !== 32) return fail("MALFORMED_COSE", "challenge must be 32 bytes");

  let protectedBytes: Uint8Array, payload: Uint8Array, sigBytes: Uint8Array, x: Uint8Array;
  try {
    const sign1 = decode(Buffer.from(input.signature, "hex"));
    if (!Array.isArray(sign1) || sign1.length !== 4) return fail("MALFORMED_COSE", "COSE_Sign1 must be an array of four elements");
    const [prot, unprot, pay, sig] = sign1;
    if (!isBytes(prot)) return fail("MALFORMED_COSE", "protected header must be a byte string");
    if (!(unprot instanceof Map)) return fail("MALFORMED_COSE", "unprotected header must be a map");
    if (!isBytes(sig) || sig.length !== 64) return fail("MALFORMED_COSE", "signature must be 64 bytes");
    protectedBytes = prot;
    sigBytes = sig;

    const protMap = prot.length === 0 ? new Map<number | string, Cbor>() : decode(prot);
    if (!(protMap instanceof Map)) return fail("MALFORMED_COSE", "protected header must hold a map");
    if (protMap.get(1) !== -8) return fail("BAD_ALGORITHM", "alg must be -8 (EdDSA)");
    const hdrAddress = protMap.get("address");
    if (!isBytes(hdrAddress)) return fail("ADDRESS_MISMATCH", "protected header has no address");
    if (!equal(hdrAddress, addressBytes)) return fail("ADDRESS_MISMATCH", "header address differs from the holding address");

    const hashed = unprot.get("hashed") ?? protMap.get("hashed");
    if (hashed === true) return fail("HASHED_PAYLOAD", "hashed payloads are not accepted");
    if (hashed !== undefined && hashed !== false) return fail("MALFORMED_COSE", "hashed must be a boolean");

    if (pay === null) payload = challengeBytes; // detached: the verifier supplies the payload it asked for
    else if (isBytes(pay)) {
      if (!equal(pay, challengeBytes)) return fail("PAYLOAD_MISMATCH", "signed payload is not the challenge");
      payload = pay;
    } else return fail("MALFORMED_COSE", "payload must be a byte string or null");

    const keyMap = decode(Buffer.from(input.key, "hex"));
    if (!(keyMap instanceof Map)) return fail("MALFORMED_COSE", "COSE_Key must be a map");
    if (keyMap.get(1) !== 1) return fail("MALFORMED_COSE", "COSE_Key kty must be 1 (OKP)");
    const keyAlg = keyMap.get(3);
    if (keyAlg !== undefined && keyAlg !== -8) return fail("BAD_ALGORITHM", "COSE_Key alg must be -8 when present");
    if (keyMap.get(-1) !== 6) return fail("MALFORMED_COSE", "COSE_Key crv must be 6 (Ed25519)");
    const kx = keyMap.get(-2);
    if (!isBytes(kx) || kx.length !== 32) return fail("MALFORMED_COSE", "COSE_Key x must be 32 bytes");
    x = kx;
  } catch (e) {
    if (e instanceof CborError) return fail("MALFORMED_COSE", e.message);
    throw e;
  }

  // The address must be one whose credential is a key hash.
  const header = addressBytes[0]!;
  const type = header >> 4;
  const net = header & 15;
  if ([1, 3, 5, 7, 15].includes(type)) return fail("SCRIPT_ADDRESS", "script addresses cannot produce a CIP-30 control proof");
  if (![0, 2, 4, 6, 14].includes(type)) return fail("UNSUPPORTED_ADDRESS", `address type ${type} is not supported`);
  const lengthOk = type === 0 || type === 2 ? addressBytes.length === 57 : type === 6 || type === 14 ? addressBytes.length === 29 : addressBytes.length >= 32; // pointer: 29 bytes plus the pointer
  if (!lengthOk) return fail("UNSUPPORTED_ADDRESS", `address of type ${type} has an unexpected length (${addressBytes.length})`);
  if (input.network !== undefined && net !== input.network) return fail("NETWORK_MISMATCH", `address is on network ${net}, expected ${input.network}`);
  const keyHash = addressBytes.subarray(1, 29);
  if (!equal(blake2b(x, 28), keyHash)) return fail("KEY_HASH_MISMATCH", "the key in COSE_Key does not belong to the address");

  // Sig_structure = ["Signature1", protected, external_aad = h'', payload]
  const sigStructure = Buffer.concat([Buffer.from([0x84, 0x6a]), Buffer.from("Signature1", "ascii"), bstr(protectedBytes), Buffer.from([0x40]), bstr(payload)]);
  let ok = false;
  try {
    const pub = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, x]), format: "der", type: "spki" });
    ok = verify(null, sigStructure, pub, sigBytes);
  } catch {
    ok = false;
  }
  if (!ok) return fail("BAD_SIGNATURE", "Ed25519 signature does not verify");
  return { valid: true, publicKey: Buffer.from(x).toString("hex") };
}
