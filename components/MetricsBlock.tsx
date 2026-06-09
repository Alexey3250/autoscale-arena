"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { HpaStatus } from "@/lib/types";
import { Tooltip } from "./Tooltip";

interface MetricsBlockProps {
  podCount: number;
  hpa: HpaStatus | null;
  cpuRequestMillicores: number | null;
  steadyP95Ms: number | null;
  rps: number;
  errorCount: number;
}

const RH_RED = "#EE0000";

export function MetricsBlock({
  podCount,
  hpa,
  cpuRequestMillicores,
  steadyP95Ms,
  rps,
  errorCount,
}: MetricsBlockProps) {
  const cpu = hpa?.currentCpuPercent ?? null;
  const target = hpa?.targetCpuPercent ?? 50;
  const desiredReplicas = hpa?.desiredReplicas ?? null;
  const currentReplicas = hpa?.currentReplicas ?? null;
  const overTarget = cpu !== null && cpu > target;
  const perPodCpuMillicores =
    cpu !== null && cpuRequestMillicores !== null
      ? (cpu / 100) * cpuRequestMillicores
      : null;

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
          label="HPA wants"
          value={desiredReplicas === null ? "—" : desiredReplicas.toString()}
          accent={
            desiredReplicas !== null && currentReplicas !== null && desiredReplicas > currentReplicas
              ? "text-amber-200"
              : "text-white"
          }
          highlight={desiredReplicas ?? 0}
          tooltip={{
            label: "About desired pods",
            text: "Desired replicas from the Horizontal Pod Autoscaler. This can rise before the new worker pods are Ready.",
          }}
          secondary={currentReplicas === null ? undefined : `current ${currentReplicas}`}
          secondaryClass={
            desiredReplicas !== null && currentReplicas !== null && desiredReplicas > currentReplicas
              ? "text-amber-200/85"
              : "text-white/45"
          }
        />
        <Stat
          label="CPU / request"
          value={cpu === null ? "—" : `${Math.round(cpu)}%`}
          accent={overTarget ? "" : "text-sky-300"}
          accentStyle={
            overTarget ? { color: RH_RED, textShadow: `0 0 12px ${RH_RED}66` } : undefined
          }
          highlight={cpu ?? 0}
          tooltip={{
            label: "About HPA CPU",
            text: cpuRequestMillicores === null
              ? "HPA CPU is average pod usage divided by each pod's requested CPU, not a percentage of the whole node. Values above 100% mean pods are using more CPU than they requested."
              : `HPA CPU is average pod usage divided by each pod's ${formatMillicores(cpuRequestMillicores)} CPU request. 300% means about ${formatMillicores(cpuRequestMillicores * 3)} per worker pod.`,
          }}
          secondary={
            perPodCpuMillicores === null
              ? `target ${target}%`
              : `${formatMillicores(perPodCpuMillicores)}/pod · target ${target}%`
          }
          secondaryClass={overTarget ? "text-rose-300" : "text-white/45"}
        />
        <Stat
          label="Warm p95"
          value={steadyP95Ms === null ? "—" : `${Math.round(steadyP95Ms)}ms`}
          accent="text-fuchsia-300"
          tooltip={{
            label: "About warm p95",
            text: "p95 latency from pods that have been Ready long enough to serve normally. New scale-up pods are ignored for this latency card.",
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

function formatMillicores(value: number): string {
  const rounded = Math.round(value);
  return `${rounded}m`;
}
