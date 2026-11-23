# CE-21 spike: control proof schemes (2026-11-20, real wallet results 2026-11-23)

Question (step 1 of CE-21 in `docs/reserve-side-plan.md`): what exactly does a real wallet sign, and what must a
verifier check, for Cardano (CIP-30), Midnight (unshielded keys) and multisig set-ups? **No code was changed.**
Everything marked *verified here* was run on the test host with the installed Midnight SDK (ledger-v9) and throwaway
random keys; nothing secret was used. Everything marked *from the spec* is read from a specification or a
secondary source and has not been checked against a real wallet.

## Real wallet results: Lace, 2026-11-23 (verified)
A fresh Lace test wallet (Chrome extension, API version `4.1.0-canary` for Midnight) signed a 32-byte test challenge on
Cardano (network id 0, testnet) and on Midnight Preprod. Both signatures were verified independently of the wallet.
The signed values are not in this repository (they belong to a wallet address); the findings are:

**Cardano (CIP-30), checked by parsing the CBOR by hand and verifying with Node's Ed25519:**
- `signature` is a `COSE_Sign1` with four elements. Protected header: `alg` = -8 (EdDSA), `kid` (label 4) = the
  57-byte address, and `"address"` = the same 57 bytes. Unprotected header: `hashed` = **false**.
- **The payload is embedded** (not detached) and equals the challenge exactly (32 bytes).
- `COSE_Key`: kty 1 (OKP), `kid` = the address, alg -8, crv 6 (Ed25519), `x` = the 32-byte public key.
- The signed bytes are `["Signature1", protected, h'', payload]` (CBOR, as CIP-8 describes). The Ed25519 signature
  **verifies** over that structure with `x`, and does not verify over a changed payload.
- The address was a base address (header byte `0x00`: type 0, network 0, 57 bytes). The payment key hash in bytes 1 to 28
  **equals blake2b-224(`x`)**, so the key really belongs to the address.

**Midnight (dApp connector), checked with ledger-v9 `verifySignature` and a hand-written Bech32m decoder:**
- Lace supports `signData` for Midnight: `scheme` = `schnorr_bip340`, 32-byte `verifyingKey`, 64-byte signature.
- **The signed message is `midnight_signed_message:<n>:` followed by the payload bytes**, where `<n>` is the payload
  size written in decimal ASCII (here `32`). Verified: only this form verifies (checked with the ledger's `verifySignature`). The
  raw payload and the framed message with the payload as hex text fail.
- **Correction, 2026-11-23 (found when the verifier was built):** the ledger's `signData` and `verifySignature` work on the
  **SHA-256 digest** of the bytes they are given. So the signature is BIP-340 Schnorr over **SHA-256(`midnight_signed_message:32:` +
  payload)**. The two statements fit together: the ledger hashes internally, so handing it the unhashed framed bytes works,
  while handing it a pre-hashed message would hash twice. A plain BIP-340 verifier (no hashing) must be given the digest. This was
  confirmed against the ledger on random keys for message lengths 0 to 100 and against the real Lace signature.
- The Bech32m unshielded address (`mn_addr_preprod1…`, valid Bech32m checksum) carries 32 bytes that
  **equal SHA-256 of the verifying key**, and `addressFromKey` in the ledger gives the same value. So a Schnorr key
  maps to its address with `node:crypto` alone.
- The connector accepted `encoding: 'hex'` and signed the decoded bytes.

## Cardano: CIP-30 `signData` (from the spec)
Sources: [CIP-30](https://raw.githubusercontent.com/cardano-foundation/CIPs/master/CIP-0030/README.md),
[CIP-8](https://raw.githubusercontent.com/cardano-foundation/CIPs/master/CIP-0008/README.md) (read 2026-11-20;
the rendered site cips.cardano.org did not resolve from this machine).
- `api.signData(addr, payload)` returns `{ signature, key }`: `signature` is the hex of a CBOR `COSE_Sign1`, `key` is
  the hex of a CBOR `COSE_Key` (kty OKP, alg EdDSA, crv Ed25519, `x` = public key).
- The key signs the CIP-8 `Sig_structure`. Protected header: `alg` = EdDSA (-8) and `"address"` = the raw address
  bytes. **"The payload is not hashed and no `external_aad` is used."** This settles the open question in the plan
  (a secondary source said the payload cannot go in `external_aad`): the payload is in the message and signed as is.
- Base, enterprise and pointer addresses sign with the **payment key**; reward addresses with the staking key.
- If the payment credential is **not a key hash**, the wallet returns `AddressNotPK` and cannot sign. So a
  **script (multisig) address can never produce a CIP-30 control proof**. This confirms step 5 of the plan.
- CIP-8 says the payload is embedded by default and may be `nil` (detached), and has an unprotected `hashed`
  flag. CIP-30 does not say which a wallet uses, so the verifier must accept both and must reject `hashed = true`
  (we sign a challenge of fixed size, so hashing is never needed and would hide what was signed).
- Verifier steps: parse CBOR, check `alg` = -8, rebuild `["Signature1", protected, h'', payload]`, verify Ed25519
  with `x`, require the embedded payload to equal our challenge bytes, require the header address to equal the
  holding address, and require the address's key hash to equal blake2b-224(`x`) (needs `@noble/hashes`, approved in
  D1). `node:crypto` can verify Ed25519; it has no blake2b-224.

## Midnight unshielded keys
**Verified here** (ledger-v9 in `@midnightntwrk/ledger-v9`, wallet SDK 2.0.0):
- A key carries its scheme: `{ tag: 'schnorr' | 'ecdsa', value: hex }`. The ledger documents `schnorr` as BIP-340
  and `ecdsa` as ECDSA over secp256k1. The wallet SDK refuses to mix the two schemes between key, address and signature.
- Schnorr: verifying key 32 bytes (x-only), signature 64 bytes. ECDSA: verifying key 33 bytes (compressed), signature 64 bytes.
- `signData` and `verifySignature` accept any message length (tested 0, 1, 31, 32, 33 and 100 bytes) and verify
  correctly (true for the right message, false for another).
- **Schnorr address = SHA-256 of the 32-byte verifying key** (tested: equal). For ECDSA the address is **not** the
  SHA-256 of the key in the four forms tested (raw, without the first byte, with a 0 or 1 byte in front), so the ECDSA
  derivation is unknown.
- Not determined: which scheme a wallet derived from a seed uses by default. The SDK examples and the connector
  specification both treat `schnorr` as the default.

**From the spec** ([dApp connector specification](https://github.com/midnightntwrk/midnight-dapp-connector-api/blob/main/docs/api/_media/SPECIFICATION.md),
v4.1.0 in the installed package):
- The dApp connector's `signData(data, { encoding, keyType: 'unshielded' })` signs the data **prefixed with
  `midnight_signed_message:<data_size>:`** where `<data_size>` is the size in bytes. The specification does not say
  how the number is written or whether the framed bytes are hashed first. Secondary sources
  ([servicedesk issue 203](https://github.com/midnightntwrk/servicedesk/issues/203),
  [ows-core PR 15](https://github.com/WingRiders/ows-core/pull/15)) describe BIP-340 over the framed message and say
  the framing is pinned in MIP-0031, and that the frame stops message signatures from being usable as ledger
  signatures. **Now verified against Lace (2026-11-23): decimal ASCII length and the payload bytes; the signature is over the SHA-256 digest of the framed bytes (hashed inside the ledger's `signData`).**
- The result is `{ scheme?, data, signature, verifyingKey }`; a missing `scheme` means `schnorr_bip340`.
- A community wallet reference listed Lace's `signData` support as **No** when last indexed. **That was wrong or out of date:**
  the Lace build used on 2026-11-23 supports it (see the real results above). Still feature-detect.

## Multisig and hardware wallets
- Lace has a "shared wallet" feature built on multisig (beta in the announcements found); Lace supports Ledger and,
  from release 1.11, Trezor Model T ([Lace blog](https://lace.io/blog/lace-1-11-0-release)). **Not found:** whether
  a shared wallet or a hardware wallet can answer `signData`, or which multisig scheme (native script vs. others) the
  shared wallet uses. This needs the owner's Lace; nothing here was tried against it.
- Whatever the scheme, a script address cannot sign (above), so a multisig holding needs one of: (a) an m-of-n set
  of single-key CIP-30 proofs from the keys named in the script, checked against the script's required count; or
  (b) the `attested-custodian` path from CE-27 (documented, never counted).

## What this means for the plan
1. **`cip30-ed25519` (CE-21 step 2) can be built now**, with `node:crypto` for Ed25519, a small CBOR reader written for
   exactly this structure, and `@noble/hashes` for blake2b-224. It has a real Lace vector (2026-11-23) to test against.
   Rules the verifier must enforce: `alg` -8; embedded payload equal to the challenge; `hashed` false; header address
   equal to the holding address; blake2b-224(`x`) equal to the address's payment key hash; Ed25519 over the rebuilt
   `Sig_structure`.
2. **`midnight-unshielded` (step 4):** build for `schnorr` (BIP-340 via `@noble/curves`, approved in D1), address
   = SHA-256(key), message = `midnight_signed_message:<n>:` + challenge bytes (confirmed with a real Lace signature); BIP-340 is verified over the SHA-256 digest of the framed bytes.
   Leave `ecdsa` unsupported (fails closed) until its address derivation is known. `@noble/curves` has BIP-340;
   the ledger's own `verifySignature` agreed with the framed message and is the reference for the test.
3. **Fallback for a Midnight wallet that cannot `signData` (Lace can, as of 2026-11-23):** sign with the SDK keystore (`signData` in ledger-v9, which
   signs raw bytes with no frame). That proves control of the key but not that a wallet user consented; the scheme
   must then be labelled differently from `midnight-unshielded` so the two are never confused.
4. **Script addresses (step 5):** implement option (a) only when a multisig set-up is chosen; until then they stay
   documented through CE-27.

## Ethereum (decided 2026-11-23, not yet checked against a real wallet)
`evm-personal-sign` is built from the EIP-191 specification. Design choices: the wallet signs the **text**
`ce.por.control.v1:` + the 64-character challenge hex (readable for the user, and no ambiguity about whether a wallet treats
a `0x...` string as bytes or as text); the verifier hashes `"\x19Ethereum Signed Message:\n" + <byte length> + text` with Keccak-256,
recovers the public key from the 65-byte signature (v as 0/1 or 27/28) and compares the derived address. Verified: the
recovery reproduces the published web3.js `eth.accounts.sign('Some data', key)` example, private key 1 gives the known
address, and Keccak-256 agrees with `node:crypto` sha3-256 when the padding byte is swapped and with known Ethereum vectors.
A contract wallet or Safe (ERC-1271) cannot produce an EOA signature and is out of scope. Wallets differ in how they show
long text, so a real MetaMask (or other) signature is still needed to confirm the round trip.

## Open items
1. Done 2026-11-23: a real Lace CIP-30 output (embedded payload, `hashed` false, `COSE_Key` contents) and a real Midnight
   signature (frame, SHA-256 inside the ledger, Schnorr). Still to do: keep them as known-answer vectors in `test/vectors/` once the owner
   agrees to publish the (testnet) addresses, and add negative cases (other challenge, other key, `hashed` true, wrong network).
2. Whether Lace's shared wallet and the hardware wallets can sign for a CIP-30 control proof (needs the owner's set-up).
3. Whether the unshielded wallet derived from a seed always uses `schnorr` (this Lace wallet did), and the ECDSA address
   derivation if it matters.
4. A second wallet (other than Lace) for each chain, so the verifier is not tuned to one implementation.
