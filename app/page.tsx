"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PodGrid } from "@/components/PodGrid";
import { StatsBar } from "@/components/StatsBar";
import { TapButton } from "@/components/TapButton";
import type { PodInfo, PodsSnapshot, WorkResponse, WorkSample } from "@/lib/types";

const RpsChart = dynamic(
  () => import("@/components/RpsChart").then((m) => m.RpsChart),
  {
    ssr: false,
    loading: () => <div className="h-32 w-full animate-pulse rounded-xl bg-white/5" />,
  },
);

const MAX_RPS_CLIENT = 20;
const MIN_TAP_INTERVAL_MS = 1_000 / MAX_RPS_CLIENT;
const SAMPLE_WINDOW_MS = 60_000;
const STREAM_BACKOFF_MIN_MS = 500;
const STREAM_BACKOFF_MAX_MS = 8_000;

interface PodsPayload {
  pods: PodInfo[];
  count: number;
  source?: "cluster" | "mock";
}

export default function Home() {
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [source, setSource] = useState<"cluster" | "mock" | "loading">("loading");
  const [samples, setSamples] = useState<WorkSample[]>([]);
  const [totalTaps, setTotalTaps] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [connectionState, setConnectionState] = useState<"connecting" | "open" | "retrying">(
    "connecting",
  );

  const lastTapRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pods/status", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<PodsSnapshot>) : null))
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        setPods(snapshot.pods);
        setSource(snapshot.source);
      })
      .catch(() => {
        /* SSE stream will retry. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let attempt = 0;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      setConnectionState(attempt === 0 ? "connecting" : "retrying");
      es = new EventSource("/api/pods/stream");
      es.onopen = () => {
        attempt = 0;
        setConnectionState("open");
      };
      es.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data) as PodsPayload;
          if (!parsed || !Array.isArray(parsed.pods)) return;
          setPods(parsed.pods);
          if (parsed.source) setSource(parsed.source);
        } catch {
          /* ignore malformed message */
        }
      };
      es.onerror = () => {
        es?.close();
        if (disposed) return;
        const delay = Math.min(
          STREAM_BACKOFF_MAX_MS,
          STREAM_BACKOFF_MIN_MS * Math.pow(2, attempt),
        );
        attempt += 1;
        setConnectionState("retrying");
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const nowTs = Date.now();
      setNow(nowTs);
      const cutoff = nowTs - SAMPLE_WINDOW_MS;
      setSamples((prev) => {
        const trimmed = prev.filter((s) => s.timestamp >= cutoff);
        return trimmed.length === prev.length ? prev : trimmed;
      });
    }, 1_000);
    return () => clearInterval(id);
  }, []);

  const tap = useCallback(async () => {
    const now = Date.now();
    const wait = lastTapRef.current + MIN_TAP_INTERVAL_MS - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    lastTapRef.current = Date.now();
    try {
      const res = await fetch("/api/work", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        if (mountedRef.current) setErrorCount((c) => c + 1);
        return;
      }
      const body = (await res.json()) as WorkResponse;
      if (!mountedRef.current) return;
      setSamples((prev) => {
        const next = [...prev, { timestamp: body.timestamp, durationMs: body.durationMs }];
        const cutoff = Date.now() - SAMPLE_WINDOW_MS;
        return next.filter((s) => s.timestamp >= cutoff);
      });
      setTotalTaps((t) => t + 1);
    } catch {
      if (mountedRef.current) setErrorCount((c) => c + 1);
    }
  }, []);

  const stats = useMemo(() => {
    const recent = samples.filter((s) => s.timestamp >= now - 10_000);
    const rps = recent.length / 10;
    const sorted = samples
      .map((s) => s.durationMs)
      .sort((a, b) => a - b);
    const p95 =
      sorted.length === 0
        ? null
        : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    return { rps, p95 };
  }, [samples, now]);

  const readyPods = pods.filter((p) => p.ready).length;

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center gap-6 px-4 py-6 sm:py-10">
      <header className="flex w-full flex-col items-center gap-2 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/50">
          kubernetes horizontal pod autoscaler
        </p>
        <h1 className="bg-gradient-to-r from-rose-300 via-fuchsia-300 to-sky-300 bg-clip-text font-mono text-3xl font-bold tracking-tight text-transparent sm:text-4xl">
          Autoscale Arena
        </h1>
        <p className="max-w-md text-sm text-white/70">
          Hold the button to push CPU into the worker pods. Watch OpenShift spin them up, then wind
          them down when you let go.
        </p>
        <ConnectionBadge state={connectionState} source={source} />
      </header>

      <TapButton onTap={tap} isHolding={isHolding} onHoldChange={setIsHolding} />

      <StatsBar
        podCount={readyPods}
        rps={stats.rps}
        p95Ms={stats.p95}
        totalTaps={totalTaps}
        errorCount={errorCount}
      />

      <section aria-labelledby="pods-heading" className="w-full">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="pods-heading" className="text-sm font-semibold text-white/80">
            Worker pods
          </h2>
          <span className="text-xs font-mono text-white/50">
            {readyPods} ready · {pods.length} total
          </span>
        </div>
        <PodGrid pods={pods} />
      </section>

      <section aria-labelledby="rps-heading" className="w-full">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="rps-heading" className="text-sm font-semibold text-white/80">
            Requests per second (60s)
          </h2>
          <span className="text-xs font-mono text-white/50">
            p95 {stats.p95 === null ? "—" : `${Math.round(stats.p95)}ms`}
          </span>
        </div>
        <RpsChart samples={samples} />
      </section>

      <HpaHint source={source} />
    </main>
  );
}

function ConnectionBadge({
  state,
  source,
}: {
  state: "connecting" | "open" | "retrying";
  source: "cluster" | "mock" | "loading";
}) {
  const label =
    state === "open"
      ? source === "mock"
        ? "mock cluster (local dev)"
        : "live stream"
      : state === "retrying"
        ? "reconnecting…"
        : "connecting…";
  const color =
    state === "open"
      ? source === "mock"
        ? "bg-amber-400/80"
        : "bg-emerald-400"
      : "bg-slate-400";
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/70">
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      <span className="font-mono">{label}</span>
    </div>
  );
}

function HpaHint({ source }: { source: "cluster" | "mock" | "loading" }) {
  if (source === "mock") {
    return (
      <p className="text-center text-xs text-white/50">
        Running with mock pod data — deploy to OpenShift to see the HPA react to real traffic.
      </p>
    );
  }
  return (
    <p className="text-center text-xs text-white/50">
      HPA target: 50% CPU · scale 1–10 pods · slow scale-down so you can watch it happen.
    </p>
  );
}
