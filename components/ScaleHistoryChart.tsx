"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ScaleSample {
  timestamp: number;
  podCount: number;
  /** HPA-observed CPU (lags reality by 15-30s). */
  cpuObserved: number | null;
  /** Client-derived CPU estimate (live, reacts within a tap). */
  cpuDerived: number;
}

interface ScaleHistoryChartProps {
  samples: ScaleSample[];
  targetCpuPercent: number;
  /** maxReplicas from HPA spec; used to scale the left Y axis. */
  maxReplicas: number;
}

const WINDOW_MS = 120_000;
const RH_RED = "#EE0000";
const DERIVED_COLOR = "#f87171"; // rose-400, the live signal
const OBSERVED_COLOR = "rgba(248,113,113,0.55)"; // same hue, muted

/**
 * Story-of-autoscaling chart. Top → bottom:
 *   1. Pod count (green step) — what the cluster currently runs.
 *   2. Live CPU (solid red) — derived from RPS × latency ÷ podCount.
 *      Reacts within a tap.
 *   3. HPA-observed CPU (dashed faded red) — lags by 15-30s because
 *      metrics-server scrapes pods at that cadence.
 *   4. Target (dashed RH-red horizontal) — the threshold the HPA is
 *      trying to hold to.
 *
 * The whole point is the gap between line 2 and line 3: it explains
 * visually why scale-up takes a beat after the user starts loading.
 */
export function ScaleHistoryChart({
  samples,
  targetCpuPercent,
  maxReplicas,
}: ScaleHistoryChartProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const cutoff = now - WINDOW_MS;
  const data = samples
    .filter((s) => s.timestamp >= cutoff)
    .map((s) => ({
      t: s.timestamp,
      label: formatRelative(s.timestamp, now),
      pods: s.podCount,
      cpuLive: s.cpuDerived,
      cpuHpa: s.cpuObserved,
    }));

  const podDomain: [number, number] = [0, Math.max(2, maxReplicas)];
  const cpuDomain: [number, number] = [0, Math.max(100, targetCpuPercent + 20)];

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
            stroke="rgba(255,255,255,0.15)"
            interval="preserveStartEnd"
            minTickGap={48}
          />
          <YAxis
            yAxisId="pods"
            domain={podDomain}
            tick={{ fill: "rgba(110,231,183,0.85)", fontSize: 10 }}
            stroke="rgba(255,255,255,0.15)"
            allowDecimals={false}
            width={36}
            label={{
              value: "pods",
              angle: -90,
              position: "insideLeft",
              fill: "rgba(110,231,183,0.7)",
              fontSize: 10,
              dy: 20,
            }}
          />
          <YAxis
            yAxisId="cpu"
            orientation="right"
            domain={cpuDomain}
            tick={{ fill: "rgba(252,165,165,0.85)", fontSize: 10 }}
            stroke="rgba(255,255,255,0.15)"
            width={36}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(15,23,42,0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "rgba(255,255,255,0.7)" }}
            formatter={(value: unknown, name: unknown) => {
              if (name === "pods") {
                const n = typeof value === "number" ? value : Number(value ?? 0);
                return [`${n} pods`, "worker pods"];
              }
              if (name === "cpuLive") {
                if (value === null || value === undefined) return ["—", "cpu (live)"];
                const n = typeof value === "number" ? value : Number(value);
                return [`${Math.round(n)}%`, "cpu (live, derived)"];
              }
              if (name === "cpuHpa") {
                if (value === null || value === undefined) return ["—", "cpu (HPA, 15-30s lag)"];
                const n = typeof value === "number" ? value : Number(value);
                return [`${Math.round(n)}%`, "cpu (HPA, 15-30s lag)"];
              }
              return [String(value ?? ""), String(name ?? "")];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}
            iconType="plainline"
            formatter={(v: string) => {
              if (v === "pods") return "worker pods";
              if (v === "cpuLive") return "cpu (live)";
              if (v === "cpuHpa") return "cpu (HPA)";
              return v;
            }}
          />
          <ReferenceLine
            yAxisId="cpu"
            y={targetCpuPercent}
            stroke={RH_RED}
            strokeDasharray="4 4"
            label={{
              position: "insideTopRight",
              value: `target ${targetCpuPercent}%`,
              fill: RH_RED,
              fontSize: 10,
            }}
          />
          <Line
            yAxisId="pods"
            dataKey="pods"
            type="stepAfter"
            stroke="#34d399"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="cpu"
            dataKey="cpuLive"
            type="monotone"
            stroke={DERIVED_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="cpu"
            dataKey="cpuHpa"
            type="monotone"
            stroke={OBSERVED_COLOR}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatRelative(ts: number, now: number): string {
  const sec = Math.round((now - ts) / 1_000);
  if (sec <= 0) return "now";
  if (sec < 60) return `-${sec}s`;
  const min = Math.floor(sec / 60);
  const remainder = sec % 60;
  return remainder === 0 ? `-${min}m` : `-${min}m${remainder}s`;
}
