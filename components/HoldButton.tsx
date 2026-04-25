"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

interface HoldButtonProps {
  onTap: () => void | Promise<unknown>;
  isHolding: boolean;
  onHoldChange: (holding: boolean) => void;
  /** ms the user has been holding; drives the progress ring + hint timeline. */
  holdMs: number;
  disabled?: boolean;
}

/**
 * Hold-first action button. The progress ring is purely visual feedback —
 * the actual scaling is controlled by the cluster, not the timer. The hints
 * narrate what OpenShift is doing at roughly the timestamps it actually
 * happens, so the user has something to read while CPU climbs.
 */
const HINTS: Array<{ at: number; text: string }> = [
  { at: 0, text: "Hold for at least 30 seconds to trigger autoscaling" },
  { at: 5_000, text: "OpenShift is detecting load…" },
  { at: 10_000, text: "HPA is calculating desired replicas…" },
  { at: 17_000, text: "Spinning up worker pods via the Deployment…" },
  { at: 25_000, text: "OpenShift Route is load-balancing your taps across pods" },
];

const COOLDOWN_HINT = "Cooldown — pods will scale down in 1–5 minutes";
const COOLDOWN_VISIBLE_MS = 6_000;
const RING_FULL_AT_MS = 30_000;

export function HoldButton({
  onTap,
  isHolding,
  onHoldChange,
  holdMs,
  disabled,
}: HoldButtonProps) {
  const holdingRef = useRef(isHolding);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();
  const [showCooldown, setShowCooldown] = useState(false);

  useEffect(() => {
    holdingRef.current = isHolding;
  }, [isHolding]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isHolding) return;
    let cancelled = false;
    const loop = async () => {
      while (!cancelled && holdingRef.current) {
        await onTap();
      }
    };
    void loop();
    return () => {
      cancelled = true;
    };
  }, [isHolding, onTap]);

  const startHold = () => {
    if (disabled) return;
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    setShowCooldown(false);
    onHoldChange(true);
  };
  const endHold = () => {
    if (!holdingRef.current) return;
    onHoldChange(false);
    setShowCooldown(true);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => {
      setShowCooldown(false);
      cooldownTimerRef.current = null;
    }, COOLDOWN_VISIBLE_MS);
  };

  const ratio = Math.min(1, holdMs / RING_FULL_AT_MS);
  const ringOffset = 282.74 * (1 - ratio);

  const hint = isHolding ? hintForHoldMs(holdMs) : showCooldown ? COOLDOWN_HINT : HINTS[0].text;

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <motion.button
        type="button"
        aria-label="Hold to generate CPU load on the worker pods"
        aria-pressed={isHolding}
        disabled={disabled}
        onPointerDown={(e) => {
          e.preventDefault();
          startHold();
        }}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !isHolding) {
            e.preventDefault();
            startHold();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            endHold();
          }
        }}
        animate={
          reduceMotion
            ? undefined
            : isHolding
              ? { scale: 0.94 }
              : { scale: 1 }
        }
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className={[
          "relative isolate flex items-center justify-center",
          "aspect-square w-[min(72vw,340px)] select-none rounded-full",
          "bg-gradient-to-br from-[#EE0000] via-rose-600 to-orange-500",
          "text-center text-xl font-semibold uppercase tracking-widest text-white",
          "shadow-[0_24px_70px_-18px_rgba(238,0,0,0.7)]",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-300/70",
          "touch-none",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        ].join(" ")}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full -rotate-90"
          viewBox="0 0 100 100"
          aria-hidden
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="3"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="282.74"
            strokeDashoffset={ringOffset}
            style={{
              transition: reduceMotion
                ? "none"
                : "stroke-dashoffset 200ms linear",
            }}
          />
        </svg>
        <span className="relative z-10 flex flex-col items-center gap-2">
          <span className="text-3xl drop-shadow-sm">
            {isHolding ? "HOLDING" : "HOLD"}
          </span>
          <span className="text-xs font-medium tracking-[0.3em] text-white/85">
            {isHolding ? `${(holdMs / 1000).toFixed(1)}s` : "to load"}
          </span>
        </span>
      </motion.button>
      <div className="relative h-10 w-full max-w-md text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={hint}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className={[
              "absolute inset-x-0 px-2 text-sm",
              isHolding
                ? "font-medium text-rose-200"
                : showCooldown
                  ? "text-sky-200/85"
                  : "text-white/70",
            ].join(" ")}
          >
            {hint}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

function hintForHoldMs(ms: number): string {
  let active = HINTS[0].text;
  for (const h of HINTS) {
    if (ms >= h.at) active = h.text;
  }
  return active;
}
