"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function ReasoningTooltip({ text }: { text: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    right: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const visible = hover || pinned;

  const updatePosition = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const cy = rect.top + rect.height / 2;
    const third = vh / 3;

    let placement: "below" | "above";
    if (cy < third) {
      placement = "below";
    } else if (cy > 2 * third) {
      placement = "above";
    } else {
      placement = "above";
    }

    const right = vw - rect.right;

    if (placement === "below") {
      setCoords({ top: rect.bottom + 8, right, bottom: undefined });
    } else {
      setCoords({ bottom: vh - rect.top + 8, right, top: undefined });
    }
  }, []);

  useLayoutEffect(() => {
    if (!visible) {
      setCoords(null);
      return;
    }
    updatePosition();
    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [visible, updatePosition, text]);

  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className="cursor-help rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        aria-label="Show AI reasoning"
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
      >
        <span aria-hidden>ℹ️</span>
      </button>
      {visible && coords ? (
        <div
          className="w-64 whitespace-normal break-words rounded-lg border border-(--border-default) bg-white p-3 text-left text-sm leading-relaxed text-(--text-primary) shadow-(--shadow-card-hover) z-[9999]"
          style={{
            position: "fixed",
            top: coords.top,
            bottom: coords.bottom,
            right: coords.right,
            left: "auto",
          }}
          role="tooltip"
        >
          {text}
        </div>
      ) : null}
    </span>
  );
}
