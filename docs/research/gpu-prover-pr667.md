# GPU prover for Midnight proofs (midnight-zk PR #667)

Recorded 2026-11-21 at the owner's request as input for the proving and node configuration of
**level 3 (large customer)**: the tier where proof volume or circuit size justifies dedicated GPU hardware.
Source: https://github.com/midnightntwrk/midnight-zk/pull/667, read 2026-11-21. Nothing here has been
built or run by us.

## Status (read this first)
- Title: "Add an optional CUDA prover behind the gpu feature". Author: Charles Hoskinson. **Open draft, not
  merged.** The PR itself says an independent audit found open items (a possible hang in batch proving,
  a socket/stderr deadlock risk, unchecked unsafe-audit items). Do not use it in production until it is
  merged and released upstream.
- Off by default. A stock build is unchanged; the PR states that keys and proofs with the feature off are
  byte-identical to stock.

## What it adds
- `midnight-proofs` feature `gpu`: hooks for BLS12-381 G1 MSM, FFT/iFFT and the quotient. A hook either
  returns the stock result or declines, and declined work runs on the CPU. Transcript, blinding and
  verifier-visible values stay in stock code. `gpu` implies `prover-par` (parallel batch inversion).
- `midnight-gpu`: CUDA backend (patched sppark for MSM and NTT), feature `cuda`. Without it every call declines.
- `midnight-metal`: Apple GPU backend, macOS only, feature `metal`. No performance numbers yet.
- `midnight-gpu-prover`: a local proving daemon with CPU fallback, device lease, admission control, restart
  cap, client-side breaker and a container image. Holds one proving key resident.
- `prove_batch`: several proofs at once in waves sized by GPU memory; a batched proof is stated to be
  byte-identical to the same proof made alone.

## Reported numbers (from the PR, not measured by us)
RTX 5090 Laptop (24 GB) and Core Ultra 9 275HX, warm median, measured before the latest rebase:

| k | CPU s | GPU s | Speed-up | GPU memory peak |
|---|---|---|---|---|
| 16 | 0.566 | 0.199 | 2.84x | 90 MB |
| 18 | 2.130 | 0.693 | 3.07x | 272 MB |
| 20 | 8.549 | 2.282 | 3.75x | 1.0 GB |
| 21 | 17.917 | 4.374 | 4.10x | 2.0 GB |

Small circuits gain little (1.48x at k=14; the cold first proof is slower than CPU). Batching at k=16 gave
only 2.21 vs 1.91 proofs/s at batch 8. Other contributors report 2.2 to 2.6x (NVIDIA GB10) and 1.07 to
1.92x (RTX 4060 Laptop 8 GB, WSL2), not verified here.

## Relevance for us
- Our `prove_not_sanctioned` takes about 112 s on a 4-core host (SR-14, CE-28). A local GPU prover keeps
  private inputs on our own hardware, unlike remote proving (CE-28), so it fits the rule that the proof
  server stays under our control (`docs/network-plan.md`).
- Level 3 sizing: an NVIDIA GPU with CUDA and about 8 GB or more VRAM is enough for k up to 21 by the table
  above; CPU and RAM still matter because declined and small work runs on the CPU.
- Operator notes from the PR that apply even without a GPU:
  - The stock proof server 9.0.1 binds all interfaces and has no bind option. Isolate it (loopback-only
    network namespace, firewall or a Docker network without published ports).
  - At the pinned versions zkir can log private inputs at error level under target `midnight_zkir` when a
    tracing subscriber is installed; the stock server filters only `zkir`. Check the log filter.
- Next step when the PR is merged and released: measure our three proving circuits with and without `gpu`
  on the production machine candidate, and record the result in `docs/proving.md`.
