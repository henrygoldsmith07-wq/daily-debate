export default function ThinkingIndicator({ label = "AI is thinking" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-ink3" role="status">
      {label}
      <span className="flex gap-1" aria-hidden="true">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:300ms]" />
      </span>
    </p>
  );
}
