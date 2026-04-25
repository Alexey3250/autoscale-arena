"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HoldButton } from "@/components/HoldButton";
import { MetricsBlock } from "@/components/MetricsBlock";
import { PodGrid } from "@/components/PodGrid";
import { Tooltip } from "@/components/Tooltip";
import type { ScaleSample } from "@/components/ScaleHistoryChart";
import type { HpaStatus, PodInfo, PodsSnapshot, WorkResponse } from "@/lib/types";

const ScaleHistoryChart = dynamic(
  () => import("@/components/ScaleHistoryChart").then((m) => m.ScaleHistoryChart),
  {
    ssr: false,
    loading: () => <div className="h-44 w-full animate-pulse rounded-xl bg-white/5" />,
  },
);

const MAX_RPS_CLIENT = 20;
const MIN_TAP_INTERVAL_MS = 1_000 / MAX_RPS_CLIENT;
const SAMPLE_WINDOW_MS = 90_000;
const SCALE_HISTORY_WINDOW_MS = 180_000;
const STREAM_BACKOFF_MIN_MS = 500;
const STREAM_BACKOFF_MAX_MS = 8_000;
// A pod still counts as "warming up" while its age is below this threshold.
// Calibrated against the worker readinessProbe (5s initial delay + 5s period).
const COLD_START_AGE_MS = 12_000;
// Steady-state samples come only from pods this old or older — keeps the
// metric clean of cold-start outliers.
const STEADY_STATE_MIN_AGE_MS = 30_000;
// 1Hz scale-history sampling. Coarser than the smoother — the chart
// horizon is 2-3 minutes so per-second granularity is more than enough.
const SCALE_SAMPLE_TICK_MS = 1_000;
const RH_RED = "#EE0000";

interface PodsPayload {
  pods: PodInfo[];
  count: number;
  source?: "cluster" | "mock";
  hpaStatus?: HpaStatus | null;
}

interface LatencySample {
  timestamp: number;
  latencyMs: number;
}

interface PodFingerprint {
  startTime: number; // epoch ms
  firstSeenLatencyMs: number;
}

export default function Home() {
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [hpa, setHpa] = useState<HpaStatus | null>(null);
  const [source, setSource] = useState<"cluster" | "mock" | "loading">("loading");
  const [coldStartSamples, setColdStartSamples] = useState<LatencySample[]>([]);
  const [steadySamples, setSteadySamples] = useState<LatencySample[]>([]);
  const [scaleHistory, setScaleHistory] = useState<ScaleSample[]>([]);
  const [totalTaps, setTotalTaps] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [holdMs, setHoldMs] = useState(0);
  const [connectionState, setConnectionState] = useState<"connecting" | "open" | "retrying">(
    "connecting",
  );

  const lastTapRef = useRef(0);
  const mountedRef = useRef(true);
  const podStartCacheRef = useRef<Map<string, number>>(new Map());
  const podsByNameRef = useRef<Map<string, PodInfo>>(new Map());
  const seenPodsRef = useRef<Map<string, PodFingerprint>>(new Map());
  // Refs read by the 1Hz scale-history ticker below — kept in refs so the
  // interval doesn't have to re-bind on every render.
  const readyPodCountRef = useRef(1);
  const hpaRef = useRef<HpaStatus | null>(null);

  useEffect(() => {
    hpaRef.current = hpa;
  }, [hpa]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  /**
   * Mirror the latest pod list to refs so the work-response handler can
   * synchronously look up a pod's startTime by name without waiting for the
   * next React render. We also keep a cache of startTimes (epoch ms) so we
   * can age-test deleted pods that respond after they've been removed from
   * the visible state, and a ready-count ref for the 1Hz scale sampler.
   */
  const applyPods = useCallback((next: PodInfo[]) => {
    podsByNameRef.current = new Map(next.map((p) => [p.name, p]));
    readyPodCountRef.current = Math.max(1, next.filter((p) => p.ready).length);
    for (const pod of next) {
      if (pod.startTime) {
        podStartCacheRef.current.set(pod.name, Date.parse(pod.startTime));
      }
    }
    setPods(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pods/status", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<PodsSnapshot>) : null))
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        applyPods(snapshot.pods);
        setHpa(snapshot.hpaStatus);
        setSource(snapshot.source);
      })
      .catch(() => {
        /* SSE stream will retry. */
      });
    return () => {
      cancelled = true;
    };
  }, [applyPods]);

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
          applyPods(parsed.pods);
          if (parsed.source) setSource(parsed.source);
          if (parsed.hpaStatus !== undefined) setHpa(parsed.hpaStatus);
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
  }, [applyPods]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    /**
     * Combined 1Hz tick:
     *   - bump `now` so age-derived metrics tick forward,
     *   - trim cold-start / steady-state buffers,
     *   - append a scale-history sample and prune old ones.
     *
     * Single interval so we don't fight ourselves with multiple
     * setStates per second.
     */
    const id = setInterval(() => {
      const nowTs = Date.now();
      setNow(nowTs);
      const cutoff = nowTs - SAMPLE_WINDOW_MS;
      setColdStartSamples((prev) => trimSamples(prev, cutoff));
      setSteadySamples((prev) => trimSamples(prev, cutoff));

      const sample: ScaleSample = {
        timestamp: nowTs,
        podCount: readyPodCountRef.current,
        cpuPercent: hpaRef.current?.currentCpuPercent ?? null,
      };
      setScaleHistory((prev) => {
        const sCutoff = nowTs - SCALE_HISTORY_WINDOW_MS;
        const head = prev.length && prev[0].timestamp < sCutoff
          ? prev.findIndex((s) => s.timestamp >= sCutoff)
          : 0;
        const trimmed = head > 0 ? prev.slice(head) : prev;
        return [...trimmed, sample];
      });
    }, SCALE_SAMPLE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  /**
   * Hold timer. Decoupled from `setHoldMs` rapid loop in the button to keep
   * the render once-per-frame, while still letting the button drive its
   * progress ring smoothly.
   *
   * The initial reset to 0 is performed in the start handler (see
   * `handleHoldChange`) to avoid synchronous setState in this effect body.
   */
  useEffect(() => {
    if (!isHolding) {
      const id = setTimeout(() => setHoldMs(0), 4_000);
      return () => clearTimeout(id);
    }
    const start = Date.now();
    const id = setInterval(() => {
      setHoldMs(Date.now() - start);
    }, 100);
    return () => clearInterval(id);
  }, [isHolding]);

  const handleHoldChange = useCallback((holding: boolean) => {
    if (holding) setHoldMs(0);
    setIsHolding(holding);
  }, []);

  const tap = useCallback(async () => {
    const nowTs = Date.now();
    const wait = lastTapRef.current + MIN_TAP_INTERVAL_MS - nowTs;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    lastTapRef.current = Date.now();
    const startedAt = performance.now();
    try {
      const res = await fetch("/api/work", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const latencyMs = performance.now() - startedAt;
      if (!res.ok) {
        if (mountedRef.current) setErrorCount((c) => c + 1);
        return;
      }
      const body = (await res.json()) as WorkResponse;
      if (!mountedRef.current) return;

      const podStart = podStartCacheRef.current.get(body.podName) ?? null;
      const ageMs =
        podStart === null ? Number.POSITIVE_INFINITY : Date.now() - podStart;
      const fingerprint = seenPodsRef.current.get(body.podName);
      const isFirstSeenForPod =
        !fingerprint || (podStart !== null && fingerprint.startTime !== podStart);

      // First reply from a freshly-spawned pod whose age is below the
      // cold-start threshold. We only count it once so a long string of
      // taps doesn't pollute the cold-start metric.
      if (isFirstSeenForPod && ageMs <= COLD_START_AGE_MS) {
        const sample = { timestamp: body.timestamp, latencyMs };
        setColdStartSamples((prev) => [...prev, sample]);
      }

      if (ageMs >= STEADY_STATE_MIN_AGE_MS) {
        setSteadySamples((prev) => {
          const next = [...prev, { timestamp: body.timestamp, latencyMs }];
          return trimSamples(next, Date.now() - SAMPLE_WINDOW_MS);
        });
      }

      seenPodsRef.current.set(body.podName, {
        startTime: podStart ?? 0,
        firstSeenLatencyMs:
          fingerprint?.firstSeenLatencyMs ?? latencyMs,
      });

      setTotalTaps((t) => t + 1);
    } catch {
      if (mountedRef.current) setErrorCount((c) => c + 1);
    }
  }, []);

  const stats = useMemo(() => {
    const recentCutoff = now - 10_000;
    const recentTaps = steadySamples.filter((s) => s.timestamp >= recentCutoff).length +
      coldStartSamples.filter((s) => s.timestamp >= recentCutoff).length;
    const rps = recentTaps / 10;

    const sortedSteady = steadySamples
      .map((s) => s.latencyMs)
      .sort((a, b) => a - b);
    const steadyP95 =
      sortedSteady.length === 0
        ? null
        : sortedSteady[Math.min(sortedSteady.length - 1, Math.floor(sortedSteady.length * 0.95))];

    // Cold start: median of recent cold-start samples — using a single
    // outlier would be misleading. p50 is plenty of signal for a demo.
    const sortedCold = coldStartSamples
      .map((s) => s.latencyMs)
      .sort((a, b) => a - b);
    const coldStart =
      sortedCold.length === 0
        ? null
        : sortedCold[Math.floor(sortedCold.length / 2)];

    return { rps, steadyP95, coldStart };
  }, [steadySamples, coldStartSamples, now]);

  const readyPods = pods.filter((p) => p.ready).length;
  const target = hpa?.targetCpuPercent ?? 50;
  const maxReplicas = hpa?.maxReplicas ?? 10;

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-3xl flex-col items-center gap-6 px-4 py-6 sm:py-10">
      <header className="flex w-full flex-col items-center gap-2 text-center">
        {/* Use absolute positioning for the badge so the centred subtitle
            stays geometrically centred regardless of the badge's width. */}
        <div className="relative flex w-full items-center justify-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-white/55">
            Live Kubernetes HPA Demo
          </p>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">
            <RedHatBadge />
          </span>
        </div>
        <h1 className="font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Autoscale Arena
          <span className="block text-base font-medium text-white/70 sm:text-lg">
            Live on{" "}
            <span style={{ color: RH_RED }} className="font-semibold">
              Red Hat OpenShift
            </span>
          </span>
        </h1>
        <p className="max-w-md text-xs text-white/55">
          Powered by Horizontal Pod Autoscaler, Routes, and Source-to-Image
        </p>
        <ConnectionBadge state={connectionState} source={source} />
      </header>

      <HoldButton
        onTap={tap}
        isHolding={isHolding}
        onHoldChange={handleHoldChange}
        holdMs={holdMs}
      />

      <MetricsBlock
        podCount={readyPods}
        hpa={hpa}
        coldStartMs={stats.coldStart}
        steadyP95Ms={stats.steadyP95}
        rps={stats.rps}
        errorCount={errorCount}
      />

      <section aria-labelledby="pods-heading" className="w-full">
        <div className="mb-2 flex items-baseline justify-between">
          <h2
            id="pods-heading"
            className="flex items-center gap-1.5 text-sm font-semibold text-white/80"
          >
            Worker pods
            <Tooltip
              label="About worker pods"
              text="Each pod runs the same container image, built once via Source-to-Image and shared between the frontend and worker Deployments."
            />
          </h2>
          <span className="text-xs font-mono text-white/50">
            {readyPods} ready · {pods.length} total · {totalTaps} taps
          </span>
        </div>
        <PodGrid pods={pods} />
      </section>

      <section aria-labelledby="history-heading" className="w-full">
        <div className="mb-2 flex items-baseline justify-between">
          <h2
            id="history-heading"
            className="flex items-center gap-1.5 text-sm font-semibold text-white/80"
          >
            Scale history (3 min)
            <Tooltip
              label="About scale history"
              text="Pod count (green, left axis, step) and HPA-observed CPU (red, right axis). When CPU crosses the dashed target, the green step rises shortly after — that's the autoscaler reacting."
            />
          </h2>
          <span className="text-xs font-mono text-white/50">
            {hpa?.currentReplicas ?? readyPods} → {hpa?.desiredReplicas ?? readyPods}
          </span>
        </div>
        <ScaleHistoryChart
          samples={scaleHistory}
          targetCpuPercent={target}
          maxReplicas={maxReplicas}
        />
      </section>

      <Footer source={source} />
    </main>
  );
}

function trimSamples(samples: LatencySample[], cutoff: number): LatencySample[] {
  let firstKeep = 0;
  while (firstKeep < samples.length && samples[firstKeep].timestamp < cutoff) {
    firstKeep += 1;
  }
  return firstKeep === 0 ? samples : samples.slice(firstKeep);
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
  const liveOnCluster = state === "open" && source !== "mock";
  return (
    <div
      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/70"
      style={liveOnCluster ? { borderColor: `${RH_RED}66` } : undefined}
    >
      <span
        className={[
          "h-2 w-2 rounded-full",
          state === "open"
            ? source === "mock"
              ? "bg-amber-400/80"
              : "animate-pulse motion-reduce:animate-none"
            : "bg-slate-400",
        ].join(" ")}
        style={liveOnCluster ? { backgroundColor: RH_RED, boxShadow: `0 0 8px ${RH_RED}` } : undefined}
        aria-hidden
      />
      <span className="font-mono">{label}</span>
    </div>
  );
}

function RedHatBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em]"
      style={{ borderColor: RH_RED, color: RH_RED }}
      aria-label="Red Hat OpenShift"
    >
      <RedHatFedora />
      OpenShift
    </span>
  );
}

function RedHatFedora() {
  return (
    <svg
      viewBox="0 0 32 32"
      width="14"
      height="14"
      aria-hidden
      fill={RH_RED}
    >
      <path d="M21.5 18c2.4 0 4.4-.4 4.4-1.6 0-1-1-1.7-1-2.7C24.9 9.5 21.7 5 16 5 9.4 5 5 8.7 5 11.5c0 .9.4 1.4.9 2 .8.6 2.7 1.4 5 1.4 1.5 0 2.7-.4 3.7-1.1l-.3.1c-1 .4-2.7.6-4 .6-3.6 0-6.5-1.6-6.5-3.5 0-3.5 5-7 11.2-7 6.7 0 10.6 4.3 10.8 8.1 0 .8.5 1.6 1 2 .3.4.7.7.7 1.2 0 .8-.7 1.7-2 2.7H21.5z" />
      <path d="M25.4 17.1c.4-1 .6-2 .6-3 0-1.6-.5-3-1.4-4.3.7 1.7 1.1 3.6 1 5.4-.1 1.4-.5 2.6-1.2 3.6.4-.3.7-.6 1-.9.7-.8 1-1.6 0-.8z" />
    </svg>
  );
}

function Footer({ source }: { source: "cluster" | "mock" | "loading" }) {
  return (
    <footer className="mt-2 flex w-full flex-col items-center gap-2 border-t border-white/10 pt-4 text-center text-[11px] text-white/50">
      <p>
        Deployed on{" "}
        <span style={{ color: RH_RED }} className="font-semibold">
          Red Hat OpenShift Developer Sandbox
        </span>{" "}
        · Built with Next.js, S2I, and the Kubernetes API
      </p>
      <p className="font-mono text-[10px] text-white/35">
        {source === "mock"
          ? "Running with mock pod data — deploy to OpenShift to see the HPA react to real traffic."
          : "HPA target 50% CPU · scale 1–10 pods · scale-down stabilization 60s · Route exposed via OpenShift HAProxy"}
      </p>
    </footer>
  );
}
