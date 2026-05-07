"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

type ReasoningTooltipProps = {
  /** Plain-text fallback when `content` is not provided. */
  text?: string;
  /** Rich tooltip body (preferred for structured review copy). */
  content?: ReactNode;
  /** Optional custom trigger content. */
  trigger?: ReactNode;
  triggerClassName?: string;
  triggerAriaLabel?: string;
};

export function ReasoningTooltip(props: ReasoningTooltipProps) {
  const { text, content, trigger, triggerClassName, triggerAriaLabel } = props;
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<{
    top?: number;
    bottom?: number;
    right: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
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
    if (!visible) return;
    updatePosition();
    const handler = () => updatePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [visible, updatePosition, text, content]);

  useEffect(() => {
    if (!pinned) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const insideButton = buttonRef.current?.contains(target ?? null) ?? false;
      const insideTooltip = tooltipRef.current?.contains(target ?? null) ?? false;
      if (!insideButton && !insideTooltip) {
        setPinned(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [pinned]);

  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className={
          triggerClassName ??
          "inline-flex cursor-help items-center justify-center rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        }
        aria-label={triggerAriaLabel ?? "Show enrichment details"}
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
      >
        {trigger ?? <span aria-hidden>ℹ️</span>}
      </button>
      {visible && coords ? (
        <div
          ref={tooltipRef}
          className="z-9999 w-72 max-w-[min(22rem,calc(100vw-2rem))] whitespace-normal wrap-break-word rounded-lg border border-zinc-200 bg-white opacity-100 p-3 text-left text-sm leading-relaxed text-zinc-900 shadow-xl"
          style={{
            position: "fixed",
            top: coords.top,
            bottom: coords.bottom,
            right: coords.right,
            left: "auto",
          }}
          role="tooltip"
        >
          {content ?? text ?? ""}
        </div>
      ) : null}
    </span>
  );
}
