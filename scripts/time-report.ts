// Summarises docs/time/timelog.csv: hours per sprint, per task and per person.
// Usage: node scripts/time-report.ts docs/time/timelog.csv
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "docs/time/timelog.csv";
const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
const [header, ...rows] = lines;
const cols = header.split(",");
const idx = (n: string) => {
  const i = cols.indexOf(n);
  if (i < 0) throw new Error(`missing column ${n}`);
  return i;
};
const sums = { sprint: new Map<string, number>(), task: new Map<string, number>(), person: new Map<string, number>() };
let total = 0;
rows.forEach((row, n) => {
  const c = row.split(",");
  const hours = Number(c[idx("hours")]);
  if (!Number.isFinite(hours) || hours === 0 || Math.abs(hours) > 24) throw new Error(`row ${n + 2}: invalid hours "${c[idx("hours")]}"`);
  for (const [k, col] of [["sprint", "sprint"], ["task", "task_id"], ["person", "person"]] as const) {
    sums[k].set(c[idx(col)], (sums[k].get(c[idx(col)]) ?? 0) + hours);
  }
  total += hours;
});
for (const [k, m] of Object.entries(sums)) {
  console.log(`\nHours per ${k}`);
  for (const [name, h] of [...m].sort()) console.log(`  ${name.padEnd(12)} ${h.toFixed(2)}`);
}
console.log(`\nTotal ${total.toFixed(2)} h`);
