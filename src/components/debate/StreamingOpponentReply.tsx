// The opponent reply while it is being written.
//
// Before any text arrives this is the familiar thinking indicator. Once the
// stream delivers text it renders in the same bubble as a persisted opponent
// turn, with a typing caret, so the hand-off to the saved turn is seamless.
//
// Accessibility: the transcript is an aria-live log. Re-announcing a growing
// paragraph on every token would be unusable with a screen reader, so the
// partial text is hidden from assistive tech and a single status line says
// the opponent is replying; the complete turn is announced once it is saved
// and joins the log.

import ThinkingIndicator from "../ThinkingIndicator";

export interface StreamingOpponentReplyProps {
  /** Reply text streamed so far; null or empty before the first token. */
  text: string | null;
}

export default function StreamingOpponentReply({ text }: StreamingOpponentReplyProps) {
  if (!text) return <ThinkingIndicator />;
  return (
    <div className="flex flex-col gap-1" data-testid="streaming-reply">
      <div
        className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[var(--accent-soft)] px-3 py-2 text-sm"
        aria-hidden="true"
      >
        {text}
        <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-[var(--accent)]" />
      </div>
      <p className="sr-only" role="status">
        Opponent is replying
      </p>
    </div>
  );
}
