/**
 * The first rule packs (CE-34, CE-31). The limit is a parameter the criteria owner supplies: nothing here states a legal
 * limit. Both packs are pure, use integer arithmetic only, and report a record they cannot evaluate (no value) as a finding.
 *
 *  - `reporting-limit`: a movement whose value reaches or exceeds the limit (>=), optionally only inflows or outflows.
 *  - `unexplained`: a movement at or above the limit that has no voucher or approval attached at all.
 *
 * Both name records by id only; whether a finding is explained is decided by the engine from the evidence.
 */
import type { LedgerRecord } from "./records.ts";
import type { Params, RawFinding, RulePack } from "./engine.ts";

function only(params: Params, allowed: string[]): void {
  for (const k of Object.keys(params)) if (!allowed.includes(k)) throw new Error(`unexpected parameter ${k}`);
}
function limit(params: Params): bigint {
  const v = params.limitNokOre;
  if (typeof v !== "bigint" || v <= 0n) throw new Error("limitNokOre must be a positive integer (NOK ore)");
  return v;
}

export const reportingLimit: RulePack = {
  id: "reporting-limit",
  version: "1.0.0",
  evaluate(records: readonly LedgerRecord[], params: Params): RawFinding[] {
    only(params, ["limitNokOre", "direction"]);
    const lim = limit(params);
    const dir = params.direction ?? "any";
    if (dir !== "any" && dir !== "in" && dir !== "out") throw new Error("direction must be any, in or out");
    const out: RawFinding[] = [];
    for (const r of records) {
      if ((dir === "in" && r.amount <= 0n) || (dir === "out" && r.amount >= 0n)) continue;
      if (r.valueNokOre === undefined) {
        out.push({ code: "UNVALUED", recordIds: [r.id], detail: `${r.id} has no value in NOK, so it cannot be compared with the limit` });
      } else if (r.valueNokOre >= lim) {
        out.push({ code: "AT_OR_ABOVE_LIMIT", recordIds: [r.id], detail: `${r.id} is worth ${r.valueNokOre} ore, at or above the limit of ${lim} ore` });
      }
    }
    return out;
  },
};

export const unexplained: RulePack = {
  id: "unexplained",
  version: "1.0.0",
  evaluate(records: readonly LedgerRecord[], params: Params): RawFinding[] {
    only(params, ["limitNokOre"]);
    const lim = limit(params);
    const out: RawFinding[] = [];
    for (const r of records) {
      if (r.evidence.length > 0) continue;
      if (r.valueNokOre === undefined) {
        out.push({ code: "UNVALUED", recordIds: [r.id], detail: `${r.id} has no value in NOK and no voucher or approval` });
      } else if (r.valueNokOre >= lim) {
        out.push({ code: "NO_EVIDENCE", recordIds: [r.id], detail: `${r.id} is worth ${r.valueNokOre} ore, at or above ${lim} ore, and has no voucher or approval` });
      }
    }
    return out;
  },
};

export const PACKS: Record<string, RulePack> = { [reportingLimit.id]: reportingLimit, [unexplained.id]: unexplained };
