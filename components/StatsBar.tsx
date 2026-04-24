"use client";

interface StatsBarProps {
  podCount: number;
  rps: number;
  p95Ms: number | null;
  totalTaps: number;
  errorCount: number;
}

export function StatsBar({ podCount, rps, p95Ms, totalTaps, errorCount }: StatsBarProps) {
  return (
    <dl className="grid w-full grid-cols-2 gap-2 text-center sm:grid-cols-4">
      <Stat label="pods" value={podCount.toString()} accent="text-emerald-300" />
      <Stat label="rps" value={rps.toFixed(1)} accent="text-sky-300" />
      <Stat
        label="p95 ms"
        value={p95Ms === null ? "—" : Math.round(p95Ms).toString()}
        accent="text-fuchsia-300"
      />
      <Stat
        label="taps"
        value={totalTaps.toString()}
        accent="text-amber-200"
        secondary={errorCount > 0 ? `${errorCount} errors` : undefined}
      />
    </dl>
  );
}

function Stat({
  label,
  value,
  accent,
  secondary,
}: {
  label: string;
  value: string;
  accent: string;
  secondary?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[0.2em] text-white/50">{label}</dt>
      <dd className={`font-mono text-2xl font-semibold tabular-nums ${accent}`}>{value}</dd>
      {secondary && (
        <p className="text-[10px] font-medium text-rose-300">{secondary}</p>
      )}
    </div>
  );
}
