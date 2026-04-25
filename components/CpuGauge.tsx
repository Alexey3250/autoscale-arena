"use client";

import type { HpaStatus } from "@/lib/types";
import { Tooltip } from "./Tooltip";

interface CpuGaugeProps {
  /**
   * Live, derived CPU estimate in percent. Always a number — the client
   * can compute this from finished worker requests even when the HPA is
   * unreachable, so the gauge always has something to show.
   */
  primary: number;
  /**
   * What the HPA controller actually sees. Lags `primary` by 15-30s due
   * to metrics-server scrape intervals; we surface that lag in the UI.
   */
  secondary: HpaStatus | null;
  /** Target % from HPA spec. Falls back to 50 when secondary is null. */
  target: number;
}

const RH_RED = "#EE0000";
const SCALE_UP_LAG_THRESHOLD = 15;

/**
 * Linear gauge with two layers of meaning:
 *   - Big number + filled bar: the *derived* live CPU estimate (reacts
 *     within a tap).
 *   - Small annotation: the HPA's observed CPU (15-30s behind reality).
 *   - Optional "scale-up coming" hint when the live number runs ahead of
 *     the HPA reading by enough that scale-up is imminent.
 *
 * Sized for mobile: bar fills the column, label/legend stack vertically.
 */
export function CpuGauge({ primary, secondary, target }: CpuGaugeProps) {
  const observed = secondary?.currentCpuPercent ?? null;
  // Cap the visual scale at 110% so the target marker never gets pinned
  // against the right edge.
  const max = Math.max(110, primary + 10);
  const primaryPct = (primary / max) * 100;
  const targetPct = (target / max) * 100;
  const overTarget = primary > target;
  const lag = observed === null ? 0 : Math.max(0, primary - observed);
  const showScaleUp =
    observed !== null && lag >= SCALE_UP_LAG_THRESHOLD && primary > target;
  const observedLabel =
    observed === null
      ? secondary?.error && secondary.error !== "mock"
        ? "HPA: unavailable"
        : "HPA observes: —"
      : `HPA observes: ${Math.round(observed)}% (15–30s lag)`;

  return (
    <section
      aria-labelledby="cpu-gauge-heading"
      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2
          id="cpu-gauge-heading"
          className="flex items-center gap-1.5 text-sm font-semibold text-white/80"
        >
          CPU utilization
          <Tooltip
            label="What is CPU utilization?"
            text="Estimated CPU load based on observed request latency × throughput ÷ pod count. Updates in real time."
          />
        </h2>
        <span className="font-mono text-[11px] text-white/50">
          target {target}%
        </span>
      </header>
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={`font-mono text-3xl font-semibold tabular-nums ${
            overTarget ? "text-[color:var(--rh-red)]" : "text-white"
          }`}
          style={{ ["--rh-red" as string]: RH_RED }}
        >
          {Math.round(primary)}%
        </span>
        <span className="font-mono text-sm text-white/50">/ {target}% target</span>
      </div>
      <div
        className="relative mt-3 h-3 overflow-hidden rounded-full bg-white/10"
        role="meter"
        aria-valuenow={Math.round(primary)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-label={`Estimated CPU utilization ${Math.round(primary)} percent`}
      >
        <div
          className="h-full rounded-full motion-reduce:transition-none"
          style={{
            width: `${primaryPct}%`,
            background: overTarget
              ? `linear-gradient(90deg, ${RH_RED}, #f97316)`
              : "linear-gradient(90deg, #22d3ee, #38bdf8)",
            boxShadow: overTarget ? `0 0 14px ${RH_RED}99` : undefined,
            transition: "width 120ms linear, background 200ms ease-out",
          }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-px"
          style={{
            left: `${targetPct}%`,
            backgroundColor: RH_RED,
            boxShadow: `0 0 4px ${RH_RED}`,
          }}
          aria-hidden
        />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/55">
        <span className="font-mono">{observedLabel}</span>
        <Tooltip
          label="Why is the HPA reading delayed?"
          text="What the HPA controller actually sees — metrics-server scrapes pods every 15s, so this lags behind the live load by 15–30 seconds. This is why scale-up takes time."
        />
        {showScaleUp && (
          <span
            className="ml-auto font-mono font-semibold"
            style={{ color: RH_RED }}
          >
            ↑ scale-up coming
          </span>
        )}
      </div>
      <footer className="mt-2 flex items-center justify-between text-[11px] text-white/55">
        <span className="font-mono">
          {secondary?.currentReplicas ?? "—"} → {secondary?.desiredReplicas ?? "—"} replicas
        </span>
        <span className="font-mono">
          min {secondary?.minReplicas ?? "—"} · max {secondary?.maxReplicas ?? "—"}
        </span>
      </footer>
      {secondary?.error && secondary.error !== "mock" && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          HPA read failed ({secondary.error}). Showing live derived load only.
        </p>
      )}
    </section>
  );
}
