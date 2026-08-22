import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isCorpusAdmin } from "@/lib/corpus";
import AppHeader from "@/components/AppHeader";
import CorpusAdmin from "@/components/CorpusAdmin";

export const dynamic = "force-dynamic";

export const metadata = { title: "Corpus admin" };

export default async function CorpusAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main id="main" className="mx-auto w-full max-w-2xl px-4 py-10 text-sm text-ink3">
          This console is restricted to corpus administrators.
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink3">Human evaluation</p>
          <h1 className="text-2xl font-semibold tracking-tight">Corpus admin</h1>
          <p className="mt-2 text-sm text-ink3">
            Track population progress against the benchmark target, adjudicate items where blind raters disagree, and
            run the judge-vs-human comparison over agreement-ready debates. Raters can be recruited to{" "}
            <Link href="/rate" className="text-[var(--accent)] hover:underline">
              /rate
            </Link>
            .
          </p>
        </div>
        <CorpusAdmin />
      </main>
    </div>
  );
}
