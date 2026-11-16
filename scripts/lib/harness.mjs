// Shared helpers for runtime-check.mjs and prove.mjs: load the compiled contracts and golden
// vectors, and run circuits against an in-memory contract state (no node needed).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as rt from "@midnight-ntwrk/compact-runtime";

export { rt };
export const loadVectors = (name) => JSON.parse(readFileSync(new URL(`../../test/vectors/${name}`, import.meta.url), "utf8"));
export const loadContract = (name) => import(pathToFileURL(resolve(`managed/${name}/contract/index.js`)).href);
export const bytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const pad32 = (t) => Buffer.concat([Buffer.from(t, "ascii"), Buffer.alloc(32 - t.length)]);
/** persistentHash([pad(32, tag), secret]); equals SHA-256 of the concatenation (crosscheck:hashes). */
export const adminCommitment = (tag, secret) => Uint8Array.from(createHash("sha256").update(pad32(tag)).update(secret).digest());
export const COIN_PK = "00".repeat(32);

// compact-runtime 0.16.0 (ledger 8) takes positional arguments; 0.21.0 (ledger 9) takes an options
// object with the circuit name. Both are supported so the same checks run on either ledger.
const OPTIONS_API = rt.createCircuitContext.length === 1;
// dummyContractAddress: sampleContractAddress needs a WebCrypto global that Node 18 lacks.
const makeCtx = (circuitId, zswapOrKey, state, privateState) =>
  OPTIONS_API
    ? rt.createCircuitContext({ circuitId, contractAddress: rt.dummyContractAddress(), coinPublicKeyOrZswapState: zswapOrKey, contractState: state, privateState })
    : rt.createCircuitContext(rt.dummyContractAddress(), zswapOrKey, state, privateState);

// The context shape differs too: 0.16.0 keeps the query context and private state at the top level,
// 0.21.0 nests them under `callContext` and keeps proof data in `callProofDataTrace`.
const cc = (ctx) => ctx.callContext ?? ctx;
export const stateOf = (ctx) => cc(ctx).currentQueryContext.state;
export const proofDataOf = (result) => result.proofData ?? result.context.callProofDataTrace?.at(-1);

/** Deploy a contract in memory; `call` runs an impure circuit and carries the state forward. */
// Circuits and initialState return Promises on ledger 9 and plain values on ledger 8; always await.
export const deploy = async (Contract, witnesses, privateState, ...ctorArgs) => {
  const c = new Contract(witnesses);
  const init = await c.initialState(rt.createConstructorContext(privateState, COIN_PK), ...ctorArgs);
  let ctx = makeCtx("constructor", COIN_PK, init.currentContractState, privateState);
  return {
    c,
    initialState: init.currentContractState,
    get ctx() {
      return ctx;
    },
    set ctx(v) {
      ctx = v;
    },
    get state() {
      return stateOf(ctx);
    },
    setPrivate(ps) {
      ctx = OPTIONS_API ? { ...ctx, callContext: { ...ctx.callContext, currentPrivateState: ps } } : { ...ctx, currentPrivateState: ps };
    },
    async call(name, ...args) {
      // The options API binds a context to one circuit, so rebuild it from the evolving state.
      if (OPTIONS_API) ctx = makeCtx(name, cc(ctx).currentZswapLocalState, stateOf(ctx), cc(ctx).currentPrivateState);
      const r = await c.impureCircuits[name](ctx, ...args);
      ctx = r.context;
      return r;
    },
  };
};

export const amlScenario = async () => {
  const { Contract, ledger } = await loadContract("AML_Gate");
  const m = loadVectors("nonmembership-vectors.json").nonMember;
  const adminSecret = Uint8Array.from(Buffer.alloc(32, 7));
  const witnesses = {
    wit_subject_key: ({ privateState: p }) => [p, p.key],
    wit_range_lo: ({ privateState: p }) => [p, p.lo],
    wit_range_hi: ({ privateState: p }) => [p, p.hi],
    wit_path_siblings: ({ privateState: p }) => [p, p.siblings],
    wit_path_is_right: ({ privateState: p }) => [p, p.isRight],
    wit_receipt_nonce: ({ privateState: p }) => [p, p.nonce],
    wit_admin_secret: ({ privateState: p }) => [p, p.adminSecret],
  };
  const good = {
    key: BigInt(m.key), lo: BigInt(m.lo), hi: BigInt(m.hi),
    siblings: m.siblings.map(bytes), isRight: m.isRight,
    nonce: Uint8Array.from(Buffer.alloc(32, 9)), adminSecret,
  };
  const fresh = (priv = good, root = m.root) =>
    deploy(Contract, witnesses, priv, bytes(root), adminCommitment("ce.admin.v1", adminSecret));
  return { ledger, m, good, adminSecret, fresh };
};

export const porScenario = async () => {
  const { Contract, ledger } = await loadContract("PoR");
  const v = loadVectors("por-vectors.json");
  const node = (n) => ({ hash: bytes(n.hash), sum: BigInt(n.sum) });
  const adminSecret = Uint8Array.from(Buffer.alloc(32, 5));
  const witnesses = {
    wit_root_left: ({ privateState: p }) => [p, p.left],
    wit_root_right: ({ privateState: p }) => [p, p.right],
    wit_admin_secret: ({ privateState: p }) => [p, p.adminSecret],
  };
  const good = { left: node(v.tree.rootChildren.left), right: node(v.tree.rootChildren.right), adminSecret };
  const fresh = (priv = good) => deploy(Contract, witnesses, priv, adminCommitment("ce.por.admin.v1", adminSecret));
  return { ledger, v, good, adminSecret, fresh, total: BigInt(v.tree.root.sum), reservePackage: bytes("ab".repeat(32)) };
};
