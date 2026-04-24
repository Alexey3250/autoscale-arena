import { createHash, randomBytes } from "node:crypto";

// Baseline iterations tuned to roughly ~200ms of CPU on a mid-range 2024 x86
// core. The worker deployment requests 500m CPU, so this keeps a single
// request in the ~40-50% CPU range per pod, giving the HPA room to scale once
// a handful of concurrent requests pile on.
const BASELINE_ITERATIONS = 1_500_000;

export interface WorkResult {
  durationMs: number;
  iterations: number;
}

/**
 * Run a deterministic CPU-bound sha256 loop. Intensity multiplies the baseline
 * iteration count. We don't vary per-request input to keep comparisons fair.
 */
export function runCpuWork(intensity = 1): WorkResult {
  const iterations = Math.max(1, Math.floor(BASELINE_ITERATIONS * intensity));
  const seed = randomBytes(32);
  const start = performance.now();
  let digest = seed;
  for (let i = 0; i < iterations; i++) {
    digest = createHash("sha256").update(digest).digest();
  }
  // Touch the final digest so V8 cannot dead-code-eliminate the loop.
  globalThis.__lastDigestByte = digest[0];
  const durationMs = performance.now() - start;
  return { durationMs, iterations };
}

declare global {
  // Used to defeat dead-code elimination of the hash loop.
  var __lastDigestByte: number | undefined;
}
