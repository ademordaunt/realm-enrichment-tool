"use client";

const btnBase =
  "flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-6 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7B35C1] focus-visible:ring-offset-2";

const btnOutline =
  `${btnBase} border-2 border-[#7B35C1] bg-white text-[#7B35C1] hover:bg-[#7B35C1] hover:text-white`;

export interface StarterScreenProps {
  onSelectMode: (mode: "event" | "bulk") => void;
}

export function StarterScreen({ onSelectMode }: StarterScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-10 py-16">
      <h1 className="text-center text-xl font-semibold text-(--realm-navy) sm:text-2xl">
        What are you importing?
      </h1>

      <div className="flex w-full flex-col gap-4 sm:flex-row sm:gap-6">
        <button type="button" className={`group ${btnOutline}`} onClick={() => onSelectMode("event")}>
          <span className="text-base font-semibold sm:text-lg">Marketing Event List</span>
          <span className="text-sm text-(--text-muted) group-hover:text-white/90">&lt;200 records</span>
        </button>

        <button type="button" className={`group ${btnOutline}`} onClick={() => onSelectMode("bulk")}>
          <span className="text-base font-semibold sm:text-lg">Bulk Import</span>
          <span className="text-sm text-(--text-muted) group-hover:text-white/90">200–2,000 records</span>
        </button>
      </div>
    </div>
  );
}
