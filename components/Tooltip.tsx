"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";

interface TooltipProps {
  /** Accessible label of the trigger button. */
  label: string;
  /** Tooltip body text. */
  text: string;
}

/**
 * Tiny `i` button that toggles a popover on tap/hover/focus. Designed for
 * mobile-first: tap-to-toggle and tap-outside-to-close. Not a modal — it
 * doesn't trap focus or block interaction with anything else.
 */
export function Tooltip({ label, text }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const handler = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handler);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <span ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/25 text-[9px] font-bold text-white/60 transition-colors hover:border-white/50 hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60"
      >
        i
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-lg border border-white/15 bg-slate-900/95 px-3 py-2 text-left text-[11px] font-normal leading-snug text-white/85 shadow-xl backdrop-blur"
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
