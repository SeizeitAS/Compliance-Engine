import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { keccak256, sponge256 } from "../src/por/keccak.ts";

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
const input = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 5) & 255);

test("the sponge with the SHA3 padding equals node:crypto sha3-256 around the rate boundary (136 bytes)", () => {
  for (const n of [0, 1, 3, 32, 100, 134, 135, 136, 137, 200, 271, 272, 273, 500, 1000]) {
    assert.equal(hex(sponge256(input(n), 0x06)), createHash("sha3-256").update(input(n)).digest("hex"), `length ${n}`);
  }
});

test("Keccak-256 known Ethereum vectors", () => {
  const k = (s: string) => hex(keccak256(Buffer.from(s, "utf8")));
  assert.equal(k(""), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(k("abc"), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  assert.equal(k("hello"), "1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8");
  assert.equal(k("The quick brown fox jumps over the lazy dog"), "4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15");
});

test("Keccak-256 differs from SHA3-256 (the padding byte)", () => {
  assert.notEqual(hex(keccak256(Buffer.from("abc"))), createHash("sha3-256").update("abc").digest("hex"));
});
