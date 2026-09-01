import Link from "next/link";
import ForgotPasswordForm from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-[var(--background)] px-6 py-16">
      <ForgotPasswordForm />
      <Link href="/login" className="text-sm text-ink3 underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
