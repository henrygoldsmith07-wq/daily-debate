"use client";

// Reader-preference controls.
//
// The design system has shipped the CSS for these four classes since it was
// added to le-studio.css, but no surface ever applied them — so "larger text",
// "higher contrast", "dyslexia-friendly type" and "reduce motion" were
// unreachable. This is that surface: a disclosure panel so it never competes
// with the product's primary actions.

import { useId, useState } from "react";
import { READER_PREFERENCE_OPTIONS, useReaderPreferences } from "@/lib/readerPreferences";

export default function ReaderPreferences() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { isEnabled, toggle } = useReaderPreferences();

  return (
    <div className="border-t border-[var(--rule)] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-ink2 hover:text-ink"
        data-testid="reader-preferences-toggle"
      >
        Reading comfort
        <span aria-hidden="true" className="text-xs text-ink3">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div id={panelId} className="mt-3 flex flex-col gap-3" data-testid="reader-preferences-panel">
          <p className="text-[11px] leading-4 text-ink3">
            Stored on this device only. Applies immediately, including before you sign in.
          </p>

          {READER_PREFERENCE_OPTIONS.map((option) => {
            // useSyncExternalStore returns the server snapshot ("") until it
            // subscribes, so an enabled preference is simply not yet reflected
            // here rather than being shown as explicitly off.
            const checked = isEnabled(option.key);
            return (
              <label key={option.key} className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(option.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--speak)]"
                  data-testid={`reader-pref-${option.key}`}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink2">{option.label}</span>
                  <span className="block text-[11px] leading-4 text-ink3">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
