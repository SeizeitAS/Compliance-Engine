// Cross-check the COMPILED PoR circuit against the TypeScript reference (golden vectors).
//   npm run contracts:compile && npm run crosscheck:por [managed/PoR]
// Needs @midnight-ntwrk/compact-runtime (see docs/toolchain.md).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "managed/PoR");
const v = JSON.parse(readFileSync(new URL("../test/vectors/por-vectors.json", import.meta.url), "utf8"));
const pc = (await import(pathToFileURL(`${dir}/contract/index.js`).href)).pureCircuits;
if (!pc) throw new Error("compiled contract exports no pureCircuits");

const hex = (b) => Buffer.from(b).toString("hex");
const bytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const node = (n) => ({ hash: bytes(n.hash), sum: BigInt(n.sum) });
let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   circuit:   ${got}\n   reference: ${want}`}`);
};
const show = (n) => `${hex(n.hash)}:${n.sum}`;

v.hashLeaf.forEach((x, i) => check(`hash_leaf[${i}]`, hex(pc.hash_leaf(bytes(x.accountIdHash), bytes(x.salt), BigInt(x.balance))), x.out));
v.hashNode.forEach((x, i) => check(`hash_node[${i}]`, show(pc.hash_node(node(x.left), node(x.right))), `${x.out.hash}:${x.out.sum}`));
const m = v.inclusion;
check(
  "verify_inclusion (depth 20 path, root and total)",
  show(pc.verify_inclusion(bytes(m.accountIdHash), bytes(m.salt), BigInt(m.balance), m.siblingHashes.map(bytes), m.siblingSums.map(BigInt), m.isRight)),
  `${m.root.hash}:${m.root.sum}`,
);

console.log(failures ? `\n${failures} mismatch(es). Do not trust the circuit until resolved.` : "\nAll PoR circuit outputs match the reference implementation.");
process.exit(failures ? 1 : 0);
