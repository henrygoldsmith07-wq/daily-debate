/**
 * Small inline icons for status and controls, drawn in the same 24×24,
 * single-stroke style as NavIcon so the interface uses one icon family.
 * They replace emoji that were standing in for icons (the streak flame and
 * the mode labels): emoji render in a different style on every platform and
 * read as decoration rather than as part of the UI.
 */
export type UiIconName = "flame" | "mic" | "text" | "clipboard" | "bolt";

const PATHS: Record<UiIconName, React.ReactNode> = {
  flame: <path d="M12 3c.5 3.2 4.5 5.3 4.5 10a4.5 4.5 0 0 1-9 0c0-2.2 1.1-3.6 2.2-4.6.2 1.4 1 2.4 2 2.6C11 8.5 11.3 5.4 12 3z" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  text: <path d="M5 6h14M5 10h14M5 14h9M5 18h6" />,
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5h6v2.5H9zM8.5 11h7M8.5 15h5" />
    </>
  ),
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />,
};

export default function UiIcon({ name, className = "h-[1em] w-[1em]" }: { name: UiIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`inline-block shrink-0 align-[-0.125em] ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
