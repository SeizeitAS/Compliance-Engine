import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign, randomBytes } from "node:crypto";
import { verifySdJwtVcPresentation, normalizeIdentifier } from "../src/eudi/sdJwtVc.ts";
import type { IntakeOptions } from "../src/eudi/sdJwtVc.ts";
import { SanctionsTree, verifyNonMembership, deriveKey } from "../src/sanctions/indexedMerkleTree.ts";

// ---- test-only issuer / holder helpers (synthetic data only) ---------------------------------
const b64u = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const sha = (s: string) => createHash("sha256").update(s, "ascii").digest("base64url");
const es256 = (priv: any, input: string) => sign("sha256", Buffer.from(input), { key: priv, dsaEncoding: "ieee-p1363" }).toString("base64url");
const newKey = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { priv: privateKey, jwk: publicKey.export({ format: "jwk" }) };
};
const NOW = 1_800_000_000;
const issuerKey = newKey();
const holderKey = newKey();
const ISS = "https://issuer.test.example";
const VCT = "urn:eudi:pid:1";

const disclosure = (name: string, value: unknown) => b64u([randomBytes(12).toString("base64url"), name, value]);

function issue(opts: { claims?: Record<string, unknown>; payload?: Record<string, unknown>; header?: Record<string, unknown>; signer?: any } = {}) {
  const claims = opts.claims ?? { personal_administrative_number: "010190-12345", family_name: "Test" };
  const ds = Object.entries(claims).map(([k, v]) => disclosure(k, v));
  const payload = {
    iss: ISS, iat: NOW - 10, exp: NOW + 3600, vct: VCT, _sd_alg: "sha-256",
    cnf: { jwk: holderKey.jwk }, _sd: ds.map(sha), ...opts.payload,
  };
  const header = { alg: "ES256", typ: "dc+sd-jwt", ...opts.header };
  const input = `${b64u(header)}.${b64u(payload)}`;
  const jwt = `${input}.${es256(opts.signer ?? issuerKey.priv, input)}`;
  return { jwt, ds };
}
function present(jwt: string, ds: string[], kb: Partial<{ aud: string; nonce: string; iat: number; sd_hash: string; signer: any }> | null = {}) {
  const base = `${jwt}~${ds.map((d) => `${d}~`).join("")}`;
  if (kb === null) return base;
  const h = b64u({ alg: "ES256", typ: "kb+jwt" });
  const p = b64u({ iat: kb.iat ?? NOW, aud: kb.aud ?? "verifier.test", nonce: kb.nonce ?? "n-123", sd_hash: kb.sd_hash ?? sha(base) });
  return `${base}${h}.${p}.${es256(kb.signer ?? holderKey.priv, `${h}.${p}`)}`;
}
const opts = (over: Partial<IntakeOptions> = {}): IntakeOptions => ({
  trustedIssuers: [{ iss: ISS, jwk: issuerKey.jwk }],
  allowedVct: [VCT], identifierClaim: "personal_administrative_number", identifierScheme: "NO:fnr",
  audience: "verifier.test", nonce: "n-123", now: NOW, ...over,
});
const reason = (r: any) => (r.valid ? "VALID" : r.reason);

// ---- tests ------------------------------------------------------------------------------------
test("valid presentation yields normalised identifier and key", () => {
  const { jwt, ds } = issue();
  const r = verifySdJwtVcPresentation(present(jwt, ds), opts());
  assert.equal(r.valid, true);
  if (r.valid) {
    assert.equal(r.identifier, "NO:fnr:01019012345");
    assert.equal(r.key, deriveKey("NO:fnr:01019012345"));
    assert.equal(r.claims.family_name, "Test");
  }
});

test("selective disclosure: undisclosed claims stay hidden, required claim missing fails", () => {
  const { jwt, ds } = issue();
  assert.equal(reason(verifySdJwtVcPresentation(present(jwt, ds.slice(1)), opts())), "MISSING_IDENTIFIER");
  const r = verifySdJwtVcPresentation(present(jwt, ds.slice(0, 1)), opts());
  assert.equal(r.valid && "family_name" in r.claims, false);
});

test("untrusted issuer, wrong signing key, tampered payload", () => {
  const { jwt, ds } = issue();
  assert.equal(reason(verifySdJwtVcPresentation(present(jwt, ds), opts({ trustedIssuers: [] }))), "UNTRUSTED_ISSUER");
  const forged = issue({ signer: newKey().priv });
  assert.equal(reason(verifySdJwtVcPresentation(present(forged.jwt, forged.ds), opts())), "BAD_SIGNATURE");
  const [h, p, s] = jwt.split(".");
  const evil = b64u({ ...JSON.parse(Buffer.from(p, "base64url").toString()), exp: NOW + 10 ** 9 });
  assert.equal(reason(verifySdJwtVcPresentation(present(`${h}.${evil}.${s}`, ds), opts())), "BAD_SIGNATURE");
});

test("issuer entry validity window is enforced", () => {
  const { jwt, ds } = issue();
  const t = [{ iss: ISS, jwk: issuerKey.jwk, validUntil: NOW - 1 }];
  assert.equal(reason(verifySdJwtVcPresentation(present(jwt, ds), opts({ trustedIssuers: t }))), "UNTRUSTED_ISSUER");
});

test("algorithm confusion: none, HS256 and non-ES256 are rejected", () => {
  for (const alg of ["none", "HS256", "ES384"]) {
    const { jwt, ds } = issue({ header: { alg } });
    assert.equal(reason(verifySdJwtVcPresentation(present(jwt, ds), opts())), "UNSUPPORTED_ALG", alg);
  }
});

test("expiry and not-before", () => {
  const e = issue({ payload: { exp: NOW - 1000 } });
  assert.equal(reason(verifySdJwtVcPresentation(present(e.jwt, e.ds), opts())), "EXPIRED");
  const n = issue({ payload: { nbf: NOW + 1000 } });
  assert.equal(reason(verifySdJwtVcPresentation(present(n.jwt, n.ds), opts())), "NOT_YET_VALID");
  const noExp = issue({ payload: { exp: undefined } });
  assert.equal(reason(verifySdJwtVcPresentation(present(noExp.jwt, noExp.ds), opts())), "MALFORMED");
});

test("credential type must be allowed", () => {
  const { jwt, ds } = issue({ payload: { vct: "urn:other" } });
  assert.equal(reason(verifySdJwtVcPresentation(present(jwt, ds), opts())), "BAD_VCT");
});

test("disclosure attacks: unreferenced, duplicate, name collision, array-element form", () => {
  const { jwt, ds } = issue();
  assert.equal(reason(verifySdJwtVcPresentation(present(jwt, [...ds, disclosure("injected", 1)]), opts())), "DISCLOSURE_NOT_REFERENCED");
  assert.equal(reason(verifySdJwtVcPresentation(present(jwt, [ds[0], ds[0]]), opts())), "DISCLOSURE_INVALID");
  const clash = disclosure("vct", "urn:x");
  const c = issue({ payload: { _sd: [sha(clash), ...issue().ds.map(sha)] } });
  assert.equal(reason(verifySdJwtVcPresentation(present(c.jwt, [clash]), opts())), "DISCLOSURE_INVALID");
  const arrForm = b64u(["salt", "value"]);
  const a = issue({ payload: { _sd: [sha(arrForm)] } });
  assert.equal(reason(verifySdJwtVcPresentation(present(a.jwt, [arrForm]), opts())), "DISCLOSURE_INVALID");
});

test("holder binding: required, nonce, audience, replay of sd_hash, wrong key, stale", () => {
  const { jwt, ds } = issue();
  assert.equal(reason(verifySdJwtVcPresentation(present(jwt, ds, null), opts())), "HOLDER_BINDING_REQUIRED");
  assert.equal(verifySdJwtVcPresentation(present(jwt, ds, null), opts({ requireHolderBinding: false })).valid, true);
  for (const kb of [{ nonce: "other" }, { aud: "evil.example" }, { sd_hash: "AAAA" }, { signer: newKey().priv }, { iat: NOW - 10_000 }]) {
    assert.equal(reason(verifySdJwtVcPresentation(present(jwt, ds, kb), opts())), "HOLDER_BINDING_INVALID", JSON.stringify(Object.keys(kb)));
  }
  // presenting a different disclosure set than the one the KB-JWT signed over
  const base = present(jwt, ds, {});
  const kbPart = base.slice(base.lastIndexOf("~") + 1);
  const swapped = `${jwt}~${ds[0]}~${kbPart}`;
  assert.equal(reason(verifySdJwtVcPresentation(swapped, opts())), "HOLDER_BINDING_INVALID");
});

test("malformed input never throws", () => {
  for (const s of ["", "~", "a.b.c~", "x~y~z", "....~", `${b64u({})}.${b64u({})}.AAAA~`]) {
    assert.equal(verifySdJwtVcPresentation(s, opts()).valid, false);
  }
});

test("normalisation", () => {
  assert.equal(normalizeIdentifier(" ab-12 34 "), "AB1234");
});

test("end to end: credential -> key -> sanctions non-membership; listed identity cannot be proven", () => {
  const listedKey = deriveKey("NO:fnr:99999999999");
  const tree = new SanctionsTree([listedKey, deriveKey("NO:fnr:11111111111")], 8);
  const { jwt, ds } = issue();
  const r = verifySdJwtVcPresentation(present(jwt, ds), opts());
  assert.ok(r.valid);
  if (!r.valid) return;
  const proof = tree.prove(r.key)!;
  assert.deepEqual(verifyNonMembership(tree.root, r.key, proof, 8), { valid: true });
  const bad = issue({ claims: { personal_administrative_number: "999 999-99999" } });
  const rb = verifySdJwtVcPresentation(present(bad.jwt, bad.ds), opts());
  assert.ok(rb.valid && rb.key === listedKey);
  if (rb.valid) assert.equal(tree.prove(rb.key), null);
});
