import Link from "next/link";
import { Suspense } from "react";
import ResetPasswordForm from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 py-16">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
      <Link href="/login" className="text-sm text-ink3 underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
