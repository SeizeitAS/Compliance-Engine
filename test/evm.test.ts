import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyEvmProof, evmMessage, personalMessageHash, recoverEvmAddress, eip55Ok } from "../src/por/evm.ts";
import { keccak256 } from "../src/por/keccak.ts";
import { G, N, inv, mod, mul } from "../src/por/secp256k1.ts";

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
const toInt = (b: Uint8Array) => BigInt("0x" + hex(b));

// ---- a test-only ECDSA signer (never used in src): deterministic k, low s ----
function signHash(hash: Uint8Array, d: bigint): { r: bigint; s: bigint; recoveryId: number } {
  const z = toInt(hash);
  let k = mod(toInt(createHash("sha256").update(Buffer.concat([Buffer.from(d.toString(16).padStart(64, "0"), "hex"), hash])).digest()), N - 1n) + 1n;
  for (;;) {
    const R = mul(G, k)!;
    const r = mod(R.x, N);
    let s = mod(inv(k, N) * (z + r * d), N);
    if (r !== 0n && s !== 0n) {
      let recoveryId = Number(R.y & 1n);
      if (s > N / 2n) { s = N - s; recoveryId ^= 1; }
      return { r, s, recoveryId };
    }
    k += 1n;
  }
}
const addressOf = (d: bigint) => {
  const q = mul(G, d)!;
  return "0x" + Buffer.from(keccak256(Buffer.concat([Buffer.from(q.x.toString(16).padStart(64, "0"), "hex"), Buffer.from(q.y.toString(16).padStart(64, "0"), "hex")]))).subarray(12).toString("hex");
};
const sigHex = (r: bigint, s: bigint, v: number) => r.toString(16).padStart(64, "0") + s.toString(16).padStart(64, "0") + v.toString(16).padStart(2, "0");

const CHALLENGE = createHash("sha256").update("ce-21 evm test").digest("hex");
const D1 = 0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318n; // the key used in the web3.js docs example

function proof(d: bigint, challenge = CHALLENGE, vBase = 27) {
  const { r, s, recoveryId } = signHash(personalMessageHash(evmMessage(challenge)), d);
  return { address: addressOf(d), signature: "0x" + sigHex(r, s, vBase + recoveryId) };
}

test("address derivation: private key 1 gives the well-known address", () => {
  assert.equal(addressOf(1n), "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
});

test("recovery matches the published web3.js eth.accounts.sign('Some data', key) example", () => {
  // web3.js docs: message "Some data", messageHash 0x1da44b58..., signature below (v = 0x1c)
  const hash = personalMessageHash("Some data");
  assert.equal(hex(hash), "1da44b586eb0729ff70a73c326926f6ed5a25f5b056e7f47fbc6e58d86871655");
  const sig = Buffer.from("b91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c", "hex");
  const recovered = recoverEvmAddress(hash, toInt(sig.subarray(0, 32)), toInt(sig.subarray(32, 64)), sig[64]! - 27);
  assert.equal("0x" + recovered, addressOf(D1));
});

test("a valid personal_sign proof verifies, with v as 0/1 or 27/28 and with or without 0x", () => {
  for (const d of [D1, 2n, 123456789n]) {
    const p = proof(d);
    assert.ok(verifyEvmProof({ challenge: CHALLENGE, ...p }).valid, "v 27/28");
    const low = proof(d, CHALLENGE, 0);
    assert.ok(verifyEvmProof({ challenge: CHALLENGE, ...low }).valid, "v 0/1");
    assert.ok(verifyEvmProof({ challenge: CHALLENGE, address: p.address, signature: p.signature.slice(2) }).valid, "no 0x");
  }
});

test("a mixed-case address needs a valid EIP-55 checksum; lower and upper case are accepted", () => {
  const p = proof(D1);
  const addr40 = p.address.slice(2);
  assert.ok(verifyEvmProof({ challenge: CHALLENGE, address: "0x" + addr40.toUpperCase(), signature: p.signature }).valid);
  // the checksummed form of the web3.js example address
  assert.ok(eip55Ok("2c7536E3605D9C16a7a3D7b1898e529396a65c23"));
  assert.ok(!eip55Ok("2c7536e3605D9C16a7a3D7b1898e529396a65c23")); // one letter's case flipped
  assert.equal((verifyEvmProof({ challenge: CHALLENGE, address: "0x2c7536e3605D9C16a7a3D7b1898e529396a65c23", signature: p.signature }) as { reason: string }).reason, "MALFORMED_PROOF");
});

test("another challenge, another address and a tampered signature are rejected", () => {
  const p = proof(D1);
  assert.equal((verifyEvmProof({ challenge: "cd".repeat(32), ...p }) as { reason: string }).reason, "ADDRESS_MISMATCH");
  assert.equal((verifyEvmProof({ challenge: CHALLENGE, address: addressOf(2n), signature: p.signature }) as { reason: string }).reason, "ADDRESS_MISMATCH");
  const flipped = p.signature.slice(0, 20) + (p.signature[20] === "0" ? "1" : "0") + p.signature.slice(21);
  const r = verifyEvmProof({ challenge: CHALLENGE, address: p.address, signature: flipped });
  assert.ok(!r.valid);
  // the other recovery id recovers a different key
  const { r: rr, s: ss, recoveryId } = signHash(personalMessageHash(evmMessage(CHALLENGE)), D1);
  const otherV = verifyEvmProof({ challenge: CHALLENGE, address: p.address, signature: "0x" + sigHex(rr, ss, 27 + (recoveryId ^ 1)) });
  assert.ok(!otherV.valid);
});

test("the signed text is bound to the prefix and the challenge", () => {
  assert.equal(evmMessage("ab".repeat(32)), "ce.por.control.v1:" + "ab".repeat(32));
  // a signature over the bare challenge hex (no prefix) is rejected
  const { r, s, recoveryId } = signHash(personalMessageHash(CHALLENGE), D1);
  const r2 = verifyEvmProof({ challenge: CHALLENGE, address: addressOf(D1), signature: "0x" + sigHex(r, s, 27 + recoveryId) });
  assert.ok(!r2.valid);
});

test("malformed input is rejected without throwing", () => {
  const p = proof(D1);
  const reason = (x: object) => (verifyEvmProof(x as never) as { reason: string }).reason;
  assert.equal(reason({ challenge: CHALLENGE.toUpperCase(), ...p }), "MALFORMED_PROOF");
  assert.equal(reason({ challenge: CHALLENGE.slice(2), ...p }), "MALFORMED_PROOF");
  assert.equal(reason({ challenge: CHALLENGE, address: p.address.slice(2), signature: p.signature }), "MALFORMED_PROOF");
  assert.equal(reason({ challenge: CHALLENGE, address: p.address.slice(0, 40), signature: p.signature }), "MALFORMED_PROOF");
  assert.equal(reason({ challenge: CHALLENGE, address: p.address, signature: p.signature.slice(0, -2) }), "MALFORMED_PROOF");
  assert.equal(reason({ challenge: CHALLENGE, address: p.address, signature: "0x" + "zz".repeat(65) }), "MALFORMED_PROOF");
  assert.equal(reason({ challenge: CHALLENGE, address: p.address, signature: p.signature.slice(0, -2) + "05" }), "MALFORMED_PROOF"); // v = 5
  assert.equal(reason({ challenge: CHALLENGE, address: p.address, signature: undefined }), "MALFORMED_PROOF");
  // r = 0 and s = 0 and values >= n recover nothing
  assert.equal(reason({ challenge: CHALLENGE, address: p.address, signature: "0x" + sigHex(0n, 1n, 27) }), "BAD_SIGNATURE");
  assert.equal(reason({ challenge: CHALLENGE, address: p.address, signature: "0x" + sigHex(1n, 0n, 27) }), "BAD_SIGNATURE");
  assert.equal(reason({ challenge: CHALLENGE, address: p.address, signature: "0x" + sigHex(N, 1n, 27) }), "BAD_SIGNATURE");
});
