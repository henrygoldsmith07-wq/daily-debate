import Link from "next/link";

/** Privacy/Terms links, shared by the login page and the app shell. */
export default function LegalLinks({ className = "text-xs text-ink3" }: { className?: string }) {
  return (
    <p className={className}>
      <Link href="/privacy" className="underline underline-offset-4 hover:text-ink2">
        Privacy
      </Link>
      <span aria-hidden="true"> · </span>
      <Link href="/terms" className="underline underline-offset-4 hover:text-ink2">
        Terms
      </Link>
    </p>
  );
}
