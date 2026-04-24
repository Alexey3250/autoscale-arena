"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface RpsChartProps {
  samples: { timestamp: number; durationMs: number }[];
}

interface Bucket {
  bucket: number;
  label: string;
  rps: number;
}

const WINDOW_MS = 60_000;
const BUCKET_MS = 1_000;

export function RpsChart({ samples }: RpsChartProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const data = bucketize(samples, now);
  return (
    <div className="h-32 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <defs>
            <linearGradient id="rps-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.7} />
              <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
            stroke="rgba(255,255,255,0.15)"
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
            stroke="rgba(255,255,255,0.15)"
            allowDecimals={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(15,23,42,0.95)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "rgba(255,255,255,0.7)" }}
            formatter={(value) => {
              const n = typeof value === "number" ? value : Number(value ?? 0);
              return [`${n.toFixed(1)} rps`, "requests"];
            }}
          />
          <Area
            type="monotone"
            dataKey="rps"
            stroke="#93c5fd"
            strokeWidth={2}
            fill="url(#rps-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function bucketize(samples: { timestamp: number; durationMs: number }[], now: number): Bucket[] {
  const cutoff = now - WINDOW_MS;
  const buckets: Bucket[] = [];
  const start = Math.floor(cutoff / BUCKET_MS) * BUCKET_MS;
  for (let t = start; t <= now; t += BUCKET_MS) {
    const secondsAgo = Math.round((now - t) / 1_000);
    buckets.push({
      bucket: t,
      label: secondsAgo === 0 ? "now" : `-${secondsAgo}s`,
      rps: 0,
    });
  }
  if (buckets.length === 0) return buckets;
  const firstBucket = buckets[0].bucket;
  for (const sample of samples) {
    if (sample.timestamp < firstBucket) continue;
    const idx = Math.floor((sample.timestamp - firstBucket) / BUCKET_MS);
    if (idx >= 0 && idx < buckets.length) buckets[idx].rps += 1;
  }
  return buckets;
}
