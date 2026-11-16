// Cross-check the COMPILED circuit against the TypeScript reference (golden vectors).
// Run on a machine with the Compact compiler:
//   npm run contracts:compile && npm run crosscheck:circuit [managed/AML_Gate]
// Passes only if the circuit's pure functions produce byte-identical hashes and Merkle roots.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "managed/AML_Gate");
const vectors = JSON.parse(readFileSync(new URL("../test/vectors/nonmembership-vectors.json", import.meta.url), "utf8"));
const mod = await import(pathToFileURL(`${dir}/contract/index.js`).href);
const pc = mod.pureCircuits;
if (!pc) throw new Error("compiled contract exports no pureCircuits; check the compiler output directory");

const hex = (b) => Buffer.from(b).toString("hex");
const bytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));
let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   circuit:   ${got}\n   reference: ${want}`}`);
};

vectors.hashLeaf.forEach((v, i) => check(`hash_leaf[${i}]`, hex(pc.hash_leaf(BigInt(v.lo), BigInt(v.hi))), v.out));
vectors.hashNode.forEach((v, i) => check(`hash_node[${i}]`, hex(pc.hash_node(bytes(v.left), bytes(v.right))), v.out));
const m = vectors.nonMember;
check("compute_root (depth 20 path)", hex(pc.compute_root(bytes(m.leaf), m.siblings.map(bytes), m.isRight)), m.root);

console.log(failures ? `\n${failures} mismatch(es). Do not trust the circuit until resolved (see docs/toolchain.md).` : "\nAll circuit outputs match the reference implementation.");
process.exit(failures ? 1 : 0);
