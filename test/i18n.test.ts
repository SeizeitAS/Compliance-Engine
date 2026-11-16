import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createTranslator, loadCatalogs, fallbackChain, negotiateLocale } from "../src/i18n/index.ts";
import { INTAKE_FAILURES } from "../src/eudi/sdJwtVc.ts";
import { SanctionsTree, verifyNonMembership, deriveKey } from "../src/sanctions/indexedMerkleTree.ts";

const dir = fileURLToPath(new URL("../locales", import.meta.url));
const catalogs = loadCatalogs(dir);
const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

test("every locale only uses keys and placeholders defined in en.json", () => {
  for (const [loc, msgs] of Object.entries(catalogs)) {
    for (const [k, v] of Object.entries(msgs)) {
      const base = catalogs.en[k];
      assert.ok(base !== undefined || k.match(/\.(zero|one|two|few|many|other)$/), `${loc}: unknown key ${k}`);
      if (base !== undefined) assert.equal(ph(v), ph(base), `${loc}: placeholder mismatch in ${k}`);
    }
  }
});

test("interpolation, plurals and fallback", () => {
  const nb = createTranslator({ locale: "nb-NO", catalogs });
  assert.equal(nb.locale, "nb-NO");
  assert.match(nb.t("screening.passed", { version: 3 }), /versjon 3/);
  assert.match(nb.t("report.accounts", { count: 1 }), /^1 konto er/);
  assert.match(nb.t("report.accounts", { count: 5 }), /^5 kontoer/);
  const missing: string[] = [];
  const de = createTranslator({ locale: "de", catalogs, onMissing: (k) => missing.push(k) });
  assert.match(de.t("screening.failed"), /Screening failed/); // falls back to English
  assert.equal(de.t("no.such.key"), "no.such.key");
  assert.deepEqual(missing, ["no.such.key"]);
});

test("locale negotiation and chain", () => {
  assert.deepEqual(fallbackChain("nb-NO"), ["nb-NO", "nb", "en"]);
  assert.equal(negotiateLocale(["no-NO", "en"], ["en", "nb"]), "nb");
  assert.equal(negotiateLocale(["fr-FR;q=0.9"], ["en", "nb"]), "en");
});

test("proof failure reasons all have messages in every shipped locale", () => {
  const t = new SanctionsTree([deriveKey("x")], 4);
  const reasons = ["KEY_OUT_OF_DOMAIN", "KEY_NOT_IN_RANGE", "BAD_PATH_LENGTH", "ROOT_MISMATCH"];
  for (const loc of Object.keys(catalogs)) {
    const tr = createTranslator({ locale: loc, catalogs });
    for (const r of reasons) assert.ok(tr.has(`errors.nonmembership.${r}`), `${loc} lacks ${r}`);
  }
  const k = deriveKey("someone");
  const res = verifyNonMembership(t.root, k, { ...t.prove(k)!, siblings: [] }, 4);
  assert.equal(res.valid, false);
});

test("every credential intake failure reason has a message in every shipped locale", () => {
  for (const loc of Object.keys(catalogs)) {
    const tr = createTranslator({ locale: loc, catalogs });
    for (const r of INTAKE_FAILURES) assert.ok(tr.has(`errors.intake.${r}`), `${loc} lacks ${r}`);
  }
});
