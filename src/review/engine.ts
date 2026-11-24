/**
 * The review engine (CE-34, `docs/rule-api.md`): commits a set of records, runs rule packs over them, explains findings
 * with evidence, checks statement chaining, and produces a report with one package hash.
 *
 * It shows that a defined check was carried out, completely and deterministically, over a committed set of records.
 * It does not show that the records are true or that nothing is missing, and the report says so (`limits`).
 * Everything fails closed: input that cannot be evaluated gives `valid: false`, never a shorter or cleaner report.
 */
import { type Hash, sha, pad32, field, canon, isHash } from "./hash.ts";
import { type LedgerRecord, type Commitment, byId, checkRecord, commitRecords } from "./records.ts";

export type EvidenceKind = "voucher" | "auditor-approval" | "source-attestation";

/** A voucher or an approval. Records reference it by `hash`; it names the records it explains in `covers`. */
export interface Evidence {
  hash: Hash;
  kind: EvidenceKind;
  covers: string[]; // record ids
  issuer?: string; // who stands behind it: an auditor key, an approved source id
}

/** What a pack returns. The engine adds the pack id and checks the record ids. */
export interface RawFinding { code: string; recordIds: string[]; detail: string }
export interface Finding extends RawFinding { ruleId: string }

export type Params = Record<string, string | bigint | boolean | string[]>;

/** Pure and deterministic: no clock, no network, no randomness, integer arithmetic. May throw on bad parameters. */
export interface RulePack {
  id: string;
  version: string;
  evaluate(records: readonly LedgerRecord[], params: Params): RawFinding[];
}

/** What counts as an explanation. Supplied by the criteria owner. */
export interface ExplainPolicy {
  accepts?: EvidenceKind[]; // default: all kinds
  issuers?: Partial<Record<EvidenceKind, string[]>>; // when set for a kind, only these issuers count
  /** Only evidence that `Options.verifyEvidence` accepts counts (a signature check, for example). */
  requireVerified?: boolean;
}

/** 1 signed by the source, 2 pulled from the source's API with the pull recorded, 3 unsigned file, 4 manual entry. */
export type TrustLevel = 1 | 2 | 3 | 4;
export interface Source { hash: Hash; label: string; trust: TrustLevel }

/** One statement: the balance before and after, and the period it covers [from, to). Per source document and asset. */
export interface Statement {
  id: string;
  sourceDocument: Hash;
  asset: string;
  from: bigint;
  to: bigint;
  opening: bigint;
  closing: bigint;
}

export type AuditorState = { state: "none" } | { state: "engaged"; key: string };

export interface ReviewInput {
  records: LedgerRecord[];
  evidence?: Evidence[];
  sources: Source[];
  statements?: Statement[];
  accounts: string[]; // every account and wallet the business states it holds
  packs: { pack: RulePack; params: Params }[];
  policy?: ExplainPolicy;
  auditor?: AuditorState;
}
export interface Options { verifyEvidence?: (e: Evidence) => boolean }

export type Failure =
  | "MALFORMED_INPUT" | "BAD_RECORD" | "DUPLICATE_RECORD" | "BAD_EVIDENCE" | "MISSING_SOURCE" | "BAD_SOURCE"
  | "BAD_STATEMENT" | "STATEMENT_BREAK" | "RECORD_OUTSIDE_STATEMENT" | "PACK_ERROR" | "BAD_FINDING" | "VERIFIER_REQUIRED";

export type Outcome = "pass" | "explained" | "open";
export interface ReportedFinding extends Finding { explainedBy: Hash[] }
export interface PackResult {
  id: string;
  version: string;
  paramsHash: Hash;
  examined: number;
  outcome: Outcome;
  findings: ReportedFinding[];
}
export interface Coverage {
  statements: { id: string; asset: string; records: number }[];
  unchainedRecords: string[]; // records whose source document and asset have no statement
  gaps: { asset: string; from: bigint; to: bigint }[]; // periods between two statements of one asset that nothing covers
  complete: boolean; // chained, no gaps, nothing unchained. It narrows "left out"; it does not close it
}
export interface Report {
  commitment: Commitment;
  accounts: string[];
  sources: Source[];
  weakestTrust: TrustLevel | undefined;
  evidence: Evidence[]; // every item supplied, sorted by hash, with kind, issuer and the records it names
  packs: PackResult[];
  clean: boolean; // no open finding. Says nothing about completeness: read `coverage`
  coverage: Coverage;
  auditor: AuditorState;
  policy: { accepts: EvidenceKind[]; issuers: Partial<Record<EvidenceKind, string[]>>; requireVerified: boolean };
  limits: string[];
}
export type Result =
  | { valid: true; report: Report; packageHash: Hash }
  | { valid: false; reason: Failure; detail: string };

export const TAG_PARAMS = "ce.review.params.v1";
export const TAG_REPORT = "ce.review.report.v1";
const ALL_KINDS: EvidenceKind[] = ["voucher", "auditor-approval", "source-attestation"];

export const paramsHash = (p: Params): Hash => sha(pad32(TAG_PARAMS), field(canon(p)));
const fail = (reason: Failure, detail: string): Result => ({ valid: false, reason, detail });

const LIMIT_RECORDS = "The result covers the committed records only. It does not show that the records are true, or that no account or transaction is missing.";
const LIMIT_CRITERIA = "The criteria and parameters are those the criteria owner supplied. The engine does not state that they are sufficient for any law.";
const LIMIT_EVIDENCE = "Evidence is referenced by hash. The engine does not show that a voucher is genuine or that an approver should have approved.";

/** Run the review. Same input, same output, including the order of everything in it. */
export function review(input: ReviewInput, opts: Options = {}): Result {
  if (typeof input !== "object" || input === null || !Array.isArray(input.records) || !Array.isArray(input.sources) || !Array.isArray(input.accounts) || !Array.isArray(input.packs)) {
    return fail("MALFORMED_INPUT", "records, sources, accounts and packs must be lists");
  }
  const evidence = input.evidence ?? [], statements = input.statements ?? [];
  const policy = {
    accepts: [...(input.policy?.accepts ?? ALL_KINDS)].sort(),
    issuers: input.policy?.issuers ?? {},
    requireVerified: input.policy?.requireVerified ?? false,
  };
  const auditor: AuditorState = input.auditor ?? { state: "none" };
  if (auditor.state === "engaged" && (typeof auditor.key !== "string" || auditor.key.length === 0)) return fail("MALFORMED_INPUT", "an engaged auditor needs a key");
  if (auditor.state !== "engaged" && auditor.state !== "none") return fail("MALFORMED_INPUT", "auditor state must be none or engaged");
  if (policy.requireVerified && opts.verifyEvidence === undefined) return fail("VERIFIER_REQUIRED", "the policy requires verified evidence but no verifier was supplied");
  if (input.accounts.some((a) => typeof a !== "string" || a.length === 0)) return fail("MALFORMED_INPUT", "accounts must be non-empty text");
  const accounts = [...new Set(input.accounts)].sort();

  // Records
  const seen = new Set<string>();
  for (const r of input.records) {
    const bad = checkRecord(r);
    if (bad !== undefined) return fail("BAD_RECORD", bad);
    if (seen.has(r.id)) return fail("DUPLICATE_RECORD", r.id);
    seen.add(r.id);
  }
  const records = [...input.records].sort(byId);
  const byRecord = new Map(records.map((r) => [r.id, r]));

  // Sources
  const sourceByHash = new Map<Hash, Source>();
  for (const s of input.sources) {
    if (!isHash(s?.hash) || typeof s.label !== "string" || ![1, 2, 3, 4].includes(s.trust)) return fail("BAD_SOURCE", "a source needs a hash, a label and a trust level 1-4");
    if (sourceByHash.has(s.hash)) return fail("BAD_SOURCE", `duplicate source ${s.hash}`);
    sourceByHash.set(s.hash, s);
  }
  for (const r of records) if (!sourceByHash.has(r.sourceDocument)) return fail("MISSING_SOURCE", `${r.id} comes from a document that is not listed as a source`);
  const sources = [...sourceByHash.values()].sort((a, b) => (a.hash < b.hash ? -1 : 1));
  const used = new Set(records.map((r) => r.sourceDocument));
  const weakestTrust = sources.filter((s) => used.has(s.hash)).reduce<TrustLevel | undefined>((w, s) => (w === undefined || s.trust > w ? s.trust : w), undefined);

  // Evidence
  const evByHash = new Map<Hash, Evidence>();
  for (const e of evidence) {
    if (!isHash(e?.hash) || !ALL_KINDS.includes(e.kind) || !Array.isArray(e.covers) || e.covers.some((c) => typeof c !== "string") || (e.issuer !== undefined && typeof e.issuer !== "string")) return fail("BAD_EVIDENCE", "evidence needs a hash, a kind and a list of record ids");
    if (evByHash.has(e.hash)) return fail("BAD_EVIDENCE", `duplicate evidence ${e.hash}`);
    const unknown = e.covers.find((c) => !byRecord.has(c));
    if (unknown !== undefined) return fail("BAD_EVIDENCE", `evidence ${e.hash} covers an unknown record ${unknown}`);
    evByHash.set(e.hash, e);
  }

  // Statements: opening + movements = closing, contiguous periods chain
  const cov = checkStatements(statements, records, sourceByHash);
  if (!("coverage" in cov)) return cov;

  // Packs
  const ids = new Set<string>();
  const packResults: PackResult[] = [];
  const counts = (e: Evidence) => policy.accepts.includes(e.kind) && (policy.issuers[e.kind] === undefined || (e.issuer !== undefined && policy.issuers[e.kind]!.includes(e.issuer))) && (!policy.requireVerified || opts.verifyEvidence!(e) === true);
  for (const { pack, params } of input.packs) {
    if (typeof pack?.id !== "string" || typeof pack.version !== "string" || typeof pack.evaluate !== "function" || typeof params !== "object" || params === null) return fail("MALFORMED_INPUT", "each pack needs an id, a version, evaluate and parameters");
    if (ids.has(pack.id)) return fail("MALFORMED_INPUT", `pack ${pack.id} listed twice`);
    ids.add(pack.id);
    let raw: RawFinding[], pHash: Hash;
    try {
      pHash = paramsHash(params);
      raw = pack.evaluate(records, params);
    } catch (e) {
      return fail("PACK_ERROR", `${pack.id}@${pack.version}: ${(e as Error).message}`);
    }
    if (!Array.isArray(raw)) return fail("PACK_ERROR", `${pack.id}: evaluate must return a list`);
    const findings: ReportedFinding[] = [];
    for (const f of raw) {
      if (typeof f?.code !== "string" || typeof f.detail !== "string" || !Array.isArray(f.recordIds) || f.recordIds.length === 0 || f.recordIds.some((i) => !byRecord.has(i))) return fail("BAD_FINDING", `${pack.id}: a finding must name existing records`);
      const recordIds = [...new Set(f.recordIds)].sort();
      // Explained: one evidence item, of an accepted kind and issuer, that every record of the finding both references
      // (by hash, inside its committed leaf) and is named by (covers).
      const explainedBy = [...evByHash.values()]
        .filter((e) => recordIds.every((i) => e.covers.includes(i) && byRecord.get(i)!.evidence.includes(e.hash)) && counts(e))
        .map((e) => e.hash).sort();
      findings.push({ ruleId: pack.id, code: f.code, recordIds, detail: f.detail, explainedBy });
    }
    findings.sort((a, b) => (a.recordIds.join("\0") + a.code < b.recordIds.join("\0") + b.code ? -1 : 1));
    const outcome: Outcome = findings.length === 0 ? "pass" : findings.every((f) => f.explainedBy.length > 0) ? "explained" : "open";
    packResults.push({ id: pack.id, version: pack.version, paramsHash: pHash, examined: records.length, outcome, findings });
  }
  packResults.sort((a, b) => (a.id < b.id ? -1 : 1));

  const commitment = commitRecords(records);
  const clean = packResults.every((p) => p.outcome !== "open");
  const limits = [LIMIT_RECORDS, LIMIT_CRITERIA, LIMIT_EVIDENCE];
  if (!cov.coverage.complete) limits.push("The completeness checks are incomplete: some records are not covered by a chained statement, or a period between statements is not covered. Records may be missing.");
  if (weakestTrust !== undefined && weakestTrust >= 3) limits.push("At least one source is an unsigned file or a manual entry. The records are only as reliable as that source.");
  if (!clean) limits.push("The result is NOT clean: at least one finding has no evidence that explains it.");
  limits.push(auditor.state === "none" ? "No auditor took part in this review." : `An auditor is engaged (key ${auditor.key}). The auditor's signature on the package hash is checked separately.`);

  const evidenceList = [...evByHash.values()].map((e) => ({ hash: e.hash, kind: e.kind, covers: [...e.covers].sort(), issuer: e.issuer })).sort((a, b) => (a.hash < b.hash ? -1 : 1));
  const report: Report = { commitment, accounts, sources, weakestTrust, evidence: evidenceList, packs: packResults, clean, coverage: cov.coverage, auditor, policy: { ...policy, issuers: policy.issuers }, limits };
  return { valid: true, report, packageHash: sha(pad32(TAG_REPORT), field(canon(report))) };
}

function checkStatements(statements: Statement[], records: LedgerRecord[], sources: Map<Hash, Source>): Result | { coverage: Coverage } {
  const keyOf = (src: Hash, asset: string) => `${src}\0${asset}`;
  const byKey = new Map<string, Statement>();
  for (const s of statements) {
    if (typeof s?.id !== "string" || !isHash(s.sourceDocument) || typeof s.asset !== "string" || typeof s.from !== "bigint" || typeof s.to !== "bigint" || typeof s.opening !== "bigint" || typeof s.closing !== "bigint" || s.to <= s.from) return fail("BAD_STATEMENT", "a statement needs an id, a source document, an asset, a period from < to, and opening and closing balances");
    if (!sources.has(s.sourceDocument)) return fail("BAD_STATEMENT", `statement ${s.id} names a document that is not a source`);
    if (byKey.has(keyOf(s.sourceDocument, s.asset))) return fail("BAD_STATEMENT", `two statements for ${s.asset} in one document`);
    byKey.set(keyOf(s.sourceDocument, s.asset), s);
  }
  const sums = new Map<string, { sum: bigint; n: number }>();
  const unchained: string[] = [];
  for (const r of records) {
    const s = byKey.get(keyOf(r.sourceDocument, r.asset));
    if (s === undefined) { unchained.push(r.id); continue; }
    if (r.time < s.from || r.time >= s.to) return fail("RECORD_OUTSIDE_STATEMENT", `${r.id} is dated outside the period of statement ${s.id}`);
    const cur = sums.get(s.id) ?? { sum: 0n, n: 0 };
    sums.set(s.id, { sum: cur.sum + r.amount, n: cur.n + 1 });
  }
  const list = [...byKey.values()].sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  for (const s of list) {
    const got = sums.get(s.id) ?? { sum: 0n, n: 0 };
    if (s.opening + got.sum !== s.closing) return fail("STATEMENT_BREAK", `statement ${s.id}: opening ${s.opening} plus movements ${got.sum} is not closing ${s.closing}`);
  }
  const gaps: Coverage["gaps"] = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]!, b = list[i]!;
    if (a.asset !== b.asset) continue;
    if (b.from < a.to) return fail("STATEMENT_BREAK", `statements ${a.id} and ${b.id} overlap`);
    if (b.from > a.to) gaps.push({ asset: a.asset, from: a.to, to: b.from });
    else if (b.opening !== a.closing) return fail("STATEMENT_BREAK", `statement ${b.id} opens at ${b.opening} but ${a.id} closed at ${a.closing}`);
  }
  const coverage: Coverage = {
    statements: list.map((s) => ({ id: s.id, asset: s.asset, records: sums.get(s.id)?.n ?? 0 })),
    unchainedRecords: unchained,
    gaps,
    complete: list.length > 0 && unchained.length === 0 && gaps.length === 0,
  };
  return { coverage };
}
