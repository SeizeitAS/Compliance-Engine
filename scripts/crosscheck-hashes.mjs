// Pre-compiler check: does Midnight's persistentHash equal SHA-256 over our byte layout?
// Needs the Midnight runtime: npm install --no-save @midnight-ntwrk/compact-runtime
// Usage: node scripts/crosscheck-hashes.mjs
import { createHash } from "node:crypto";
const rt = await import("@midnight-ntwrk/compact-runtime");

const pad32 = (t) => { const b = Buffer.alloc(32); b.write(t, "ascii"); return b; };
const le32 = (n) => { const b = Buffer.alloc(32); for (let i = 0, v = n; i < 32 && v > 0n; i++, v >>= 8n) b[i] = Number(v & 0xffn); return b; };
const sha = (...p) => { const h = createHash("sha256"); p.forEach((x) => h.update(x)); return h.digest("hex"); };

const type = new rt.CompactTypeVector(3, new rt.CompactTypeBytes(32));
const a = pad32("ce.node.v1"), b = createHash("sha256").update("x").digest(), c = createHash("sha256").update("y").digest();
const got = Buffer.from(rt.persistentHash(type, [a, b, c])).toString("hex");
const want = sha(a, b, c);
console.log(got === want ? "PASS  persistentHash<Vector<3,Bytes<32>>> == SHA-256(concatenation)" : `FAIL  persistentHash differs from SHA-256(concat)\n   runtime:   ${got}\n   reference: ${want}`);

// Field -> Bytes<32> byte order is checked by scripts/crosscheck-circuit.mjs (hash_leaf vectors).
console.log("Number byte order (`x as Field as Bytes<32>`) is verified by crosscheck-circuit.mjs, not here.");
process.exit(got === want ? 0 : 1);
