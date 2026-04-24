"use client";

import { useEffect, useRef, useState } from "react";

interface TapButtonProps {
  onTap: () => void | Promise<unknown>;
  isHolding: boolean;
  onHoldChange: (holding: boolean) => void;
  disabled?: boolean;
}

/**
 * Big tap-to-load button. Supports press-and-hold (auto-repeat) on touch and
 * mouse. Holding fires taps as fast as the previous one resolves, capped by
 * the client-side RPS throttle enforced by the page.
 */
export function TapButton({ onTap, isHolding, onHoldChange, disabled }: TapButtonProps) {
  const [pulses, setPulses] = useState<number[]>([]);
  const holdingRef = useRef(isHolding);

  useEffect(() => {
    holdingRef.current = isHolding;
  }, [isHolding]);

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

  const handleTap = () => {
    const id = Date.now() + Math.random();
    setPulses((prev) => [...prev.slice(-4), id]);
    setTimeout(() => {
      setPulses((prev) => prev.filter((p) => p !== id));
    }, 600);
    void onTap();
  };

  const startHold = () => {
    if (disabled) return;
    onHoldChange(true);
  };
  const endHold = () => {
    if (!holdingRef.current) return;
    onHoldChange(false);
  };

  return (
    <button
      type="button"
      aria-label="Tap to generate CPU load on the worker pods"
      aria-pressed={isHolding}
      disabled={disabled}
      onClick={(e) => {
        if (isHolding) return;
        e.preventDefault();
        handleTap();
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        startHold();
      }}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!isHolding) startHold();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          endHold();
        }
      }}
      className={[
        "relative isolate flex items-center justify-center",
        "aspect-square w-[min(60vw,320px)] select-none rounded-full",
        "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-orange-500",
        "text-center text-xl font-semibold uppercase tracking-widest text-white",
        "shadow-[0_20px_60px_-20px_rgba(244,63,94,0.75)]",
        "transition-transform duration-150 ease-out",
        "motion-reduce:transition-none",
        isHolding ? "scale-95" : "hover:scale-[1.02] active:scale-95",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-300/70",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      ].join(" ")}
    >
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        {pulses.map((id) => (
          <span
            key={id}
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-white/70 motion-reduce:hidden"
            style={{ animation: "tap-ring 600ms ease-out forwards" }}
          />
        ))}
      </span>
      <span className="relative z-10 flex flex-col items-center gap-2">
        <span className="text-3xl">{isHolding ? "HOLDING" : "TAP"}</span>
        <span className="text-xs font-medium tracking-[0.3em] text-white/80">
          {isHolding ? "release to stop" : "to load"}
        </span>
      </span>
    </button>
  );
}
