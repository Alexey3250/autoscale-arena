import { createHash } from "node:crypto";

// Calibrated for the OpenShift Developer Sandbox, where each pod's CPU
// quota is small and shared. 20k sha256 rounds returns in ~100-300ms there
// and ~10-30ms on a developer laptop. Anything bigger starves liveness
// probes and the user-visible latency feels broken.
const DEFAULT_ITERATIONS = 20_000;

// Hashes per synchronous chunk before we yield to the event loop. With
// 1k iterations per chunk, the longest synchronous block on the sandbox
// is ~10-15ms — small enough that an incoming /api/health request is
// served well within its 5s probe timeout even under sustained load.
const CHUNK_SIZE = 1_000;

export interface WorkResult {
  durationMs: number;
  iterations: number;
}

/**
 * CPU-bound sha256 loop, async + chunked. Each chunk runs synchronously
 * (we want the CPU to be busy — that's the whole point) but between
 * chunks we yield via `setImmediate`, which lets the Node HTTP listener
 * pick up health probes, SSE writes, and other concurrent work.
 *
 * `intensity` multiplies the iteration count and is clamped by the route
 * handler (0.25–5×) so a buggy or hostile client can't pin a worker.
 */
export async function runCpuWork(intensity = 1): Promise<WorkResult> {
  const iterations = Math.max(1, Math.floor(DEFAULT_ITERATIONS * intensity));
  const start = performance.now();
  let i = 0;
  let lastByte = 0;
  while (i < iterations) {
    const end = Math.min(i + CHUNK_SIZE, iterations);
    for (; i < end; i++) {
      // Independent inputs (rather than chained digests) match the simpler
      // pattern in the spec and don't change the CPU profile meaningfully —
      // sha256 of a small string still bottoms out in OpenSSL.
      lastByte = createHash("sha256").update(String(i)).digest()[0];
    }
    if (i < iterations) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  // Touch the final byte so V8 cannot dead-code-eliminate the loop.
  globalThis.__lastDigestByte = lastByte;
  return { durationMs: performance.now() - start, iterations };
}

declare global {
  // Used to defeat dead-code elimination of the hash loop.
  var __lastDigestByte: number | undefined;
}
