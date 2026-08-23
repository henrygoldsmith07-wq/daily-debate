import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-xs uppercase tracking-wide text-ink3">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">That debate doesn&apos;t exist</h1>
      <p className="max-w-sm text-sm text-ink3">
        The page you&apos;re looking for was moved, deleted, or never existed.
      </p>
      <Link href="/" className="btn btn-primary px-4 py-2 text-sm">
        Back to today&apos;s debate
      </Link>
    </div>
  );
}
