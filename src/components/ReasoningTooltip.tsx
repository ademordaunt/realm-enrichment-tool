"use client";

import { useState } from "react";

export function ReasoningTooltip({ text }: { text: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const visible = hover || pinned;

  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
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
      {visible && (
        <div
          className="absolute left-full top-1/2 z-50 ml-2 w-72 max-w-[min(90vw,20rem)] -translate-y-1/2 rounded-md border border-zinc-200 bg-white p-3 text-left text-xs leading-relaxed text-zinc-800 shadow-lg dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
          role="tooltip"
        >
          {text}
        </div>
      )}
    </span>
  );
}
