/**
 * EUDI credential intake: verification of SD-JWT VC presentations (IETF SD-JWT, ES256 / P-256).
 *
 * This is the reference ("oracle") implementation for CE-9. It checks, in order:
 *   1. the issuer JWT is ES256, from a trusted issuer, correctly signed and within its validity;
 *   2. every disclosure is well-formed, unique and referenced by a digest in the signed payload;
 *   3. the credential type (vct) is allowed and the required identifier claim is disclosed;
 *   4. holder binding: a key-binding JWT signed by the credential's cnf key, with the expected
 *      audience and nonce, and an sd_hash that covers exactly the presented disclosures.
 * It then derives the sanctions-tree key from the identifier claim so the result can be fed to
 * the non-membership proof (see src/sanctions/).
 *
 * Out of scope for now: mdoc (ISO 18013-5), nested/array disclosures, x5c chain validation,
 * status-list revocation checks, and ES384/ES512. Unsupported inputs are rejected, not ignored.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";
import { deriveKey } from "../sanctions/indexedMerkleTree.ts";

export const INTAKE_FAILURES = [
  "MALFORMED",
  "UNSUPPORTED_ALG",
  "UNTRUSTED_ISSUER",
  "BAD_SIGNATURE",
  "EXPIRED",
  "NOT_YET_VALID",
  "BAD_VCT",
  "DISCLOSURE_INVALID",
  "DISCLOSURE_NOT_REFERENCED",
  "MISSING_IDENTIFIER",
  "HOLDER_BINDING_REQUIRED",
  "HOLDER_BINDING_INVALID",
] as const;
export type IntakeFailure = (typeof INTAKE_FAILURES)[number];

export interface TrustedIssuer {
  iss: string;
  jwk: JsonWebKey; // EC P-256 public key
  validFrom?: number; // seconds since epoch; the issuer entry is ignored outside this window
  validUntil?: number;
}

export interface IntakeOptions {
  trustedIssuers: TrustedIssuer[];
  allowedVct: string[];
  identifierClaim: string; // e.g. "personal_administrative_number"
  identifierScheme: string; // namespace mixed into the key, e.g. "NO:fnr"
  audience: string; // our verifier identifier, must equal KB-JWT aud
  nonce: string; // fresh per request, must equal KB-JWT nonce
  now?: number; // seconds, injectable for tests
  clockSkewSeconds?: number; // default 60
  keyBindingMaxAgeSeconds?: number; // default 300
  requireHolderBinding?: boolean; // default true
}

export type IntakeResult =
  | { valid: true; issuer: string; vct: string; claims: Record<string, unknown>; identifier: string; key: bigint }
  | { valid: false; reason: IntakeFailure };

const fail = (reason: IntakeFailure): IntakeResult => ({ valid: false, reason });
class Reject extends Error {
  reason: IntakeFailure;
  constructor(reason: IntakeFailure) {
    super(reason);
    this.reason = reason;
  }
}

const b64uJson = (s: string): any => {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    throw new Reject("MALFORMED");
  }
};
const sha256b64u = (s: string): string => createHash("sha256").update(s, "ascii").digest("base64url");

function verifyEs256(signingInput: string, sigB64u: string, jwk: JsonWebKey): boolean {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") throw new Reject("UNSUPPORTED_ALG");
  const sig = Buffer.from(sigB64u, "base64url");
  if (sig.length !== 64) return false; // raw r||s, never DER
  const key = createPublicKey({ key: jwk, format: "jwk" });
  return cryptoVerify("sha256", Buffer.from(signingInput, "ascii"), { key, dsaEncoding: "ieee-p1363" }, sig);
}

/** Normalise an identifier before hashing: NFKC, strip whitespace and hyphens, upper-case. */
export function normalizeIdentifier(raw: string): string {
  return raw.normalize("NFKC").replace(/[\s-]+/g, "").toUpperCase();
}

export function verifySdJwtVcPresentation(presentation: string, opts: IntakeOptions): IntakeResult {
  try {
    return verifyInner(presentation, opts);
  } catch (e) {
    if (e instanceof Reject) return fail(e.reason);
    throw e;
  }
}

function verifyInner(presentation: string, o: IntakeOptions): IntakeResult {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const skew = o.clockSkewSeconds ?? 60;

  // --- 0. split: <issuer-jwt>~<disclosure>~...~<kb-jwt or empty>
  const parts = presentation.split("~");
  if (parts.length < 2) throw new Reject("MALFORMED");
  const issuerJwt = parts[0];
  const kbJwt = parts[parts.length - 1];
  const disclosures = parts.slice(1, -1);
  const jwtParts = issuerJwt.split(".");
  if (jwtParts.length !== 3 || jwtParts.some((p) => p === "")) throw new Reject("MALFORMED");

  // --- 1. issuer JWT
  const header = b64uJson(jwtParts[0]);
  const payload = b64uJson(jwtParts[1]);
  if (header.alg !== "ES256") throw new Reject("UNSUPPORTED_ALG"); // also rejects "none" and HS*
  if (header.typ !== "dc+sd-jwt" && header.typ !== "vc+sd-jwt") throw new Reject("MALFORMED");
  if (typeof payload.iss !== "string") throw new Reject("MALFORMED");
  const issuer = o.trustedIssuers.find(
    (t) => t.iss === payload.iss && (t.validFrom ?? -Infinity) <= now && now <= (t.validUntil ?? Infinity),
  );
  if (!issuer) throw new Reject("UNTRUSTED_ISSUER");
  if (!verifyEs256(`${jwtParts[0]}.${jwtParts[1]}`, jwtParts[2], issuer.jwk)) throw new Reject("BAD_SIGNATURE");
  if (typeof payload.exp !== "number") throw new Reject("MALFORMED"); // we require an expiry
  if (now > payload.exp + skew) throw new Reject("EXPIRED");
  if (typeof payload.nbf === "number" && now < payload.nbf - skew) throw new Reject("NOT_YET_VALID");
  if (typeof payload.iat === "number" && now < payload.iat - skew) throw new Reject("NOT_YET_VALID");
  if ((payload._sd_alg ?? "sha-256") !== "sha-256") throw new Reject("UNSUPPORTED_ALG");

  // --- 2. disclosures
  const signedDigests: unknown = payload._sd ?? [];
  if (!Array.isArray(signedDigests) || signedDigests.some((d) => typeof d !== "string")) throw new Reject("MALFORMED");
  const claims: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) if (k !== "_sd" && k !== "_sd_alg") claims[k] = v;
  const seen = new Set<string>();
  for (const d of disclosures) {
    if (d === "" || !/^[A-Za-z0-9_-]+$/.test(d)) throw new Reject("DISCLOSURE_INVALID");
    const digest = sha256b64u(d);
    if (seen.has(digest)) throw new Reject("DISCLOSURE_INVALID"); // duplicate
    seen.add(digest);
    if (!(signedDigests as string[]).includes(digest)) throw new Reject("DISCLOSURE_NOT_REFERENCED");
    const arr = b64uJson(d);
    // Only object-property disclosures [salt, name, value] are supported; array-element ones are rejected.
    if (!Array.isArray(arr) || arr.length !== 3 || typeof arr[0] !== "string" || typeof arr[1] !== "string") {
      throw new Reject("DISCLOSURE_INVALID");
    }
    const name = arr[1];
    if (name === "_sd" || name === "..." || name === "_sd_alg" || name in claims) throw new Reject("DISCLOSURE_INVALID");
    claims[name] = arr[2];
  }

  // --- 3. credential type and identifier claim
  if (typeof claims.vct !== "string" || !o.allowedVct.includes(claims.vct)) throw new Reject("BAD_VCT");
  const rawId = claims[o.identifierClaim];
  if (typeof rawId !== "string" || normalizeIdentifier(rawId) === "") throw new Reject("MISSING_IDENTIFIER");

  // --- 4. holder binding
  const requireKb = o.requireHolderBinding ?? true;
  if (kbJwt === "") {
    if (requireKb) throw new Reject("HOLDER_BINDING_REQUIRED");
  } else {
    const cnfJwk = payload.cnf?.jwk;
    if (!cnfJwk) throw new Reject("HOLDER_BINDING_INVALID");
    const kp = kbJwt.split(".");
    if (kp.length !== 3) throw new Reject("HOLDER_BINDING_INVALID");
    const kh = b64uJson(kp[0]);
    const kpl = b64uJson(kp[1]);
    if (kh.alg !== "ES256" || kh.typ !== "kb+jwt") throw new Reject("HOLDER_BINDING_INVALID");
    const bound = `${issuerJwt}~${disclosures.map((d) => `${d}~`).join("")}`;
    if (kpl.sd_hash !== sha256b64u(bound)) throw new Reject("HOLDER_BINDING_INVALID"); // covers exactly what was presented
    if (kpl.aud !== o.audience || kpl.nonce !== o.nonce) throw new Reject("HOLDER_BINDING_INVALID");
    const maxAge = o.keyBindingMaxAgeSeconds ?? 300;
    if (typeof kpl.iat !== "number" || kpl.iat > now + skew || now - kpl.iat > maxAge) throw new Reject("HOLDER_BINDING_INVALID");
    let ok = false;
    try {
      ok = verifyEs256(`${kp[0]}.${kp[1]}`, kp[2], cnfJwk);
    } catch {
      ok = false;
    }
    if (!ok) throw new Reject("HOLDER_BINDING_INVALID");
  }

  const identifier = `${o.identifierScheme}:${normalizeIdentifier(rawId)}`;
  return { valid: true, issuer: issuer.iss, vct: claims.vct, claims, identifier, key: deriveKey(identifier) };
}
