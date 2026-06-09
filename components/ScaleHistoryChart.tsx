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
  desiredReplicas: number | null;
  /** HPA-observed CPU. Null until metrics-server has reported. */
  cpuPercent: number | null;
}

interface ScaleHistoryChartProps {
  samples: ScaleSample[];
  targetCpuPercent: number;
  /** maxReplicas from HPA spec; used to scale the left Y axis. */
  maxReplicas: number;
  cpuRequestMillicores: number | null;
}

const WINDOW_MS = 180_000;
const RH_RED = "#EE0000";

/**
 * Story-of-autoscaling chart: pod count (green step) on the left axis,
 * HPA-observed CPU (red line) on the right axis, with the HPA target as
 * a dashed red reference. When CPU crosses the target, the step rises
 * shortly after — that's the autoscaler doing its thing.
 */
export function ScaleHistoryChart({
  samples,
  targetCpuPercent,
  maxReplicas,
  cpuRequestMillicores,
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
      desired: s.desiredReplicas,
      cpu: s.cpuPercent,
    }));

  const maxPodValue = Math.max(
    2,
    maxReplicas,
    ...data.map((s) => Math.max(s.pods, s.desired ?? 0)),
  );
  const maxCpuValue = Math.max(targetCpuPercent, ...data.map((s) => s.cpu ?? 0));
  const podDomain: [number, number] = [0, maxPodValue];
  const cpuDomain: [number, number] = [
    0,
    Math.max(100, roundUp(maxCpuValue * 1.1, 50)),
  ];

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
            width={44}
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
              if (name === "Ready pods" || name === "HPA desired") {
                const n = typeof value === "number" ? value : Number(value ?? 0);
                return [`${n} pods`, String(name)];
              }
              if (value === null || value === undefined) return ["—", "CPU / request"];
              const n = typeof value === "number" ? value : Number(value);
              return [formatCpuValue(n, cpuRequestMillicores), "CPU / request"];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}
            iconType="plainline"
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
            name="Ready pods"
            type="stepAfter"
            stroke="#34d399"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="pods"
            dataKey="desired"
            name="HPA desired"
            type="stepAfter"
            stroke="#fbbf24"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            yAxisId="cpu"
            dataKey="cpu"
            name="CPU / request"
            type="monotone"
            stroke="#f87171"
            strokeWidth={2}
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

function roundUp(value: number, increment: number): number {
  return Math.ceil(value / increment) * increment;
}

function formatCpuValue(percent: number, requestMillicores: number | null): string {
  const roundedPercent = Math.round(percent);
  if (requestMillicores === null) return `${roundedPercent}% of request`;
  const millicores = Math.round((percent / 100) * requestMillicores);
  return `${roundedPercent}% (~${millicores}m/pod)`;
}
