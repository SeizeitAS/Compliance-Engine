import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { schnorrVerify } from "../src/por/schnorr.ts";
import { verifyMidnightProof, midnightSignedMessage } from "../src/por/midnight.ts";

const h = (s: string) => Buffer.from(s, "hex");
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();

// ---- official BIP-340 test vectors (bips/bip-0340/test-vectors.csv) ----
test("BIP-340 official vectors", () => {
  const vectors: Array<[string, string, string, boolean]> = [
    ["F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9", "00".repeat(32),
      "E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0", true],
    ["DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659", "243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89",
      "6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A", true],
  ];
  for (const [pk, m, sig, ok] of vectors) assert.equal(schnorrVerify(h(pk), h(m), h(sig)), ok);
  // the same signature must fail for another message or key, and a public key that is not on the curve must fail
  assert.equal(schnorrVerify(h(vectors[0]![0]), h("01" + "00".repeat(31)), h(vectors[0]![2])), false);
  assert.equal(schnorrVerify(h(vectors[1]![0]), h(vectors[0]![1]), h(vectors[0]![2])), false);
  assert.equal(schnorrVerify(h("EEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34"), h("243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89"), h(vectors[1]![2])), false);
});

test("schnorrVerify rejects out-of-range and malformed input without throwing", () => {
  const pk = h("F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9");
  const sig = h("E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0");
  const m = h("00".repeat(32));
  assert.equal(schnorrVerify(pk.subarray(0, 31), m, sig), false);
  assert.equal(schnorrVerify(pk, m, sig.subarray(0, 63)), false);
  const sBig = Buffer.concat([sig.subarray(0, 32), h("FF".repeat(32))]); // s >= n
  assert.equal(schnorrVerify(pk, m, sBig), false);
  const rBig = Buffer.concat([h("FF".repeat(32)), sig.subarray(32)]); // r >= p
  assert.equal(schnorrVerify(pk, m, rBig), false);
});

// ---- signatures made by the Midnight ledger's own signData (ledger-v9, wallet SDK 2.0.0), throwaway keys ----
// The ledger signs the SHA-256 digest of the bytes it is given, with BIP-340. Lengths 0, 1, 31, 32, 33, 59 and 100.
const LEDGER: Array<{ vk: string; msg: string; sig: string }> = [
  { vk: "f3e8aca9806ec73681a1b95bd5e2a084041bffea2cfa1f42651482aea7fbc6e9", msg: "", sig: "8bd21adea348e78cb50b9613d5df64c27ad574489077a91fc0da5a9272e9444090efc0b679f3665078759a2047fe5045abca210a354168079b3079ce6ade1c87" },
  { vk: "d33c41968520cfbbb672e0995405b04585109afe3cd1a51d33ad0b28ecef3a51", msg: "01", sig: "d31b5db81ae930a2eb2c156fdcb97e07f74ff25f6c42ed09a120063e5ddbb19d02e63feb73915faf1bbb9dc4eb596778865f6f78afcedfce70e586df0861d7f7" },
  { vk: "e239a41a3cda2625b94b8969e94b8938780e5a480fdaaa62e18583fd1854fc74", msg: "1f2a35404b56616c77828d98a3aeb9c4cfdae5f0fb06111c27323d48535e69", sig: "1ab5d307fdd7358b36d73222b239fb79790e00d660cb158cf279e27f7094bd2dbf5622b0ae0f1278d3ef150ea43ad2d66d9f3147bcbf51350205c778467b2621" },
  { vk: "0f302fc064fdba347008ee41fc498e00dee632eefa69ba6ce94ee8490f4265ad", msg: "202b36414c57626d78838e99a4afbac5d0dbe6f1fc07121d28333e49545f6a75", sig: "67f5422ae2b795a9b6f26e4cfa8683fb2535a07babafb7e30a8a21516ebb7fba6afeccefae5921c61ce0f02a1004643595a541055a05d4c005e662b19e2b8ace" },
  { vk: "ae2cbd97826d3b8f5d522e6b9fd33daaec3a733b0c751087085d833cf5fe1bf7", msg: "212c37424d58636e79848f9aa5b0bbc6d1dce7f2fd08131e29343f4a55606b7681", sig: "7402a6d6ed620a16c8e9b331d038cd8f727e50b691428fd74924e3e6c77a4e2b8254403dcaab5458ea7dbbf4fceac22eaa52fc61b61e7b07618082620540a1d7" },
  { vk: "799a462e7cde70727fa8167a00722b4ba14f37b9aeffb9e5a7868d465964603a", msg: "3b46515c67727d88939ea9b4bfcad5e0ebf6010c17222d38434e59646f7a85909ba6b1bcc7d2dde8f3fe09141f2a35404b56616c77828d98a3aeb9", sig: "f446b3c65861f37ea8b0b0cae765baa1e01f493f99673a475ef7caf56dee3affdba175b4581d246c59e5feec515be8e0c2f290b838db059df767a9ef03ac26de" },
  { vk: "d0a873936967c44d02b6f16af8b7d553e355804d6ebe7a0cd5f3c83a6abfd841", msg: "646f7a85909ba6b1bcc7d2dde8f3fe09141f2a35404b56616c77828d98a3aeb9c4cfdae5f0fb06111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e19242f3a45505b66717c87929da8b3bec9d4dfeaf5000b16212c37424d58636e79848f9aa5", sig: "02cd2eabf76b6a269df12cdcf326de292e168bdd4cab1f4538bf86f982e8af3d9a2dc602b1569825a8508ee5d2286537789ba3162f87d090b7d9af9f2b3952af" },
];
test("signatures made by the Midnight ledger verify over SHA-256 of the signed bytes, and not over the raw bytes", () => {
  for (const r of LEDGER) {
    assert.equal(schnorrVerify(h(r.vk), sha256(h(r.msg)), h(r.sig)), true, `length ${r.msg.length / 2}`);
    assert.equal(schnorrVerify(h(r.vk), h(r.msg), h(r.sig)), false, `raw, length ${r.msg.length / 2}`);
  }
});

// ---- Midnight control proofs: framed challenge, signed by the ledger's signData with throwaway keys ----
const PROOFS = [
  { challenge: "4b6b26975150c7a112fd45d4000b2edc5217aca80b0832f47958b414bc6d1f6a", vk: "5bf6f5035793171ac58efec0ba883ad84b6daad9727426f81a69ed8f4f44d4ff", address: "65b90d6688f85ad268bbc1723f456dca981fd97552d1a9cf6418dc7c938e4861",
    sig: "89cb1f26a6b1851abff77639a79b35c21cd15a24f43a3c0340b357e32f591fa74ed4b84d6c20f73c5fdd91c853a3f7f003d692565a820eafa682848a64d15cf0",
    sigUnframed: "0eab086c6ee2fdf9450c0b2c30f22707080b72095d831c5880e45217c6e22eec2298735fa5d2811416335d206bbc501fc861dcf768c8380ec3bb6d251baedd7e" },
  { challenge: "8bc4b03ee61c6a68b3f74b2adc40e9c0c8587245199256c51e352adcafe95925", vk: "1e51b74193d564d14fed6833bc41bac45e6af15b7edf460eb1386f900fb28733", address: "3f684a941d1bcbb06d2ecfe4f7a29ed12fff7604764c13750a797062530e7297",
    sig: "602657a9162e6170d4e46a91afed327762f24b793a89a2631e5c0eaa8e6e5d4f0fb07623619978a06d9e1f30f1713a4c8e73b0c14b365c8efb6df2316829a7ac",
    sigUnframed: "27adac84e9269ebc8f992ce38ce0bd3e47e83d9a51995aa8dada90d9ae282a5c8bc7f9a3de372fad4cc711a40a038189c6664e874909230112f329afc7bab1d2" },
  { challenge: "b7de4edc155cae55ce3a6afd5105c27aa2fd7460171d135cdb7831dd9f126ece", vk: "66775d54126c6f4aeef88edf6e1b1be4b7ca882722b8840d23fb13367836fd54", address: "5b3b364024297da4b4690a92cb5ec09f1721f72fc3902b9b0d4fbfd7b8e0c9b7",
    sig: "a7621138951813073c3978c9620f5bb212681990471a9966428da5a59b67cac934d3c1c8c85a4fbd113dda822748166d8531d8b3f1c6a9ddb3a8b6e57d56dc34",
    sigUnframed: "7a3ab82675c096d573c6cb7fd44e5a84230a876f55626932b8f62018c9a9e80610700e8bc815591308cdbacf3be1d6f08a80f2986913add2c0396c711180dafb" },
];
const reason = (r: { valid: boolean }) => (r as { reason: string }).reason;
const p0 = PROOFS[0]!;
const input = (p = p0, extra: Record<string, string> = {}) => ({ challenge: p.challenge, address: p.address, verifyingKey: p.vk, signature: p.sig, ...extra });

test("the connector frame is 'midnight_signed_message:<size>:' followed by the data", () => {
  assert.equal(midnightSignedMessage(h("aabb")).toString("latin1"), "midnight_signed_message:2:\xaa\xbb");
  assert.equal(midnightSignedMessage(new Uint8Array(0)).toString("ascii"), "midnight_signed_message:0:");
  assert.equal(midnightSignedMessage(new Uint8Array(32)).subarray(0, 27).toString("ascii"), "midnight_signed_message:32:");
});

test("valid Midnight control proofs verify", () => {
  for (const p of PROOFS) {
    const r = verifyMidnightProof({ ...input(p), scheme: "schnorr_bip340" });
    assert.ok(r.valid, JSON.stringify(r));
    assert.ok(verifyMidnightProof(input(p)).valid, "scheme absent means schnorr_bip340");
  }
});

test("a signature over the unframed challenge is rejected (the frame is what makes it a message signature)", () => {
  assert.equal(reason(verifyMidnightProof(input(p0, { signature: p0.sigUnframed }))), "BAD_SIGNATURE");
});

test("another challenge, another key and a tampered signature are rejected", () => {
  assert.equal(reason(verifyMidnightProof(input(p0, { challenge: "cd".repeat(32) }))), "BAD_SIGNATURE");
  const p1 = PROOFS[1]!;
  assert.equal(reason(verifyMidnightProof(input(p0, { signature: p1.sig }))), "BAD_SIGNATURE"); // another proof's signature
  assert.equal(reason(verifyMidnightProof(input(p0, { verifyingKey: p1.vk }))), "ADDRESS_MISMATCH"); // key does not own the address
  assert.equal(reason(verifyMidnightProof(input(p1, { address: p0.address }))), "ADDRESS_MISMATCH");
  const flipped = (p0.sig.slice(0, 127) + (p0.sig[127] === "0" ? "1" : "0"));
  assert.equal(reason(verifyMidnightProof(input(p0, { signature: flipped }))), "BAD_SIGNATURE");
});

test("only the schnorr scheme is supported", () => {
  assert.equal(reason(verifyMidnightProof({ ...input(p0), scheme: "ecdsa_secp256k1_sha256" })), "UNSUPPORTED_SCHEME");
  assert.equal(reason(verifyMidnightProof({ ...input(p0), scheme: "" })), "UNSUPPORTED_SCHEME");
});

test("malformed Midnight input is rejected without throwing", () => {
  assert.equal(reason(verifyMidnightProof(input(p0, { challenge: "ab".repeat(31) }))), "MALFORMED_PROOF");
  assert.equal(reason(verifyMidnightProof(input(p0, { address: p0.address.toUpperCase() }))), "MALFORMED_PROOF");
  assert.equal(reason(verifyMidnightProof(input(p0, { verifyingKey: "zz".repeat(32) }))), "MALFORMED_PROOF");
  assert.equal(reason(verifyMidnightProof(input(p0, { signature: p0.sig.slice(0, 126) }))), "MALFORMED_PROOF");
  assert.equal(reason(verifyMidnightProof({ ...input(p0), signature: undefined as unknown as string })), "MALFORMED_PROOF");
});
