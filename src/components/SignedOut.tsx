import Link from "next/link";

/**
 * The consistent empty state for auth-gated screens. Previously each page
 * dropped a bare sentence into the layout; this keeps a signed-out visitor
 * inside the product with a title, an explanation, and the way forward.
 */
export default function SignedOut({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="signed-out">
      <h1 className="signed-out-title">{title}</h1>
      <p className="signed-out-copy">{description}</p>
      <div className="signed-out-actions">
        <Link href="/login" className="btn btn-primary px-4 py-2 text-sm">
          Sign in
        </Link>
        <Link href="/" className="btn btn-secondary px-4 py-2 text-sm">
          Try a guest debate
        </Link>
      </div>
    </div>
  );
}
