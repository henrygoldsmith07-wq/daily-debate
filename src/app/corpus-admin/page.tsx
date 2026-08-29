import Link from "next/link";
import { createClient } from "@/lib/backend/server";
import { isCorpusAdmin } from "@/lib/corpus";
import AppShell from "@/components/AppShell";
import PageHeader from "@/components/PageHeader";
import CorpusAdmin from "@/components/CorpusAdmin";

export const dynamic = "force-dynamic";

export const metadata = { title: "Corpus admin" };

export default async function CorpusAdminPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user || !isCorpusAdmin(user.email, process.env.CORPUS_ADMIN_EMAILS)) {
    return (
      <AppShell width="narrow">
        <PageHeader
          eyebrow="Human evaluation"
          title="Corpus admin"
          description="This console is restricted to corpus administrators."
        />
      </AppShell>
    );
  }

  return (
    <AppShell width="narrow">
      <PageHeader
        eyebrow="Human evaluation"
        title="Corpus admin"
        description={
          <>
            Track population progress against the benchmark target, adjudicate items where blind raters
            disagree, and run the judge-vs-human comparison over agreement-ready debates. Raters can be
            recruited to{" "}
            <Link href="/rate" className="text-[var(--accent)] hover:underline">
              /rate
            </Link>
            .
          </>
        }
      />
      <CorpusAdmin />
    </AppShell>
  );
}
