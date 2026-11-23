/**
 * Control proof for an Ethereum address (CE-21, scheme `evm-personal-sign`): verifies an EIP-191 `personal_sign`
 * signature by recovering the signer's address and comparing it with the holding address. No dependencies:
 * Keccak-256 from ./keccak.ts, secp256k1 from ./secp256k1.ts.
 *
 * The wallet is asked to sign this TEXT (so the user can read what is being signed, and so wallets that treat hex
 * strings differently cannot disagree about the bytes):  `ce.por.control.v1:` + the 64-character lowercase hex of the
 * challenge. The signed hash is keccak256("\x19Ethereum Signed Message:\n" + <byte length of the text> + text).
 * The signature is the usual 65 bytes r || s || v, with v 0/1 or 27/28 (with or without a 0x prefix).
 * Not checked against a real wallet yet: only against the published web3.js `eth.accounts.sign` example and
 * generated signatures (see test/evm.test.ts, docs/research/ce-21-spike.md).
 *
 * What it shows: the holder of the key behind the address signed our challenge. It does not show that the funds are
 * unencumbered, and a contract wallet or multisig (ERC-1271) cannot produce an EOA signature: out of scope here.
 */
import { keccak256 } from "./keccak.ts";
import { G, N, add, inv, liftX, mod, mul } from "./secp256k1.ts";

export type EvmFailure = "MALFORMED_PROOF" | "BAD_SIGNATURE" | "ADDRESS_MISMATCH";
export type EvmResult = { valid: true; address: string } | { valid: false; reason: EvmFailure; detail: string };

const fail = (reason: EvmFailure, detail: string): EvmResult => ({ valid: false, reason, detail });
const HEX = /^[0-9a-fA-F]*$/;

/** The text the wallet is asked to sign for a challenge (64 lowercase hex characters). */
export const evmMessage = (challengeHex: string): string => `ce.por.control.v1:${challengeHex}`;

/** keccak256 of the EIP-191 version 0x45 envelope around `message` (UTF-8). */
export function personalMessageHash(message: string): Uint8Array {
  const body = Buffer.from(message, "utf8");
  return keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`, "utf8"), body]));
}

const toInt = (b: Uint8Array): bigint => BigInt("0x" + (b.length ? Buffer.from(b).toString("hex") : "0"));

/** Recover the 20-byte address (lowercase hex, no 0x) that signed `hash`, or undefined if the signature is invalid. */
export function recoverEvmAddress(hash: Uint8Array, r: bigint, s: bigint, recoveryId: number): string | undefined {
  try {
    if (hash.length !== 32 || recoveryId !== 0 && recoveryId !== 1) return undefined;
    if (r <= 0n || r >= N || s <= 0n || s >= N) return undefined;
    const R = liftX(r, recoveryId === 1);
    if (R === null) return undefined;
    // Q = r^-1 * (s*R - z*G)
    const z = toInt(hash);
    const sr = mul(R, s);
    const zg = mul(G, mod(N - mod(z, N), N));
    const q = mul(add(sr, zg), inv(r, N));
    if (q === null) return undefined;
    const xy = Buffer.concat([Buffer.from(q.x.toString(16).padStart(64, "0"), "hex"), Buffer.from(q.y.toString(16).padStart(64, "0"), "hex")]);
    return Buffer.from(keccak256(xy)).subarray(12).toString("hex");
  } catch {
    return undefined;
  }
}

/** EIP-55: is this mixed-case address correctly checksummed? (All-lowercase and all-uppercase pass: no checksum claimed.) */
export function eip55Ok(address40: string): boolean {
  if (address40 === address40.toLowerCase() || address40 === address40.toUpperCase()) return true;
  const lower = address40.toLowerCase();
  const hash = Buffer.from(keccak256(Buffer.from(lower, "ascii"))).toString("hex");
  for (let i = 0; i < 40; i++) {
    const c = address40[i]!;
    if (/[a-f]/i.test(c) && (parseInt(hash[i]!, 16) >= 8) !== (c === c.toUpperCase())) return false;
  }
  return true;
}

const strip0x = (s: string): string => (s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s);

/**
 * @param challenge 32 bytes as lowercase hex (see `challenge()` in reserves.ts)
 * @param address   `0x` plus 40 hex characters (a mixed-case address must have a valid EIP-55 checksum)
 * @param signature 65 bytes r || s || v as hex, optional 0x prefix
 */
export function verifyEvmProof(input: { challenge: string; address: string; signature: string }): EvmResult {
  if (typeof input.challenge !== "string" || !/^[0-9a-f]{64}$/.test(input.challenge)) return fail("MALFORMED_PROOF", "challenge must be 64 lowercase hex characters");
  if (typeof input.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input.address)) return fail("MALFORMED_PROOF", "address must be 0x plus 40 hex characters");
  const addr = input.address.slice(2);
  if (!eip55Ok(addr)) return fail("MALFORMED_PROOF", "address has an invalid EIP-55 checksum");
  if (typeof input.signature !== "string") return fail("MALFORMED_PROOF", "signature must be a string");
  const sigHex = strip0x(input.signature);
  if (sigHex.length !== 130 || !HEX.test(sigHex)) return fail("MALFORMED_PROOF", "signature must be 65 bytes of hex");
  const sig = Buffer.from(sigHex, "hex");
  const v = sig[64]!;
  const recoveryId = v === 27 || v === 28 ? v - 27 : v;
  if (recoveryId !== 0 && recoveryId !== 1) return fail("MALFORMED_PROOF", "v must be 0, 1, 27 or 28");
  const recovered = recoverEvmAddress(personalMessageHash(evmMessage(input.challenge)), toInt(sig.subarray(0, 32)), toInt(sig.subarray(32, 64)), recoveryId);
  if (recovered === undefined) return fail("BAD_SIGNATURE", "no public key can be recovered from the signature");
  if (recovered !== addr.toLowerCase()) return fail("ADDRESS_MISMATCH", "the signature was made by another address");
  return { valid: true, address: "0x" + recovered };
}
