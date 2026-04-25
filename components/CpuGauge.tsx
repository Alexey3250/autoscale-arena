"use client";

import type { HpaStatus } from "@/lib/types";
import { Tooltip } from "./Tooltip";

interface CpuGaugeProps {
  hpa: HpaStatus | null;
}

const RH_RED = "#EE0000";

/**
 * Linear gauge of current CPU utilisation across worker pods, with a marker
 * at the HPA target. Sized for mobile: the bar fills the column width and the
 * label/legend stack vertically.
 */
export function CpuGauge({ hpa }: CpuGaugeProps) {
  const cpu = hpa?.currentCpuPercent ?? null;
  const target = hpa?.targetCpuPercent ?? 50;
  // Cap the bar's visual scale at 150% so a single pod under load doesn't
  // squish the target marker against the right edge.
  const max = Math.max(150, (cpu ?? 0) + 10);
  const cpuPct = cpu === null ? 0 : (cpu / max) * 100;
  const targetPct = (target / max) * 100;
  const overTarget = cpu !== null && cpu > target;

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
            text="Average CPU across all worker pods, as the HPA sees it. The autoscaler adds replicas when this exceeds the target."
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
          {cpu === null ? "—" : `${Math.round(cpu)}%`}
        </span>
        <span className="font-mono text-sm text-white/50">/ {target}% target</span>
      </div>
      <div
        className="relative mt-3 h-3 overflow-hidden rounded-full bg-white/10"
        role="meter"
        aria-valuenow={cpu ?? 0}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`CPU utilization ${cpu === null ? "unknown" : `${Math.round(cpu)} percent`}`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: `${cpuPct}%`,
            background: overTarget
              ? `linear-gradient(90deg, ${RH_RED}, #f97316)`
              : "linear-gradient(90deg, #22d3ee, #38bdf8)",
            boxShadow: overTarget ? `0 0 14px ${RH_RED}99` : undefined,
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
      <footer className="mt-2 flex items-center justify-between text-[11px] text-white/55">
        <span className="font-mono">
          {hpa?.currentReplicas ?? "—"} → {hpa?.desiredReplicas ?? "—"} replicas
        </span>
        <span className="font-mono">
          min {hpa?.minReplicas ?? "—"} · max {hpa?.maxReplicas ?? "—"}
        </span>
      </footer>
      {hpa?.error && hpa.error !== "mock" && (
        <p className="mt-2 text-[11px] text-amber-300/80">
          HPA read failed: {hpa.error}. The page is showing pod data only.
        </p>
      )}
    </section>
  );
}
