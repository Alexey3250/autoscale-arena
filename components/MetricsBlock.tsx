"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { HpaStatus } from "@/lib/types";
import { Tooltip } from "./Tooltip";

interface MetricsBlockProps {
  podCount: number;
  hpa: HpaStatus | null;
  coldStartMs: number | null;
  steadyP95Ms: number | null;
  rps: number;
  errorCount: number;
}

const RH_RED = "#EE0000";

export function MetricsBlock({
  podCount,
  hpa,
  coldStartMs,
  steadyP95Ms,
  rps,
  errorCount,
}: MetricsBlockProps) {
  const cpu = hpa?.currentCpuPercent ?? null;
  const target = hpa?.targetCpuPercent ?? 50;
  const overTarget = cpu !== null && cpu > target;

  return (
    <div className="w-full">
      <dl className="grid w-full grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <Stat
          label="Worker pods"
          value={podCount.toString()}
          accent={podCount > 1 ? "text-emerald-300" : "text-white"}
          highlight={podCount}
          tooltip={{
            label: "About worker pods",
            text: "Each pod runs the same container image (Source-to-Image build). Managed by a Kubernetes Deployment, scaled by HPA.",
          }}
        />
        <Stat
          label="CPU avg"
          value={cpu === null ? "—" : `${Math.round(cpu)}%`}
          accent={overTarget ? "" : "text-sky-300"}
          accentStyle={
            overTarget ? { color: RH_RED, textShadow: `0 0 12px ${RH_RED}66` } : undefined
          }
          highlight={cpu ?? 0}
          tooltip={{
            label: "About CPU avg",
            text: `Average CPU usage across all worker pods. HPA scales when this exceeds ${target}%.`,
          }}
          secondary={overTarget ? `over ${target}% target` : undefined}
          secondaryClass="text-rose-300"
        />
        <Stat
          label="Cold start"
          value={coldStartMs === null ? "—" : formatSeconds(coldStartMs)}
          accent="text-amber-200"
          tooltip={{
            label: "About cold start",
            text: "Time to first response from a newly-spawned pod. Cold starts happen during scale-up events while the pod boots and passes its readiness probe.",
          }}
          highlight={coldStartMs ?? 0}
        />
        <Stat
          label="Steady-state p95"
          value={steadyP95Ms === null ? "—" : `${Math.round(steadyP95Ms)}ms`}
          accent="text-fuchsia-300"
          tooltip={{
            label: "About steady-state p95",
            text: "p95 latency from pods that have been up for 30+ seconds. Filters out cold-start outliers so this reflects real serving performance.",
          }}
          secondary={errorCount > 0 ? `${errorCount} errors` : `${rps.toFixed(1)} rps`}
          secondaryClass={errorCount > 0 ? "text-rose-300" : "text-white/45"}
          highlight={steadyP95Ms ?? 0}
        />
      </dl>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  accent: string;
  accentStyle?: React.CSSProperties;
  /** Pulses when this changes; pass a number that mutates with the stat. */
  highlight?: number;
  tooltip?: { label: string; text: string };
  secondary?: string;
  secondaryClass?: string;
}

function Stat({
  label,
  value,
  accent,
  accentStyle,
  highlight,
  tooltip,
  secondary,
  secondaryClass,
}: StatProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left">
      <dt className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-white/55">
        <span className="truncate">{label}</span>
        {tooltip && <Tooltip label={tooltip.label} text={tooltip.text} />}
      </dt>
      <motion.dd
        key={highlight}
        initial={reduceMotion ? false : { scale: 0.96, opacity: 0.8 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 18 }}
        className={`mt-0.5 font-mono text-2xl font-semibold tabular-nums ${accent}`}
        style={accentStyle}
      >
        {value}
      </motion.dd>
      {secondary && (
        <p className={`text-[10px] font-medium ${secondaryClass ?? "text-white/45"}`}>
          {secondary}
        </p>
      )}
    </div>
  );
}

function formatSeconds(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  return `${(ms / 1_000).toFixed(1)}s`;
}
