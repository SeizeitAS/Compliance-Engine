/**
 * Address formats and derivation (CE-22) for Cardano, Midnight and Ethereum, no dependencies.
 *
 * Human-readable forms:
 *  - Cardano (CIP-19): Bech32, hrp `addr` / `addr_test` (payment addresses) or `stake` / `stake_test` (reward addresses).
 *    The first byte holds the type (high nibble) and the network (low nibble: 0 testnet, 1 mainnet). The hrp must agree
 *    with the header. Byron (base58) addresses are not supported.
 *  - Midnight (unshielded): Bech32m, hrp `mn_addr` (mainnet, no network segment) or `mn_addr_<network>`
 *    (`preprod`, `preview`, `undeployed`, `testnet` ...), payload 32 bytes = SHA-256 of the 32-byte BIP-340 verifying key.
 *    Shielded (`mn_shield-addr`) and DUST (`mn_dust`) addresses are not accepted: they cannot hold a control proof.
 *  - Ethereum: `0x` + 40 hex; a mixed-case form must carry a valid EIP-55 checksum.
 *
 * `parseAddress` turns any accepted form into the RAW form the verifiers use (lowercase hex of the address bytes for
 * Cardano, hex of the 32-byte payload for Midnight, lowercase `0x...` for Ethereum) plus a canonical string, so the
 * same address cannot be listed twice under two spellings. A network that was expected but differs fails closed.
 */
import { bech32Decode, bech32Encode } from "./bech32.ts";
import { blake2b } from "./blake2b.ts";
import { keccak256 } from "./keccak.ts";
import { eip55Ok } from "./evm.ts";
import { createHash } from "node:crypto";

export type CardanoNetwork = "mainnet" | "testnet";
/** Networks a report expects. A chain that is not listed accepts any network. */
export interface ExpectedNetworks { cardano?: CardanoNetwork; midnight?: string }

export type AddressFailure = "UNSUPPORTED_CHAIN" | "MALFORMED_ADDRESS" | "NETWORK_MISMATCH" | "UNSUPPORTED_ADDRESS_TYPE";
export type ParsedAddress =
  | { ok: true; chain: string; raw: string; canonical: string; network: string | undefined }
  | { ok: false; reason: AddressFailure; detail: string };
const bad = (reason: AddressFailure, detail: string): ParsedAddress => ({ ok: false, reason, detail });

const isHex = (s: string, bytes?: number) => /^[0-9a-f]*$/.test(s) && s.length % 2 === 0 && (bytes === undefined || s.length === bytes * 2);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

// ---------------------------------------------------------------- Cardano
const CARDANO_NET: Record<number, CardanoNetwork> = { 0: "testnet", 1: "mainnet" };

export function cardanoAddress(raw: Uint8Array): string {
  const type = raw[0]! >> 4, net = raw[0]! & 15;
  const stake = type === 14 || type === 15;
  return bech32Encode("bech32", (stake ? "stake" : "addr") + (net === 1 ? "" : "_test"), raw);
}

function parseCardano(address: string, expect: ExpectedNetworks): ParsedAddress {
  let raw: string;
  if (isHex(address)) {
    raw = address;
  } else {
    const d = bech32Decode(address);
    if (!d.ok) return bad("MALFORMED_ADDRESS", `cardano address: ${d.detail}`);
    if (d.variant !== "bech32") return bad("MALFORMED_ADDRESS", "cardano addresses use bech32, not bech32m");
    if (!["addr", "addr_test", "stake", "stake_test"].includes(d.hrp)) return bad("MALFORMED_ADDRESS", `unexpected prefix '${d.hrp}' for a cardano address`);
    raw = hex(d.data);
    if (d.data.length === 0) return bad("MALFORMED_ADDRESS", "empty address");
    const type = d.data[0]! >> 4, net = d.data[0]! & 15;
    const stake = type === 14 || type === 15;
    if (stake !== d.hrp.startsWith("stake")) return bad("MALFORMED_ADDRESS", "prefix and address type disagree");
    if (net > 1 || (net === 1) !== !d.hrp.endsWith("_test")) return bad("NETWORK_MISMATCH", "prefix and network nibble disagree");
  }
  if (raw.length < 2) return bad("MALFORMED_ADDRESS", "empty address");
  const header = parseInt(raw.slice(0, 2), 16);
  const type = header >> 4, net = header & 15;
  if (type === 8 || type === 9) return bad("UNSUPPORTED_ADDRESS_TYPE", "Byron addresses are not supported");
  if (type > 7 && type !== 14 && type !== 15) return bad("UNSUPPORTED_ADDRESS_TYPE", `cardano address type ${type}`);
  const network = CARDANO_NET[net];
  if (network === undefined) return bad("MALFORMED_ADDRESS", `network nibble ${net} is neither 0 (testnet) nor 1 (mainnet)`);
  if (expect.cardano !== undefined && network !== expect.cardano) return bad("NETWORK_MISMATCH", `address is on ${network}, expected ${expect.cardano}`);
  return { ok: true, chain: "cardano", raw, canonical: cardanoAddress(Buffer.from(raw, "hex")), network };
}

// ---------------------------------------------------------------- Midnight
export function midnightAddress(payload: Uint8Array, network: string): string {
  if (payload.length !== 32) throw new Error("an unshielded address payload is 32 bytes");
  if (network !== "mainnet" && !/^[A-Za-z1-9-]+$/.test(network)) throw new Error("invalid network segment");
  return bech32Encode("bech32m", network === "mainnet" ? "mn_addr" : `mn_addr_${network}`, payload);
}

function parseMidnight(address: string, expect: ExpectedNetworks): ParsedAddress {
  if (/^[0-9a-f]+$/.test(address)) {
    // The bare payload carries no network, so it cannot satisfy an expectation.
    if (!isHex(address, 32)) return bad("MALFORMED_ADDRESS", "a hex midnight address is the 64-character payload");
    if (expect.midnight !== undefined) return bad("NETWORK_MISMATCH", "a hex address does not say which network it is on");
    return { ok: true, chain: "midnight", raw: address, canonical: address, network: undefined };
  }
  const d = bech32Decode(address);
  if (!d.ok) return bad("MALFORMED_ADDRESS", `midnight address: ${d.detail}`);
  if (d.variant !== "bech32m") return bad("MALFORMED_ADDRESS", "midnight addresses use bech32m, not bech32");
  const [prefix, type, network = "mainnet"] = d.hrp.split("_");
  if (prefix !== "mn") return bad("MALFORMED_ADDRESS", `unexpected prefix '${d.hrp}' for a midnight address`);
  if (type !== "addr") return bad("UNSUPPORTED_ADDRESS_TYPE", `midnight address type '${type}' cannot hold a control proof (only unshielded 'addr')`);
  if (d.hrp.split("_").length > 3 || (network !== "mainnet" && !/^[A-Za-z1-9-]+$/.test(network)) || d.hrp.endsWith("_mainnet")) return bad("MALFORMED_ADDRESS", "invalid network segment");
  if (d.data.length !== 32) return bad("MALFORMED_ADDRESS", `an unshielded address payload is 32 bytes, got ${d.data.length}`);
  if (expect.midnight !== undefined && network !== expect.midnight) return bad("NETWORK_MISMATCH", `address is on ${network}, expected ${expect.midnight}`);
  const raw = hex(d.data);
  return { ok: true, chain: "midnight", raw, canonical: raw, network };
}

// ---------------------------------------------------------------- Ethereum
/** EIP-55 mixed-case checksum form of 20 address bytes (or 40 hex characters). */
export function eip55(address: string): string {
  const lower = address.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(lower)) throw new Error("an Ethereum address is 40 hex characters");
  const h = Buffer.from(keccak256(Buffer.from(lower, "ascii"))).toString("hex");
  return "0x" + [...lower].map((c, i) => (/[a-f]/.test(c) && parseInt(h[i]!, 16) >= 8 ? c.toUpperCase() : c)).join("");
}

function parseEthereum(address: string): ParsedAddress {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return bad("MALFORMED_ADDRESS", "an Ethereum address is 0x plus 40 hex characters");
  if (!eip55Ok(address.slice(2))) return bad("MALFORMED_ADDRESS", "invalid EIP-55 checksum");
  const lower = address.toLowerCase();
  return { ok: true, chain: "ethereum", raw: lower, canonical: lower, network: undefined };
}

export function parseAddress(chain: string, address: string, expect: ExpectedNetworks = {}): ParsedAddress {
  if (typeof address !== "string") return bad("MALFORMED_ADDRESS", "address must be a string");
  if (chain === "cardano") return parseCardano(address, expect);
  if (chain === "midnight") return parseMidnight(address, expect);
  if (chain === "ethereum") return parseEthereum(address);
  return bad("UNSUPPORTED_CHAIN", `no address format for chain ${chain}`);
}

// ---------------------------------------------------------------- derivation
/**
 * Public key to address.
 *  - cardano:  32-byte Ed25519 key (hex), enterprise address (type 6): header 0x61 / 0x60 + blake2b-224(key); Bech32.
 *              A base address needs the staking key too and is not derived here (it can be parsed).
 *  - midnight: 32-byte x-only BIP-340 key (hex): SHA-256(key), Bech32m `mn_addr[_<network>]`.
 *  - ethereum: 64-byte uncompressed public key x||y (hex, optionally with the 04 prefix): last 20 bytes of keccak-256, EIP-55.
 * Returns undefined for an unsupported chain or a key of the wrong length.
 */
export function deriveAddress(chain: string, publicKeyHex: string, network?: string): string | undefined {
  if (typeof publicKeyHex !== "string" || !isHex(publicKeyHex)) return undefined;
  const key = Buffer.from(publicKeyHex, "hex");
  if (chain === "cardano") {
    if (key.length !== 32 || (network !== "mainnet" && network !== "testnet")) return undefined;
    return cardanoAddress(Buffer.concat([Buffer.from([network === "mainnet" ? 0x61 : 0x60]), blake2b(key, 28)]));
  }
  if (chain === "midnight") {
    if (key.length !== 32 || network === undefined) return undefined;
    return midnightAddress(createHash("sha256").update(key).digest(), network);
  }
  if (chain === "ethereum") {
    const xy = key.length === 65 && key[0] === 4 ? key.subarray(1) : key;
    if (xy.length !== 64) return undefined;
    return eip55(Buffer.from(keccak256(xy)).subarray(12).toString("hex"));
  }
  return undefined;
}
