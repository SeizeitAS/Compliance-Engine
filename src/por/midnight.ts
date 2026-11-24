/**
 * Control proof for a Midnight unshielded address (CE-21, scheme `midnight-unshielded`): verifies the output of the
 * dApp connector's `signData(data, { encoding: 'hex', keyType: 'unshielded' })`. Checked against a real Lace signature
 * on 2026-11-23 (docs/research/ce-21-spike.md).
 *
 * What the wallet signs: the connector frames the data as `"midnight_signed_message:" + <size> + ":" + <data>` (<size> is the
 * number of data bytes in decimal ASCII) and passes the framed bytes to the ledger's `signData`, which signs the SHA-256
 * digest of them with BIP-340 Schnorr. So the verifier checks BIP-340 over SHA-256(framed bytes). The address is the 32-byte payload
 * of the Bech32m address and equals SHA-256 of the 32-byte x-only verifying key (./address.ts does the Bech32m wrapping: here
 * the address is the lowercase hex of those 32 bytes). Only the `schnorr_bip340` scheme is supported; `ecdsa_secp256k1_sha256`
 * fails closed because its address derivation is not known.
 */
import { createHash } from "node:crypto";
import { schnorrVerify } from "./schnorr.ts";

export type MidnightFailure = "MALFORMED_PROOF" | "UNSUPPORTED_SCHEME" | "ADDRESS_MISMATCH" | "BAD_SIGNATURE";
export type MidnightResult =
  | { valid: true; verifyingKey: string }
  | { valid: false; reason: MidnightFailure; detail: string };

const HEX = /^(?:[0-9a-f]{2})+$/;
const fail = (reason: MidnightFailure, detail: string): MidnightResult => ({ valid: false, reason, detail });

/** The framed bytes the connector hands to the ledger's `signData` for `data` (the connector's `data` field, decoded from its encoding). */
export const midnightSignedMessage = (data: Uint8Array): Buffer =>
  Buffer.concat([Buffer.from(`midnight_signed_message:${data.length}:`, "ascii"), data]);

/**
 * @param challenge    32 bytes as lowercase hex: the data the wallet was asked to sign
 * @param address      lowercase hex of the 32-byte address payload
 * @param verifyingKey `Signature.verifyingKey`: 32 bytes, lowercase hex
 * @param signature    `Signature.signature`: 64 bytes, lowercase hex
 * @param scheme       `Signature.scheme`; absent means `schnorr_bip340`
 */
export function verifyMidnightProof(input: { challenge: string; address: string; verifyingKey: string; signature: string; scheme?: string }): MidnightResult {
  for (const [name, v, bytes] of [
    ["challenge", input.challenge, 32], ["address", input.address, 32], ["verifyingKey", input.verifyingKey, 32], ["signature", input.signature, 64],
  ] as const) {
    if (typeof v !== "string" || !HEX.test(v) || v.length !== bytes * 2) return fail("MALFORMED_PROOF", `${name} must be ${bytes} bytes of lowercase hex`);
  }
  if (input.scheme !== undefined && input.scheme !== "schnorr_bip340") return fail("UNSUPPORTED_SCHEME", `scheme ${String(input.scheme)} is not supported`);
  const vk = Buffer.from(input.verifyingKey, "hex");
  if (createHash("sha256").update(vk).digest("hex") !== input.address) return fail("ADDRESS_MISMATCH", "the verifying key does not belong to the address");
  const digest = createHash("sha256").update(midnightSignedMessage(Buffer.from(input.challenge, "hex"))).digest();
  if (!schnorrVerify(vk, digest, Buffer.from(input.signature, "hex"))) return fail("BAD_SIGNATURE", "Schnorr signature does not verify");
  return { valid: true, verifyingKey: input.verifyingKey };
}
