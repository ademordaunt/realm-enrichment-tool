"use client";

import { useState } from "react";
import { FieldTrustRulesModal } from "@/components/FieldTrustRulesModal";

export function FieldTrustRulesSubline(props: { listType: "companies" | "contacts" }) {
  const { listType } = props;
  const [open, setOpen] = useState(false);

  return (
    <>
      <p className="mt-3 text-xs text-(--text-secondary)">
        For more on how fields are sourced and written:{" "}
        <button
          type="button"
          className="font-medium text-(--text-primary) underline decoration-(--border-default) underline-offset-2 hover:decoration-current"
          onClick={() => setOpen(true)}
        >
          Field trust rules →
        </button>
      </p>
      <FieldTrustRulesModal
        key={open ? listType : "closed"}
        listType={listType}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
