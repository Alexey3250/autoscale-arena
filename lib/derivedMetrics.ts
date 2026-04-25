/**
 * Client-side estimate of worker CPU utilisation.
 *
 * Why bother when we already poll the HPA?
 *   metrics-server scrapes pods every 15s and the HPA controller smooths the
 *   readings, so `currentCpuPercent` from /api/hpa/status lags the true
 *   instantaneous load by 15-30s. That's the right number to feed an
 *   autoscaler — it's the wrong number to put on a gauge during a demo,
 *   because the gauge stays at 0% for a long time after the user starts
 *   tapping.
 *
 * Trick:
 *   Each worker request returns the wall-clock CPU time it spent in
 *   `runCpuWork` (the sha256 loop is ~100% CPU-bound, so durationMs ≈
 *   consumed-CPU-ms on the worker pod). Sum the durations finished in the
 *   last second, divide by (1s × pod count), and you have a ~live estimate
 *   of average pod utilisation. It can over- or under-shoot during scale
 *   transitions, but it reacts within a tap.
 */

export interface RequestSample {
  /** Epoch millis when the worker reported the request finished. */
  timestamp: number;
  /** Wall-clock ms the worker spent on CPU for that one request. */
  durationMs: number;
}

/**
 * % CPU used per pod, averaged across all ready pods, over the last
 * `windowMs` ms. Saturates at 100 — a single pod can't be >100% busy from
 * the perspective of the workload it served, so we cap to keep the gauge
 * sensible.
 */
export function instantaneousCpuPercent(
  samples: RequestSample[],
  now: number,
  windowMs: number,
  podCount: number,
): number {
  if (samples.length === 0) return 0;
  const cutoff = now - windowMs;
  let totalMs = 0;
  // Iterate from the end — the buffer is roughly time-ordered (we only
  // append in tap()), so as soon as we hit a sample older than the cutoff
  // we can stop.
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.timestamp < cutoff) break;
    totalMs += s.durationMs;
  }
  const denom = windowMs * Math.max(1, podCount);
  return Math.min(100, (totalMs / denom) * 100);
}

/**
 * Exponential moving average. Defaults to alpha=0.3, which produces a
 * pleasant settle time of ~1s when sampled at 10Hz: enough damping that
 * the gauge doesn't twitch per-request, fast enough that release is
 * visible inside 1-2 seconds.
 */
export function smoothCpu(prev: number, next: number, alpha = 0.3): number {
  return (1 - alpha) * prev + alpha * next;
}

/**
 * Drops in-place samples older than `cutoff`. Returns the same array if
 * nothing was trimmed, otherwise a new array. Used to keep the per-tap
 * buffer bounded.
 */
export function trimRequestSamples(
  samples: RequestSample[],
  cutoff: number,
): RequestSample[] {
  let firstKeep = 0;
  while (firstKeep < samples.length && samples[firstKeep].timestamp < cutoff) {
    firstKeep += 1;
  }
  return firstKeep === 0 ? samples : samples.slice(firstKeep);
}
