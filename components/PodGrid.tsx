"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import type { PodInfo } from "@/lib/types";

interface PodGridProps {
  pods: PodInfo[];
}

const STATUS_COLOR: Record<string, string> = {
  Running: "bg-emerald-500 shadow-emerald-500/40",
  Ready: "bg-emerald-500 shadow-emerald-500/40",
  Pending: "bg-amber-400 shadow-amber-400/40",
  ContainerCreating: "bg-amber-400 shadow-amber-400/40",
  Terminating: "bg-slate-400 shadow-slate-400/40",
  CrashLoopBackOff: "bg-rose-500 shadow-rose-500/40",
  Error: "bg-rose-500 shadow-rose-500/40",
  Unknown: "bg-slate-500 shadow-slate-500/40",
};

export function PodGrid({ pods }: PodGridProps) {
  return (
    <motion.ul
      layout
      className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      aria-label="Worker pods"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {pods.map((pod) => (
          <PodCard key={pod.name} pod={pod} />
        ))}
        {pods.length === 0 && (
          <motion.li
            key="empty"
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="col-span-full rounded-xl border border-white/10 bg-white/5 p-4 text-center text-sm text-white/60"
          >
            No pods yet — hold the button to make the HPA spawn one.
          </motion.li>
        )}
      </AnimatePresence>
    </motion.ul>
  );
}

function PodCard({ pod }: { pod: PodInfo }) {
  const ageSec = useAge(pod.startTime);
  const shortName = pod.name.slice(-6);
  const statusKey = pod.ready ? "Ready" : pod.status;
  const color = STATUS_COLOR[statusKey] ?? STATUS_COLOR.Unknown;
  const reduceMotion = useReducedMotion();

  return (
    <motion.li
      layout
      initial={
        reduceMotion ? { opacity: 1 } : { scale: 0, opacity: 0, y: -16 }
      }
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={
        reduceMotion
          ? { opacity: 0 }
          : { scale: 0, opacity: 0, transition: { duration: 0.3 } }
      }
      transition={{ type: "spring", stiffness: 220, damping: 24 }}
      className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-3 text-left shadow-lg backdrop-blur-sm"
      title={pod.name}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`inline-block h-2.5 w-2.5 rounded-full shadow-[0_0_12px] ${color} ${
            pod.ready ? "animate-pulse motion-reduce:animate-none" : ""
          }`}
        />
        <span className="font-mono text-sm tracking-wide text-white">…{shortName}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-y-0.5 text-[11px] text-white/70">
        <dt className="text-white/50">status</dt>
        <dd className="text-right font-medium text-white/90">{pod.status}</dd>
        <dt className="text-white/50">age</dt>
        <dd className="text-right font-mono text-white/90">{formatAge(ageSec)}</dd>
      </dl>
      <p className="mt-2 truncate text-[10px] text-white/40">
        Pod · UBI9 Node.js (S2I) · managed by Deployment
      </p>
    </motion.li>
  );
}

function useAge(startTime: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startTime) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTime]);
  if (!startTime) return 0;
  return Math.max(0, Math.floor((now - Date.parse(startTime)) / 1000));
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}
