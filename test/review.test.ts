import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { commitRecords, recordPath, verifyRecordPath, recordLeaf, checkRecord, type LedgerRecord } from "../src/review/records.ts";
import { review, paramsHash, type Evidence, type ReviewInput, type RulePack, type Source, type Statement } from "../src/review/engine.ts";
import { reportingLimit, unexplained } from "../src/review/packs.ts";
import { canon } from "../src/review/hash.ts";

const H = (s: string) => createHash("sha256").update(s).digest("hex");
const DOC = H("statement-2026-10");
const SRC: Source = { hash: DOC, label: "exchange statement October", trust: 2 };
const T0 = 1_792_000_000n;

// 10 000 NOK = 1_000_000 ore
const LIMIT = 1_000_000n;
const rec = (id: string, amountOre: bigint, extra: Partial<LedgerRecord> = {}): LedgerRecord => ({
  id, time: T0 + 100n, asset: "ADA", amount: amountOre, valueNokOre: amountOre < 0n ? -amountOre : amountOre,
  priceRef: H("price-1"), sourceDocument: DOC, evidence: [], ...extra,
});
const evidence = (name: string, covers: string[], extra: Partial<Evidence> = {}): Evidence => ({ hash: H(name), kind: "voucher", covers, ...extra });
const input = (records: LedgerRecord[], over: Partial<ReviewInput> = {}): ReviewInput => ({
  records, sources: [SRC], accounts: ["nbx:main"],
  packs: [{ pack: reportingLimit, params: { limitNokOre: LIMIT } }], ...over,
});
const ok = (r: ReturnType<typeof review>) => { assert.equal(r.valid, true, JSON.stringify(r, (_, v) => (typeof v === "bigint" ? String(v) : v))); return r as Extract<typeof r, { valid: true }>; };
const reason = (r: ReturnType<typeof review>) => (r.valid ? "valid" : r.reason);

test("the commitment does not depend on the order, and any change moves it", () => {
  const a = rec("a", 500n), b = rec("b", 2_000_000n), c = rec("c", -300n);
  const root = commitRecords([a, b, c]).root;
  assert.equal(commitRecords([c, a, b]).root, root);
  assert.notEqual(commitRecords([a, b]).root, root);
  assert.notEqual(commitRecords([a, b, rec("c", -301n)]).root, root);
  assert.notEqual(commitRecords([a, b, { ...c, counterparty: "x" }]).root, root);
  assert.notEqual(commitRecords([a, b, { ...c, evidence: [H("v")] }]).root, root);
  assert.notEqual(recordLeaf(rec("a", 5n, { valueNokOre: undefined, priceRef: undefined })), recordLeaf(rec("a", 5n, { valueNokOre: 0n })));
  assert.equal(commitRecords([]).count, 0);
  assert.notEqual(commitRecords([]).root, commitRecords([a]).root);
});

test("a record can be shown to belong to the committed set, and nothing else can", () => {
  const rs = Array.from({ length: 7 }, (_, i) => rec(`r${i}`, BigInt(i + 1)));
  const { root } = commitRecords(rs);
  for (const r of rs) assert.equal(verifyRecordPath(root, r, recordPath(rs, r.id)), true);
  const path = recordPath(rs, "r3");
  assert.equal(verifyRecordPath(root, rec("r3", 99n), path), false); // another content
  assert.equal(verifyRecordPath(root, rs[3]!, { ...path, index: 2 }), false); // another place
  assert.equal(verifyRecordPath(root, rs[3]!, { ...path, count: 8 }), false); // another size
  assert.equal(verifyRecordPath(root, rs[3]!, { ...path, siblings: path.siblings.slice(1) }), false);
  assert.equal(verifyRecordPath(H("other"), rs[3]!, path), false);
  const one = [rs[0]!];
  assert.equal(verifyRecordPath(commitRecords(one).root, rs[0]!, recordPath(one, "r0")), true);
});

test("malformed records are refused, not skipped", () => {
  assert.match(checkRecord({ ...rec("a", 1n), valueNokOre: 5n, priceRef: undefined })!, /price/);
  assert.match(checkRecord({ ...rec("a", 1n), sourceDocument: "zz" })!, /sourceDocument/);
  assert.match(checkRecord({ ...rec("a", 1n), evidence: [H("x"), H("x")] })!, /distinct/);
  assert.match(checkRecord({ ...rec("", 1n) })!, /id/);
  assert.match(checkRecord({ ...rec("a", 1n), valueNokOre: -1n })!, /non-negative/);
  assert.equal(reason(review(input([rec("a", 1n, { sourceDocument: "nope" })]))), "BAD_RECORD");
  assert.equal(reason(review(input([rec("a", 1n), rec("a", 2n)]))), "DUPLICATE_RECORD");
  assert.equal(reason(review(input([rec("a", 1n, { sourceDocument: H("unlisted") })]))), "MISSING_SOURCE");
  assert.throws(() => commitRecords([rec("a", 1n), rec("a", 2n)]));
});

test("reporting-limit: at the limit counts, below does not, and no finding means pass", () => {
  const r = ok(review(input([rec("small", 999_999n), rec("exact", 1_000_000n), rec("big", -5_000_000n)])));
  const p = r.report.packs[0]!;
  assert.equal(p.outcome, "open");
  assert.deepEqual(p.findings.map((f) => f.recordIds[0]), ["big", "exact"]);
  assert.equal(r.report.clean, false);
  const none = ok(review(input([rec("small", 999_999n), rec("tiny", -5n)])));
  assert.equal(none.report.packs[0]!.outcome, "pass");
  assert.equal(none.report.clean, true);
  assert.equal(none.report.packs[0]!.examined, 2);
});

test("reporting-limit: direction filter, and an unvalued record is a finding", () => {
  const rs = [rec("in", 2_000_000n), rec("out", -2_000_000n), rec("nov", 10n, { valueNokOre: undefined, priceRef: undefined })];
  const f = (direction: string) => ok(review(input(rs, { packs: [{ pack: reportingLimit, params: { limitNokOre: LIMIT, direction } }] }))).report.packs[0]!.findings.map((x) => `${x.recordIds[0]}:${x.code}`);
  assert.deepEqual(f("in"), ["in:AT_OR_ABOVE_LIMIT", "nov:UNVALUED"]);
  assert.deepEqual(f("out"), ["out:AT_OR_ABOVE_LIMIT"]);
  assert.deepEqual(f("any"), ["in:AT_OR_ABOVE_LIMIT", "nov:UNVALUED", "out:AT_OR_ABOVE_LIMIT"]);
});

test("a finding is explained only by evidence that the record references AND that names the record", () => {
  const v = evidence("voucher-1", ["big"]);
  const withRef = rec("big", 2_000_000n, { evidence: [v.hash] });
  const good = ok(review(input([withRef], { evidence: [v] })));
  assert.equal(good.report.packs[0]!.outcome, "explained");
  assert.deepEqual(good.report.packs[0]!.findings[0]!.explainedBy, [v.hash]);
  assert.equal(good.report.clean, true);
  // the record does not reference it: it could have been attached later
  assert.equal(ok(review(input([rec("big", 2_000_000n)], { evidence: [v] }))).report.packs[0]!.outcome, "open");
  // the evidence does not name the record
  assert.equal(ok(review(input([withRef], { evidence: [evidence("voucher-1", [])] }))).report.packs[0]!.outcome, "open");
  // evidence for another record, or an unknown record, is an error
  assert.equal(reason(review(input([withRef], { evidence: [evidence("voucher-1", ["ghost"])] }))), "BAD_EVIDENCE");
  assert.equal(reason(review(input([withRef], { evidence: [v, v] }))), "BAD_EVIDENCE");
});

test("one evidence item must cover every record of a finding", () => {
  const both: RulePack = { id: "group", version: "1", evaluate: (rs) => [{ code: "GROUP", recordIds: rs.map((r) => r.id), detail: "group" }] };
  const v = evidence("approval", ["a", "b"], { kind: "auditor-approval", issuer: "auditor-key" });
  const rs = [rec("a", 5n, { evidence: [v.hash] }), rec("b", 6n, { evidence: [v.hash] })];
  const run = (records: LedgerRecord[], ev: Evidence[]) => ok(review(input(records, { evidence: ev, packs: [{ pack: both, params: {} }] }))).report.packs[0]!.outcome;
  assert.equal(run(rs, [v]), "explained");
  assert.equal(run([rs[0]!, rec("b", 6n)], [v]), "open");
  assert.equal(run(rs, [{ ...v, covers: ["a"] }]), "open");
});

test("the policy decides which evidence counts: kind, issuer, and a verifier", () => {
  const v = evidence("approval", ["big"], { kind: "auditor-approval", issuer: "k1" });
  const records = [rec("big", 2_000_000n, { evidence: [v.hash] })];
  const out = (policy: ReviewInput["policy"], verify?: (e: Evidence) => boolean) => ok(review(input(records, { evidence: [v], policy }), { verifyEvidence: verify })).report.packs[0]!.outcome;
  assert.equal(out({ accepts: ["auditor-approval"] }), "explained");
  assert.equal(out({ accepts: ["voucher"] }), "open");
  assert.equal(out({ issuers: { "auditor-approval": ["k1"] } }), "explained");
  assert.equal(out({ issuers: { "auditor-approval": ["k2"] } }), "open");
  assert.equal(out({ issuers: { "auditor-approval": ["k1"] } }), "explained");
  assert.equal(out({ requireVerified: true }, () => true), "explained");
  assert.equal(out({ requireVerified: true }, () => false), "open");
  assert.equal(reason(review(input(records, { evidence: [v], policy: { requireVerified: true } }))), "VERIFIER_REQUIRED");
  // an evidence item without an issuer cannot satisfy an issuer list
  const anon = evidence("anon", ["big"]);
  assert.equal(ok(review(input([rec("big", 2_000_000n, { evidence: [anon.hash] })], { evidence: [anon], policy: { issuers: { voucher: ["k1"] } } }))).report.packs[0]!.outcome, "open");
});

test("unexplained: a large movement with nothing attached is open and cannot be explained", () => {
  const packs = [{ pack: unexplained, params: { limitNokOre: LIMIT } }];
  const r = ok(review(input([rec("big", 2_000_000n), rec("small", 10n), rec("nov", 1n, { valueNokOre: undefined, priceRef: undefined })], { packs })));
  assert.deepEqual(r.report.packs[0]!.findings.map((f) => f.code), ["NO_EVIDENCE", "UNVALUED"]);
  assert.equal(r.report.packs[0]!.outcome, "open");
  const v = evidence("v", ["big"]);
  assert.equal(ok(review(input([rec("big", 2_000_000n, { evidence: [v.hash] })], { packs, evidence: [v] }))).report.packs[0]!.outcome, "pass");
});

test("both first packs together, and the report says what is not clean", () => {
  const v = evidence("voucher-1", ["a"]);
  const rs = [rec("a", 3_000_000n, { evidence: [v.hash] }), rec("b", -4_000_000n)];
  const r = ok(review(input(rs, { evidence: [v], packs: [{ pack: unexplained, params: { limitNokOre: LIMIT } }, { pack: reportingLimit, params: { limitNokOre: LIMIT } }] })));
  assert.deepEqual(r.report.packs.map((p) => `${p.id}:${p.outcome}`), ["reporting-limit:open", "unexplained:open"]);
  assert.ok(r.report.limits.some((l) => l.includes("NOT clean")));
  assert.ok(r.report.limits.some((l) => l.includes("No auditor")));
});

test("bad parameters and bad packs fail closed", () => {
  const run = (params: Record<string, string | bigint | boolean | string[]>, pack = reportingLimit) => reason(review(input([rec("a", 1n)], { packs: [{ pack, params }] })));
  assert.equal(run({}), "PACK_ERROR");
  assert.equal(run({ limitNokOre: 0n }), "PACK_ERROR");
  assert.equal(run({ limitNokOre: "1000000" }), "PACK_ERROR");
  assert.equal(run({ limitNokOre: LIMIT, extra: true }), "PACK_ERROR");
  assert.equal(run({ limitNokOre: LIMIT, direction: "sideways" }), "PACK_ERROR");
  const liar: RulePack = { id: "liar", version: "1", evaluate: () => [{ code: "X", recordIds: ["ghost"], detail: "" }] };
  assert.equal(run({}, liar), "BAD_FINDING");
  const empty: RulePack = { id: "empty", version: "1", evaluate: () => [{ code: "X", recordIds: [], detail: "" }] };
  assert.equal(run({}, empty), "BAD_FINDING");
  const throws: RulePack = { id: "boom", version: "1", evaluate: () => { throw new Error("boom"); } };
  assert.equal(run({}, throws), "PACK_ERROR");
  assert.equal(reason(review(input([rec("a", 1n)], { packs: [{ pack: reportingLimit, params: { limitNokOre: LIMIT } }, { pack: reportingLimit, params: { limitNokOre: LIMIT } }] }))), "MALFORMED_INPUT");
  assert.equal(reason(review({ ...input([]), accounts: "x" as unknown as string[] })), "MALFORMED_INPUT");
});

const stmt = (id: string, from: bigint, to: bigint, opening: bigint, closing: bigint, extra: Partial<Statement> = {}): Statement =>
  ({ id, sourceDocument: DOC, asset: "ADA", from, to, opening, closing, ...extra });

test("statement chaining: opening plus movements equals closing", () => {
  const rs = [rec("a", 100n), rec("b", -30n)];
  const good = ok(review(input(rs, { statements: [stmt("oct", T0, T0 + 1000n, 500n, 570n)] })));
  assert.equal(good.report.coverage.complete, true);
  assert.deepEqual(good.report.coverage.statements, [{ id: "oct", asset: "ADA", records: 2 }]);
  // a movement removed from the records breaks the arithmetic
  assert.equal(reason(review(input([rs[0]!], { statements: [stmt("oct", T0, T0 + 1000n, 500n, 570n)] }))), "STATEMENT_BREAK");
  // a record outside the period
  assert.equal(reason(review(input(rs, { statements: [stmt("oct", T0 + 500n, T0 + 1000n, 500n, 570n)] }))), "RECORD_OUTSIDE_STATEMENT");
  assert.equal(reason(review(input(rs, { statements: [stmt("oct", T0, T0, 0n, 0n)] }))), "BAD_STATEMENT");
  assert.equal(reason(review(input(rs, { statements: [stmt("x", T0, T0 + 1000n, 0n, 70n, { sourceDocument: H("unlisted") })] }))), "BAD_STATEMENT");
});

test("statement chaining across months: contiguous must chain, gaps are shown, overlaps fail", () => {
  const DOC2 = H("statement-2026-11"), DOC3 = H("statement-2026-12");
  const sources = [SRC, { hash: DOC2, label: "Nov", trust: 2 as const }, { hash: DOC3, label: "Dec", trust: 2 as const }];
  const rs = [rec("a", 100n), rec("b", 50n, { sourceDocument: DOC2, time: T0 + 1100n })];
  const s1 = stmt("oct", T0, T0 + 1000n, 0n, 100n), s2 = stmt("nov", T0 + 1000n, T0 + 2000n, 100n, 150n, { sourceDocument: DOC2 });
  assert.equal(ok(review(input(rs, { sources, statements: [s2, s1] }))).report.coverage.complete, true);
  assert.equal(reason(review(input(rs, { sources, statements: [s1, { ...s2, opening: 99n, closing: 149n }] }))), "STATEMENT_BREAK");
  assert.equal(reason(review(input(rs, { sources, statements: [s1, { ...s2, from: T0 + 900n }] }))), "STATEMENT_BREAK");
  const dec = stmt("dec", T0 + 3000n, T0 + 4000n, 150n, 150n, { sourceDocument: DOC3 });
  const gap = ok(review(input(rs, { sources, statements: [s1, s2, dec] })));
  assert.equal(gap.report.coverage.complete, false);
  assert.deepEqual(gap.report.coverage.gaps, [{ asset: "ADA", from: T0 + 2000n, to: T0 + 3000n }]);
  assert.ok(gap.report.limits.some((l) => l.includes("incomplete")));
});

test("records without a statement are listed as unchained, and the report is not complete", () => {
  const r = ok(review(input([rec("a", 100n), rec("b", 5n, { asset: "ETH" })], { statements: [stmt("oct", T0, T0 + 1000n, 0n, 100n)] })));
  assert.deepEqual(r.report.coverage.unchainedRecords, ["b"]);
  assert.equal(r.report.coverage.complete, false);
  assert.equal(ok(review(input([rec("a", 1n)]))).report.coverage.complete, false); // no statements at all
});

test("the weakest trust level of the sources used is reported", () => {
  const DOC2 = H("manual");
  const r = ok(review(input([rec("a", 1n), rec("b", 1n, { sourceDocument: DOC2 })], { sources: [SRC, { hash: DOC2, label: "typed in", trust: 4 }, { hash: H("unused"), label: "unused", trust: 4 }] })));
  assert.equal(r.report.weakestTrust, 4);
  assert.ok(r.report.limits.some((l) => l.includes("unsigned file or a manual entry")));
  assert.equal(ok(review(input([rec("a", 1n)]))).report.weakestTrust, 2);
  assert.equal(reason(review(input([rec("a", 1n)], { sources: [{ ...SRC, trust: 9 as 1 }] }))), "BAD_SOURCE");
  assert.equal(reason(review(input([rec("a", 1n)], { sources: [SRC, SRC] }))), "BAD_SOURCE");
});

test("the package hash is reproducible, order independent, and covers everything the verifier relies on", () => {
  const v = evidence("v", ["big"]);
  const rs = [rec("a", 5n), rec("big", 2_000_000n, { evidence: [v.hash] }), rec("c", -7n)];
  const base = input(rs, { evidence: [v], statements: [stmt("oct", T0, T0 + 1000n, 0n, 2_000_000n - 2n)], accounts: ["nbx:main", "nbx:staking"] });
  const hash = (i: ReviewInput) => ok(review(i)).packageHash;
  const h0 = hash(base);
  assert.match(h0, /^[0-9a-f]{64}$/);
  assert.equal(hash({ ...base, records: [...rs].reverse(), accounts: ["nbx:staking", "nbx:main"] }), h0);
  assert.deepEqual(ok(review(base)), ok(review(base)));
  assert.notEqual(hash({ ...base, records: [rs[0]!, rs[1]!, rec("c", -8n)], statements: [stmt("oct", T0, T0 + 1000n, 0n, 2_000_000n - 3n)] }), h0);
  assert.notEqual(hash({ ...base, packs: [{ pack: reportingLimit, params: { limitNokOre: LIMIT + 1n } }] }), h0);
  assert.notEqual(hash({ ...base, packs: [{ pack: { ...reportingLimit, version: "1.0.1" }, params: { limitNokOre: LIMIT } }] }), h0);
  assert.notEqual(hash({ ...base, accounts: ["nbx:main"] }), h0);
  assert.notEqual(hash({ ...base, auditor: { state: "engaged", key: "k" } }), h0);
  assert.notEqual(hash({ ...base, policy: { accepts: ["auditor-approval"] } }), h0);
  assert.notEqual(hash({ ...base, sources: [{ ...SRC, trust: 1 }] }), h0);
  assert.notEqual(hash({ ...base, evidence: [{ ...v, issuer: "someone" }] }), h0);
});

test("parameters hash: key order does not matter, a value does, no floating point", () => {
  assert.equal(paramsHash({ a: 1n, b: "x" }), paramsHash({ b: "x", a: 1n }));
  assert.notEqual(paramsHash({ a: 1n }), paramsHash({ a: 2n }));
  assert.notEqual(paramsHash({ a: 1n }), paramsHash({ a: "1" })); // a bigint is not a string
  assert.throws(() => canon(1.5));
  assert.throws(() => canon(undefined));
});

test("an engaged auditor needs a key, and the state is part of the report", () => {
  assert.equal(reason(review(input([rec("a", 1n)], { auditor: { state: "engaged", key: "" } }))), "MALFORMED_INPUT");
  assert.equal(reason(review(input([rec("a", 1n)], { auditor: { state: "maybe" } as never }))), "MALFORMED_INPUT");
  const r = ok(review(input([rec("a", 1n)], { auditor: { state: "engaged", key: "k1" } })));
  assert.equal(r.report.auditor.state, "engaged");
  assert.ok(r.report.limits.some((l) => l.includes("k1")));
});

test("an empty record set is a valid review with nothing to find", () => {
  const r = ok(review(input([])));
  assert.equal(r.report.packs[0]!.outcome, "pass");
  assert.equal(r.report.commitment.count, 0);
});
