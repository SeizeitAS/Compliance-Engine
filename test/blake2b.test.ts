import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { blake2b } from "../src/por/blake2b.ts";

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
const input = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);

test("blake2b-512 equals node:crypto for lengths around the block boundaries", () => {
  for (const n of [0, 1, 3, 32, 64, 127, 128, 129, 255, 256, 257, 1000]) {
    const expected = createHash("blake2b512").update(input(n)).digest("hex");
    assert.equal(hex(blake2b(input(n), 64)), expected, `length ${n}`);
  }
});

test("RFC 7693 vector: blake2b-512('abc')", () => {
  assert.equal(
    hex(blake2b(Buffer.from("abc"), 64)),
    "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
  );
});

// Generated with Python hashlib.blake2b(data, digest_size=28) for input(n) = bytes((i*7+3) & 255 for i in range(n)).
const B224: Array<[number, string]> = [
  [0, "836cc68931c2e4e3e838602eca1902591d216837bafddfe6f0c8cb07"],
  [1, "b16b56f5ec064be6ac3cab6035efae86b366cc3dc4a0d571603d70e5"],
  [3, "260c560845c9523e6ec38728114cd4389a13f5200b4a5603ba085c33"],
  [32, "03d210ed8e76167c7ce4d6be8035edcf718eb7749ccf6ef4e92bd1bb"],
  [127, "198497238de2eb5ecfd747bbda92fb0a895d6f21431582ffc9775a7d"],
  [128, "1e97c1e2b0b4945b759976c37f3e8168fd6afe29ae2d95e87d7e8cca"],
  [129, "24e90dabf80c32232a9a80be3e225fdf002405d0dc3b078616a8cd4c"],
  [255, "c5a185989e6f604fe14f688e7c35b0647ca1ec5ce791ebc9bf1f9ea6"],
  [256, "35d8532a0ef7e2a49d11024c41dd205119d36e522f7958e89b90d101"],
  [300, "f35e3f67a9852d5030d83d5cf0059993f7a7ce0055a6da7274fb2002"],
];
test("blake2b-224 (Cardano key hash length) matches Python hashlib", () => {
  for (const [n, expected] of B224) assert.equal(hex(blake2b(input(n), 28)), expected, `length ${n}`);
  assert.equal(hex(blake2b(Buffer.from("abc"), 28)), "9bd237b02a29e43bdd6738afa5b53ff0eee178d6210b618e4511aec8");
});

test("other output lengths work and differ (the length is part of the parameter block)", () => {
  assert.equal(hex(blake2b(Buffer.from("abc"), 32)), "bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319");
  assert.notEqual(hex(blake2b(Buffer.from("abc"), 28)), hex(blake2b(Buffer.from("abc"), 32)).slice(0, 56));
  assert.throws(() => blake2b(Buffer.from("abc"), 0));
  assert.throws(() => blake2b(Buffer.from("abc"), 65));
});
